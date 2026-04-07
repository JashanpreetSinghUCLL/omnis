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
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["graph"])


# ── Cypher ────────────────────────────────────────────────────────────────────

# Returns every entity reachable within `depth` hops from any seed node
# (or from a specific cursor node), together with their direct relationships.
# The tenant guard is NULL-safe so entities without tenant_id are globally visible.

_NODES_CYPHER = """
MATCH (n:__Entity__)
WHERE ($entity_type IS NULL OR n:{entity_type_placeholder})
  AND ($source IS NULL OR EXISTS {
    MATCH (n)-[:FROM_CHUNK]->(:Chunk)-[:FROM_DOCUMENT]->(doc:Document)
    WHERE doc.source = $source
  })
WITH n,
     COALESCE(n.name, toString(id(n))) AS label_val,
     [l IN labels(n) WHERE l <> '__Entity__' AND l <> '__KGBuilder__'][0] AS etype
WHERE etype IS NOT NULL
WITH n, label_val, etype
ORDER BY id(n)
SKIP $skip
LIMIT $limit
OPTIONAL MATCH (n)-[r]-(m:__Entity__)
WITH n, label_val, etype, count(r) AS deg
RETURN
    toString(id(n))  AS id,
    label_val        AS label,
    etype            AS entity_type,
    deg              AS degree,
    n.x              AS x,
    n.y              AS y
"""

_EDGES_BY_IDS_CYPHER = """
MATCH (a:__Entity__)-[r]->(b:__Entity__)
WHERE toString(id(a)) IN $node_ids
  AND toString(id(b)) IN $node_ids
RETURN
    toString(id(a)) AS source,
    toString(id(b)) AS target,
    type(r)         AS relation
LIMIT $edge_limit
"""


def _build_nodes_query(entity_type: str | None) -> str:
    """Substitute entity_type label into Cypher (label names cannot be parameterised)."""
    placeholder = entity_type if entity_type else "__Entity__"
    return _NODES_CYPHER.replace("{entity_type_placeholder}", placeholder)


# ── NDJSON generator ──────────────────────────────────────────────────────────


async def _stream_graph(
    tenant_id: str,
    entity_type: str | None,
    source: str | None,
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
                source=source,
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

            # ── 2. Stream edges between loaded nodes ──────────────────────────
            # Query by node ID list — this correctly returns all edges where
            # both endpoints are in the loaded set, regardless of which document
            # each entity came from.
            if node_ids:
                edge_limit = min(len(node_ids) * 10, 4000)
                result = await session.run(
                    _EDGES_BY_IDS_CYPHER,
                    node_ids=list(node_ids),
                    edge_limit=edge_limit,
                )
                edge_records = await result.data()

                for row in edge_records:
                    event = GraphEdgeEvent(
                        source=str(row["source"]),
                        target=str(row["target"]),
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
    source: str | None = Query(default=None),
    depth: int = Query(default=2, ge=1, le=4),
    limit: int = Query(default=500, ge=1, le=2000),
    cursor: str | None = Query(default=None),
) -> StreamingResponse:
    """Stream the knowledge graph as NDJSON.

    Events: N × ``node``, M × ``edge``, 1 × ``done``.
    ``source`` filters to entities extracted from a specific document filename.
    Depth and cursor are accepted for API compatibility but the current
    implementation returns a flat entity snapshot.
    """
    return StreamingResponse(
        _stream_graph(
            tenant_id=tenant_id,
            entity_type=entity_type,
            source=source,
            limit=limit,
        ),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/graph/meta")
async def graph_meta(source: str = Query()) -> JSONResponse:
    """Return live counts (pages, chunks, nodes) for a specific document source.

    The frontend calls this after ingestion completes to populate the Documents
    table when the cached Redis metadata is stale (e.g. first run before the
    new pipeline format was in place).
    """
    settings = get_settings()
    driver = neo4j.AsyncGraphDatabase.driver(
        settings.neo4j_uri,
        auth=(settings.neo4j_user, settings.neo4j_password_str),
    )
    try:
        async with driver.session() as session:
            # Page count from Document nodes for this source
            r = await session.run(
                "MATCH (d:Document {source: $source}) "
                "RETURN max(toInteger(d.page)) AS max_page, count(d) AS chunk_count",
                source=source,
            )
            row = (await r.data() or [{}])[0]
            pages = int(row.get("max_page") or 0)
            chunks = int(row.get("chunk_count") or 0)

            # Entity count reachable from this source's chunks
            r2 = await session.run(
                """
                MATCH (e:__Entity__)-[:FROM_CHUNK]->(:Chunk)-[:FROM_DOCUMENT]->(d:Document)
                WHERE d.source = $source
                RETURN count(DISTINCT e) AS entity_count
                """,
                source=source,
            )
            row2 = (await r2.data() or [{}])[0]
            nodes = int(row2.get("entity_count") or 0)

    except Exception as exc:
        logger.exception("graph_meta failed for source=%s", source)
        return JSONResponse({"error": str(exc)}, status_code=500)
    finally:
        await driver.close()

    return JSONResponse({"source": source, "pages": pages, "chunks": chunks, "nodes": nodes})


@router.get("/graph/stats")
async def graph_stats() -> JSONResponse:
    """Return live counts for the entire knowledge base.

    These are KB-wide figures (not limited to whatever the frontend has loaded),
    so the client can show "250 of 1,247 entities loaded" accurately.
    """
    settings = get_settings()
    driver = neo4j.AsyncGraphDatabase.driver(
        settings.neo4j_uri,
        auth=(settings.neo4j_user, settings.neo4j_password_str),
    )
    try:
        async with driver.session() as session:
            r = await session.run(
                """
                MATCH (e:__Entity__)
                WITH count(e) AS total_entities
                OPTIONAL MATCH ()-[r]-()
                WITH total_entities, count(r) / 2 AS total_relations
                OPTIONAL MATCH (d:Document)
                RETURN total_entities,
                       total_relations,
                       count(DISTINCT d.source) AS total_documents
                """
            )
            row = (await r.data() or [{}])[0]
    except Exception as exc:
        logger.exception("graph_stats failed")
        return JSONResponse({"error": str(exc)}, status_code=500)
    finally:
        await driver.close()

    return JSONResponse({
        "total_entities":  int(row.get("total_entities")  or 0),
        "total_relations": int(row.get("total_relations") or 0),
        "total_documents": int(row.get("total_documents") or 0),
    })


@router.get("/graph/node/{node_id}/detail")
async def node_detail(node_id: str) -> JSONResponse:
    """Return all Neo4j properties for a single entity node.

    Surfaces name, description (LLM-generated during extraction), entity type,
    degree, aliases, and any other properties stored by the pipeline.
    """
    settings = get_settings()
    driver = neo4j.AsyncGraphDatabase.driver(
        settings.neo4j_uri,
        auth=(settings.neo4j_user, settings.neo4j_password_str),
    )
    try:
        async with driver.session() as session:
            # All stored properties + degree + outgoing relation types
            r = await session.run(
                """
                MATCH (e:__Entity__)
                WHERE id(e) = $node_id
                WITH e,
                     [l IN labels(e) WHERE l <> '__Entity__' AND l <> '__KGBuilder__'][0] AS entity_type
                OPTIONAL MATCH (e)-[r]->()
                WITH e, entity_type,
                     count(r) AS out_degree,
                     collect(DISTINCT type(r)) AS out_relations
                OPTIONAL MATCH ()-[r2]->(e)
                WITH e, entity_type, out_degree, out_relations,
                     count(r2) AS in_degree,
                     collect(DISTINCT type(r2)) AS in_relations
                RETURN
                    properties(e)   AS props,
                    entity_type,
                    out_degree,
                    in_degree,
                    out_relations,
                    in_relations
                """,
                node_id=int(node_id),
            )
            rows = await r.data()
    except Exception as exc:
        logger.exception("node_detail failed for node_id=%s", node_id)
        return JSONResponse({"error": str(exc)}, status_code=500)
    finally:
        await driver.close()

    if not rows:
        return JSONResponse({"error": "node not found"}, status_code=404)

    row = rows[0]
    raw_props: dict = dict(row.get("props") or {})
    # Drop internal/embedding fields that are noisy to display
    display_props = {
        k: v for k, v in raw_props.items()
        if k not in {"embedding", "embeddings"} and not k.startswith("_")
        and v is not None and v != ""
    }

    return JSONResponse({
        "node_id":      node_id,
        "entity_type":  row.get("entity_type"),
        "name":         raw_props.get("name") or raw_props.get("id", ""),
        "description":  raw_props.get("description") or raw_props.get("summary") or "",
        "out_degree":   int(row.get("out_degree") or 0),
        "in_degree":    int(row.get("in_degree")  or 0),
        "out_relations": list(row.get("out_relations") or []),
        "in_relations":  list(row.get("in_relations")  or []),
        "properties":   display_props,
    })


@router.get("/graph/sources")
async def graph_sources() -> JSONResponse:
    """Return the list of unique document source names stored in Neo4j.

    The frontend uses this to populate the document-filter picker so it sends
    the exact string Neo4j has (rather than the UploadContext display name,
    which may differ from the internal ingestion filename).
    """
    settings = get_settings()
    driver = neo4j.AsyncGraphDatabase.driver(
        settings.neo4j_uri,
        auth=(settings.neo4j_user, settings.neo4j_password_str),
    )
    try:
        async with driver.session() as session:
            result = await session.run(
                "MATCH (d:Document) RETURN DISTINCT d.source AS source ORDER BY source"
            )
            rows = await result.data()
    except Exception as exc:
        logger.exception("graph_sources failed")
        return JSONResponse({"error": str(exc)}, status_code=500)
    finally:
        await driver.close()

    sources = [r["source"] for r in rows if r.get("source")]
    return JSONResponse({"sources": sources})


@router.get("/graph/node/{node_id}/sources")
async def node_sources(node_id: str) -> JSONResponse:
    """Return the document sources and chunk excerpts that mention a specific entity.

    ``node_id`` is the Neo4j internal node ID (string).
    """
    settings = get_settings()
    driver = neo4j.AsyncGraphDatabase.driver(
        settings.neo4j_uri,
        auth=(settings.neo4j_user, settings.neo4j_password_str),
    )
    try:
        async with driver.session() as session:
            result = await session.run(
                """
                MATCH (e)-[:FROM_CHUNK]->(c:Chunk)-[:FROM_DOCUMENT]->(d:Document)
                WHERE id(e) = $node_id
                RETURN d.source AS source,
                       d.page   AS page,
                       c.text   AS excerpt
                ORDER BY d.source, d.page
                LIMIT 20
                """,
                node_id=int(node_id),
            )
            rows = await result.data()
    except Exception as exc:
        logger.exception("node_sources failed for node_id=%s", node_id)
        return JSONResponse({"error": str(exc)}, status_code=500)
    finally:
        await driver.close()

    sources: dict = {}
    for row in rows:
        src = row.get("source") or "unknown"
        if src not in sources:
            sources[src] = {"source": src, "pages": [], "excerpts": []}
        page = row.get("page")
        if page and page not in sources[src]["pages"]:
            sources[src]["pages"].append(page)
        excerpt = (row.get("excerpt") or "")[:200]
        if excerpt:
            sources[src]["excerpts"].append(excerpt)

    return JSONResponse({"node_id": node_id, "sources": list(sources.values())})
