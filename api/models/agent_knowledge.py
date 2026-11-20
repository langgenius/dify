"""Pure ID normalization for Agent knowledge datasets."""

from uuid import UUID

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
            if dataset_id and dataset_id not in seen:
                seen.add(dataset_id)
                dataset_ids.append(dataset_id)
    return dataset_ids


def valid_knowledge_dataset_ids(dataset_ids: list[str]) -> list[str]:
    """Keep only IDs that can be compared to a UUID-backed dataset column."""

    def valid(dataset_id: str) -> bool:
        """Return whether the database can bind the supplied string as a UUID."""
        try:
            UUID(dataset_id)
        except (TypeError, ValueError):
            return False
        return True

    return [dataset_id for dataset_id in dataset_ids if valid(dataset_id)]
