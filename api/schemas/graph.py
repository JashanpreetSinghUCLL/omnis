"""Request and response types for GET /v1/graph/explore (NDJSON streaming).

Wire format
-----------
The endpoint streams NDJSON — one JSON object per line, no trailing comma.
Event sequence: N × node events, M × edge events, 1 × done event.

Event types (the ``type`` field discriminates the union)
---------------------------------------------------------
node  — a graph entity (id, label, entity_type, degree, optional pre-computed x/y)
edge  — a directed relationship between two nodes
done  — stream terminator; carries aggregate counts
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ── Query params ─────────────────────────────────────────────────────────────


class GraphExploreParams(BaseModel):
    """Validated query parameters for the explore endpoint."""

    tenant_id: str = Field(default="default")
    entity_type: str | None = Field(default=None, description="Filter by entity type label")
    depth: int = Field(default=2, ge=1, le=4, description="Traversal depth from seed nodes")
    limit: int = Field(default=500, ge=1, le=2000, description="Max nodes to return")
    cursor: str | None = Field(default=None, description="Opaque pagination cursor (node id)")


# ── NDJSON event payloads ─────────────────────────────────────────────────────


class GraphNodeEvent(BaseModel):
    """A single graph entity streamed to the client."""

    type: Literal["node"] = "node"
    id: str
    label: str
    entity_type: str
    degree: int = 0
    # Pre-computed ForceAtlas2 coordinates from ingestion time.
    # None when the graph has not been laid out server-side yet.
    x: float | None = None
    y: float | None = None


class GraphEdgeEvent(BaseModel):
    """A directed relationship between two entities."""

    type: Literal["edge"] = "edge"
    source: str
    target: str
    relation: str | None = None


class GraphDoneEvent(BaseModel):
    """Stream terminator — sent once after all node/edge events."""

    type: Literal["done"] = "done"
    total_nodes: int
    total_edges: int


# Union used by callers that handle the full stream
GraphStreamEvent = GraphNodeEvent | GraphEdgeEvent | GraphDoneEvent
