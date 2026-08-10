from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from models.knowledge_fs import KnowledgeFSControlSpace, KnowledgeFSControlSpaceState

from .entities import KNOWLEDGE_RETRIEVAL_V2_NODE_TYPE, KnowledgeRetrievalV2NodeData


def collect_control_space_ids(graph: Mapping[str, Any]) -> tuple[str, ...]:
    nodes = graph.get("nodes", [])
    if not isinstance(nodes, list):
        return ()
    ordered_ids: list[str] = []
    seen: set[str] = set()
    for node in nodes:
        if not isinstance(node, Mapping):
            continue
        data = node.get("data")
        if not isinstance(data, Mapping) or data.get("type") != KNOWLEDGE_RETRIEVAL_V2_NODE_TYPE:
            continue
        node_data = KnowledgeRetrievalV2NodeData.model_validate(data)
        for control_space_id in node_data.control_space_ids:
            if control_space_id not in seen:
                seen.add(control_space_id)
                ordered_ids.append(control_space_id)
    return tuple(ordered_ids)


def missing_control_space_ids(
    *,
    session: Session,
    tenant_id: str,
    graph: Mapping[str, Any],
) -> tuple[str, ...]:
    requested = collect_control_space_ids(graph)
    if not requested:
        return ()
    existing = set(
        session.scalars(
            sa.select(KnowledgeFSControlSpace.id).where(
                KnowledgeFSControlSpace.tenant_id == tenant_id,
                KnowledgeFSControlSpace.id.in_(requested),
                KnowledgeFSControlSpace.state == KnowledgeFSControlSpaceState.ACTIVE,
            )
        )
    )
    return tuple(control_space_id for control_space_id in requested if control_space_id not in existing)


def validate_control_space_references(
    *,
    session: Session,
    tenant_id: str,
    graph: Mapping[str, Any],
) -> None:
    missing = missing_control_space_ids(session=session, tenant_id=tenant_id, graph=graph)
    if missing:
        raise ValueError("KnowledgeFS Spaces are missing or inactive in this workspace: " + ", ".join(missing))


__all__ = [
    "collect_control_space_ids",
    "missing_control_space_ids",
    "validate_control_space_references",
]
