"""Framework-neutral contracts for Service API knowledge pipeline workflows."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(frozen=True, slots=True)
class PipelineInvocationScope:
    workspace_id: str
    actor_id: str
    dataset_id: str | None = None
    pipeline_id: str | None = None

    def __post_init__(self) -> None:
        if (self.dataset_id is None) == (self.pipeline_id is None):
            raise ValueError("Exactly one pipeline resource identifier is required")


@dataclass(frozen=True, slots=True)
class DatasourceNodeRun:
    inputs: Mapping[str, Any]
    datasource_type: str
    is_published: bool
    credential_id: str | None = None


@dataclass(frozen=True, slots=True)
class PipelineRun:
    values: Mapping[str, Any]
    is_published: bool
    streaming: bool


@dataclass(frozen=True, slots=True)
class PreparedDatasourceWorkflowNode:
    tenant_id: str
    account_id: str
    plugin_id: str
    provider_name: str
    datasource_name: str
    variables_map: Mapping[str, Any]
    user_inputs: Mapping[str, Any]
    datasource_type: str
    credential_id: str | None


@dataclass(frozen=True, slots=True)
class PipelineFileUpload:
    filename: str
    content: bytes
    mimetype: str


@dataclass(frozen=True, slots=True)
class PipelineUploadedFile:
    id: str
    name: str
    size: int
    extension: str
    mime_type: str | None
    created_by: str
    created_at: datetime | None
