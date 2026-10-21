"""Shared data contracts for dataset administration use cases."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any


class DatasetDetailProjection(StrEnum):
    CORE = "core"
    CONSOLE = "console"


class DatasetConcurrentUpdateError(RuntimeError):
    """The dataset changed after model settings were prepared."""


class DatasetNameConflictError(RuntimeError):
    """A dataset with the requested name already exists in the workspace."""


class DatasetCreationRecoveryError(RuntimeError):
    def __init__(self, dataset_id: str):
        super().__init__(f"Dataset {dataset_id} was created but could not be rolled back after access setup failed")
        self.dataset_id = dataset_id


@dataclass(frozen=True)
class DatasetUpdateSnapshot:
    """Dataset state whose changes can invalidate prepared update settings."""

    provider: str
    indexing_technique: str | None
    embedding_model_provider: str | None
    embedding_model: str | None
    updated_at: datetime
    name: str
    permission: str
    collection_binding_id: str | None
    runtime_mode: str | None
    pipeline_id: str | None
    chunk_structure: str | None
    keyword_number: int | None
    retrieval_model: Mapping[str, Any] | None
    summary_index_setting: Mapping[str, Any] | None
    is_multimodal: bool


class DatasetIndexAction(StrEnum):
    ADD = "add"
    REMOVE = "remove"
    UPDATE = "update"


@dataclass(frozen=True)
class DatasetPermissionChangeSnapshot:
    actor_role: str | None
    current_permission: str
    current_member_ids: tuple[str, ...]


@dataclass(frozen=True)
class DatasetCreateMutation:
    tenant_id: str
    actor_id: str
    name: str
    description: str | None
    indexing_technique: str | None
    permission: str
    provider: str
    external_knowledge_api_id: str | None = None
    external_knowledge_id: str | None = None
    embedding_model_provider: str | None = None
    embedding_model: str | None = None
    retrieval_model: Mapping[str, Any] | None = None
    summary_index_setting: Mapping[str, Any] | None = None
    is_multimodal: bool = False


@dataclass(frozen=True)
class DatasetUpdateMutation:
    ref_tenant_id: str
    ref_dataset_id: str
    actor_id: str
    expected: DatasetUpdateSnapshot
    permission_expected: DatasetPermissionChangeSnapshot
    values: Mapping[str, Any]
    index_action: DatasetIndexAction | None = None
    retry_failed_vector_index: bool = False
    partial_member_ids: tuple[str, ...] | None = None
    clear_partial_members: bool = False


@dataclass(frozen=True)
class RagPipelineDatasetCreateMutation:
    tenant_id: str
    actor_id: str
    name: str | None
    description: str
    permission: str
    icon_info: Mapping[str, Any]
    partial_member_ids: tuple[str, ...] | None = None


@dataclass(frozen=True)
class RagPipelineDatasetSettings:
    chunk_structure: str
    indexing_technique: str
    embedding_model_provider: str | None
    embedding_model: str | None
    keyword_number: int | None
    retrieval_model: Mapping[str, Any]
    summary_index_setting: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class PreparedRagPipelineDatasetSettings:
    settings: RagPipelineDatasetSettings
    resolved_embedding_model_provider: str | None
    resolved_embedding_model: str | None
    is_multimodal: bool
    index_action: DatasetIndexAction | None
    retry_failed_vector_index: bool = False


@dataclass(frozen=True)
class PreparedRagPipelineDatasetUpdate:
    tenant_id: str
    dataset_id: str
    actor_id: str
    expected: DatasetUpdateSnapshot
    prepared: PreparedRagPipelineDatasetSettings


@dataclass(frozen=True)
class DatasetListFilter:
    page: int = 1
    limit: int = 20
    keyword: str | None = None
    include_all: bool = False
    ids: Sequence[str] = ()
    tag_ids: Sequence[str] = ()


@dataclass(frozen=True)
class DatasetVisibility:
    default_permissions: Sequence[str] = ()
    workspace_permissions: Sequence[str] = ()
    overrides: Mapping[str, Sequence[str]] = field(default_factory=dict)
    unrestricted: bool = True
    whitelist_ids: Sequence[str] = ()

    def list_scope(self, *, rbac_enabled: bool) -> tuple[list[str] | None, bool]:
        if not rbac_enabled:
            return None, False
        # A restricted whitelist always takes precedence over default grants,
        # resource overrides and the creator's own-dataset fallback.
        if not self.unrestricted:
            return sorted(set(self.whitelist_ids)), False
        read_keys = {"dataset.preview", "dataset.acl.preview", "dataset.full_access"}
        default_read = bool(
            read_keys.intersection(self.default_permissions) or read_keys.intersection(self.workspace_permissions)
        )
        ids = (
            None
            if default_read
            else sorted(key for key, grants in self.overrides.items() if read_keys.intersection(grants))
        )
        return ids, "dataset.create_and_management" in self.workspace_permissions
