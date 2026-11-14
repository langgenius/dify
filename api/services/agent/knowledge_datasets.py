from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from models.agent_config_entities import AgentSoulConfig
from models.agent_knowledge import list_agent_soul_knowledge_dataset_ids, valid_knowledge_dataset_ids


def get_tenant_knowledge_dataset_rows(*, session: Session, tenant_id: str, dataset_ids: list[str]) -> dict[str, Any]:
    """Return tenant-scoped dataset rows for normalized knowledge dataset ids.

    Knowledge ids come from user-editable config. Malformed ids can never match
    a dataset row, so they are treated as missing instead of breaking the
    UUID-typed dataset lookup.
    """
    from services.knowledge.dataset_service import DatasetService

    valid_ids = valid_knowledge_dataset_ids(dataset_ids)
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
