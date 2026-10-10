"""Materialized dataset read contracts, independent of persistence and HTTP.

Timestamps remain datetimes until transport serialization. JSON configuration
objects retain their stored keys; this boundary does not apply response defaults.
"""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import NotRequired, TypedDict

from pydantic import JsonValue


class DatasetTagRecord(TypedDict):
    id: str
    name: str
    type: str


class DatasetDetailRecord(TypedDict):
    id: str
    name: str
    description: str | None
    provider: str
    permission: str
    data_source_type: str | None
    indexing_technique: str | None
    app_count: int
    document_count: int
    word_count: int
    created_by: str
    author_name: str | None
    created_at: datetime
    updated_by: str | None
    updated_at: datetime
    embedding_model: str | None
    embedding_model_provider: str | None
    # None means availability has not been evaluated by the application service.
    embedding_available: bool | None
    retrieval_model_dict: Mapping[str, JsonValue]
    summary_index_setting: Mapping[str, JsonValue] | None
    graph_index_setting: Mapping[str, JsonValue] | None
    tags: list[DatasetTagRecord]
    doc_form: str | None
    external_knowledge_info: Mapping[str, JsonValue] | None
    external_retrieval_model: Mapping[str, JsonValue] | None
    doc_metadata: Sequence[Mapping[str, str]]
    built_in_field_enabled: bool
    pipeline_id: str | None
    runtime_mode: str | None
    chunk_structure: str | None
    icon_info: Mapping[str, JsonValue] | None
    is_published: bool
    total_documents: int
    total_available_documents: int
    enable_api: bool
    is_multimodal: bool
    permission_keys: list[str]
    maintainer: str | None
    # Detail/create responses may omit membership or explicitly return null;
    # listing and updates materialize a list, including an empty one.
    partial_member_list: NotRequired[list[str] | None]


class DatasetPage(TypedDict):
    data: list[DatasetDetailRecord]
    has_more: bool
    total: int
    page: int
    limit: int
