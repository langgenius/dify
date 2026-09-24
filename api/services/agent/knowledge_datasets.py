from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from models.agent_config_entities import AgentSoulConfig


def list_agent_soul_knowledge_dataset_ids(agent_soul: AgentSoulConfig) -> list[str]:
    """Return normalized unique knowledge dataset ids in config order.

    Agent v2 knowledge dataset selection is owned by ``knowledge.sets``. This
    helper keeps composer, workflow validation, candidates, and runtime
    diagnostics aligned on the same normalization rules: strip whitespace, drop
    blanks, preserve first-seen order, and deduplicate.
    """
    dataset_ids: list[str] = []
    seen: set[str] = set()
    for knowledge_set in agent_soul.knowledge.sets:
        for dataset in knowledge_set.datasets:
            dataset_id = (dataset.id or "").strip()
            if not dataset_id or dataset_id in seen:
                continue
            seen.add(dataset_id)
            dataset_ids.append(dataset_id)
    return dataset_ids


def get_tenant_knowledge_dataset_rows(*, session: Session, tenant_id: str, dataset_ids: list[str]) -> dict[str, Any]:
    """Return tenant-scoped dataset rows for normalized knowledge dataset ids.

    Knowledge ids come from user-editable config. Malformed ids can never match
    a dataset row, so they are treated as missing instead of breaking the
    UUID-typed dataset lookup.
    """
    from services.dataset_service import DatasetService

    valid_ids: list[str] = []
    for dataset_id in dataset_ids:
        try:
            UUID(dataset_id)
        except (TypeError, ValueError):
            continue
        valid_ids.append(dataset_id)

    if not valid_ids:
        return {}

    rows, _ = DatasetService.get_datasets_by_ids(valid_ids, tenant_id, session=session)
    return {str(row.id): row for row in rows}


def list_missing_tenant_knowledge_dataset_ids(
    *, session: Session, tenant_id: str, agent_soul: AgentSoulConfig | None
) -> list[str]:
    """Return normalized knowledge dataset ids missing from the tenant scope."""
    if agent_soul is None:
        return []

    dataset_ids = list_agent_soul_knowledge_dataset_ids(agent_soul)
    if not dataset_ids:
        return []

    rows = get_tenant_knowledge_dataset_rows(session=session, tenant_id=tenant_id, dataset_ids=dataset_ids)
    return [dataset_id for dataset_id in dataset_ids if dataset_id not in rows]
