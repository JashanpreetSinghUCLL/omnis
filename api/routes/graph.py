"""GET /v1/graph/explore — NDJSON streaming graph endpoint.

Wire format
-----------
Streams NDJSON: one JSON object per line, no trailing comma.

    {"type":"node","id":"n1","label":"LightRAG","entity_type":"Technology","degree":12}\n
    {"type":"edge","source":"n1","target":"n2","relation":"DEPENDS_ON"}\n
    ...
    {"type":"done","total_nodes":42,"total_edges":87}\n

Query params (all optional)
----------------------------
tenant_id    — isolate to a single tenant (default "default")
entity_type  — filter nodes by Neo4j label (e.g. "Technology")
depth        — traversal depth 1–4 (default 2)
limit        — max nodes returned 1–2000 (default 500)
cursor       — opaque pagination cursor (node id); start from that node's neighbourhood
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

import neo4j
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from api.config import get_settings
from api.schemas.graph import GraphDoneEvent, GraphEdgeEvent, GraphNodeEvent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["graph"])


# ── Cypher ────────────────────────────────────────────────────────────────────

# Returns every entity reachable within `depth` hops from any seed node
# (or from a specific cursor node), together with their direct relationships.
# The tenant guard is NULL-safe so entities without tenant_id are globally visible.

_NODES_CYPHER = """
MATCH (n)
WHERE ($entity_type IS NULL OR n:{entity_type_placeholder})
  AND (n.tenant_id IS NULL OR n.tenant_id = $tenant_id)
WITH n,
     COALESCE(n.name, n.id, toString(id(n))) AS label_val,
     [l IN labels(n) WHERE l <> '__Entity__' AND l <> '__KGBuilder__'][0] AS etype
WHERE etype IS NOT NULL
WITH n, label_val, etype
ORDER BY n.x IS NOT NULL DESC, id(n)
SKIP $skip
LIMIT $limit
OPTIONAL MATCH (n)-[r]-()
WITH n, label_val, etype, count(r) AS deg
RETURN
    toString(id(n))  AS id,
    label_val        AS label,
    etype            AS entity_type,
    deg              AS degree,
    n.x              AS x,
    n.y              AS y
"""

_EDGES_CYPHER = """
MATCH (a)-[r]->(b)
WHERE (a.tenant_id IS NULL OR a.tenant_id = $tenant_id)
  AND ($entity_type IS NULL OR a:{entity_type_placeholder})
WITH a, r, b
ORDER BY id(r)
SKIP $skip
LIMIT $edge_limit
RETURN
    toString(id(a)) AS source,
    toString(id(b)) AS target,
    type(r)         AS relation
"""


def _build_nodes_query(entity_type: str | None) -> str:
    """Substitute entity_type label into Cypher (label names cannot be parameterised)."""
    placeholder = entity_type if entity_type else "__Entity__"
    return _NODES_CYPHER.replace("{entity_type_placeholder}", placeholder)


def _build_edges_query(entity_type: str | None) -> str:
    placeholder = entity_type if entity_type else "__Entity__"
    return _EDGES_CYPHER.replace("{entity_type_placeholder}", placeholder)


# ── NDJSON generator ──────────────────────────────────────────────────────────


async def _stream_graph(
    tenant_id: str,
    entity_type: str | None,
    limit: int,
) -> AsyncIterator[bytes]:
    """Async generator that yields NDJSON bytes for graph nodes, edges, then done."""
    settings = get_settings()
    driver = neo4j.AsyncGraphDatabase.driver(
        settings.neo4j_uri,
        auth=(settings.neo4j_user, settings.neo4j_password_str),
    )

    node_ids: set[str] = set()
    total_edges = 0

    try:
        async with driver.session() as session:
            # ── 1. Stream nodes ───────────────────────────────────────────────
            nodes_query = _build_nodes_query(entity_type)
            result = await session.run(
                nodes_query,
                tenant_id=tenant_id,
                entity_type=entity_type,
                skip=0,
                limit=limit,
            )
            records = await result.data()

            for row in records:
                node_id = str(row["id"])
                node_ids.add(node_id)
                event = GraphNodeEvent(
                    id=node_id,
                    label=str(row["label"] or node_id),
                    entity_type=str(row["entity_type"] or "Unknown"),
                    degree=int(row["degree"] or 0),
                    x=float(row["x"]) if row.get("x") is not None else None,
                    y=float(row["y"]) if row.get("y") is not None else None,
                )
                yield (json.dumps(event.model_dump()) + "\n").encode()

            # ── 2. Stream edges (only between nodes we already returned) ─────
            edges_query = _build_edges_query(entity_type)
            edge_limit = min(limit * 4, 4000)  # edges are more numerous; cap generously
            result = await session.run(
                edges_query,
                tenant_id=tenant_id,
                entity_type=entity_type,
                skip=0,
                edge_limit=edge_limit,
            )
            edge_records = await result.data()

            for row in edge_records:
                src = str(row["source"])
                tgt = str(row["target"])
                # Only emit edges where both endpoints are in our node set
                if src in node_ids and tgt in node_ids:
                    event = GraphEdgeEvent(
                        source=src,
                        target=tgt,
                        relation=row.get("relation"),
                    )
                    yield (json.dumps(event.model_dump()) + "\n").encode()
                    total_edges += 1

        # ── 3. Done sentinel ─────────────────────────────────────────────────
        done = GraphDoneEvent(total_nodes=len(node_ids), total_edges=total_edges)
        yield (json.dumps(done.model_dump()) + "\n").encode()

    except Exception as exc:
        logger.exception("Graph explore failed")
        error_line = json.dumps({"type": "error", "detail": str(exc)}) + "\n"
        yield error_line.encode()
    finally:
        await driver.close()


# ── Endpoint ──────────────────────────────────────────────────────────────────


@router.get("/graph/explore")
async def graph_explore(
    tenant_id: str = Query(default="default"),
    entity_type: str | None = Query(default=None),
    depth: int = Query(default=2, ge=1, le=4),
    limit: int = Query(default=500, ge=1, le=2000),
    cursor: str | None = Query(default=None),
) -> StreamingResponse:
    """Stream the knowledge graph as NDJSON.

    Events: N × ``node``, M × ``edge``, 1 × ``done``.
    Depth and cursor are accepted for API compatibility but the current
    implementation returns a flat entity snapshot (depth-aware traversal
    is a planned optimisation once graph sizes exceed 10K nodes).
    """
    return StreamingResponse(
        _stream_graph(
            tenant_id=tenant_id,
            entity_type=entity_type,
            limit=limit,
        ),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
