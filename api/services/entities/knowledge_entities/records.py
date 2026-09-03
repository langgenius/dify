"""Immutable records shared by knowledge application services."""

from collections.abc import Mapping
from typing import NamedTuple


class DatasetRecord(NamedTuple):
    """Framework- and ORM-independent dataset state used at application boundaries."""

    id: str
    workspace_id: str
    maintainer_id: str | None
    permission: str
    data_source_type: str | None
    indexing_technique: str | None
    embedding_model: str | None
    embedding_model_provider: str | None


class DatasetAccessSnapshot(NamedTuple):
    """Dataset state plus the requesting account's partial-member grant."""

    dataset: DatasetRecord
    actor_has_partial_access: bool


class DocumentRecord(NamedTuple):
    """Document state detached from its SQLAlchemy session."""

    id: str
    workspace_id: str
    dataset_id: str
    name: str
    data_source_type: str
    data_source_info: Mapping[str, object] | None
    enabled: bool
    archived: bool
    indexing_status: str
    batch: str
    doc_form: str
    doc_language: str | None
    dataset_process_rule_id: str | None
    need_summary: bool
    doc_metadata: Mapping[str, object] | None
