"""Request and response schemas for Service API RAG pipeline endpoints."""

from collections.abc import Mapping
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any

from pydantic import BaseModel, Field, RootModel, WithJsonSchema, field_validator

from core.entities.knowledge_entities import PipelineDataset, PipelineDocument
from fields.base import ResponseModel
from fields.workflow_fields import WorkflowBlockingResponse


class DatasourceType(StrEnum):
    LOCAL_FILE = "local_file"
    ONLINE_DOCUMENT = "online_document"
    WEBSITE_CRAWL = "website_crawl"
    ONLINE_DRIVE = "online_drive"


class PipelineResponseMode(StrEnum):
    STREAMING = "streaming"
    BLOCKING = "blocking"


DatasourceInfoList = Annotated[
    list[Mapping[str, Any]],
    WithJsonSchema(
        {
            "items": {
                "oneOf": [
                    {
                        "properties": {
                            "reference": {
                                "description": (
                                    "Use the `id` returned by the dataset-scoped Upload Pipeline File endpoint when "
                                    "using a resource token. `related_id` is accepted as an alias."
                                ),
                                "type": "string",
                            },
                            "name": {"description": "Document title. Defaults to `untitled`.", "type": "string"},
                        },
                        "required": ["reference"],
                        "title": "Local File",
                        "type": "object",
                    },
                    {
                        "properties": {
                            "workspace_id": {
                                "description": "ID of the workspace or database in the external platform.",
                                "type": "string",
                            },
                            "page": {
                                "description": "Page details.",
                                "properties": {
                                    "page_id": {"description": "Page identifier.", "type": "string"},
                                    "type": {
                                        "description": "Page type defined by the datasource plugin.",
                                        "type": "string",
                                    },
                                    "page_name": {
                                        "description": "Display name. Defaults to `untitled`.",
                                        "type": "string",
                                    },
                                },
                                "required": ["page_id", "type"],
                                "type": "object",
                            },
                            "credential_id": {
                                "description": (
                                    "Credential for authenticating with the external platform. If omitted, the "
                                    "requesting actor's visible default credential is used."
                                ),
                                "type": "string",
                            },
                        },
                        "required": ["workspace_id", "page"],
                        "title": "Online Document",
                        "type": "object",
                    },
                    {
                        "properties": {
                            "url": {"description": "URL to crawl.", "type": "string"},
                            "title": {
                                "description": "Used as the document name. Defaults to `untitled`.",
                                "type": "string",
                            },
                        },
                        "required": ["url"],
                        "title": "Website Crawl",
                        "type": "object",
                    },
                    {
                        "properties": {
                            "id": {"description": "File or folder ID.", "type": "string"},
                            "type": {
                                "description": "Whether this entry is a single file or a folder to expand.",
                                "enum": ["file", "folder"],
                                "type": "string",
                            },
                            "bucket": {
                                "description": (
                                    "Storage bucket name. Required by some drive providers, such as S3-compatible "
                                    "stores; omit if the provider does not use buckets."
                                ),
                                "type": "string",
                            },
                            "name": {"description": "File name. Defaults to `untitled`.", "type": "string"},
                            "credential_id": {
                                "description": (
                                    "Credential for authenticating with the drive provider. If omitted, the "
                                    "requesting actor's visible default credential is used."
                                ),
                                "type": "string",
                            },
                        },
                        "required": ["id", "type"],
                        "title": "Online Drive",
                        "type": "object",
                    },
                ]
            },
            "type": "array",
        }
    ),
]


class DatasourceNodeRunPayload(BaseModel):
    inputs: dict[str, Any] = Field(description="Input variables for the datasource node.")
    datasource_type: DatasourceType = Field(description="Type of the datasource.")
    credential_id: str | None = Field(
        default=None, description="Datasource credential ID. Uses the default if omitted."
    )
    is_published: bool = Field(
        description=(
            "Whether to run the published or draft version of the node. `true` runs the published version, "
            "`false` runs the draft."
        )
    )


class PipelineRunPayload(BaseModel):
    inputs: Mapping[str, Any] = Field(
        description=(
            "Key-value pairs for pipeline input variables defined in the workflow. Pass `{}` if the pipeline has "
            "no input variables."
        )
    )
    datasource_type: DatasourceType = Field(
        description="Type of the datasource. Determines which fields are expected in `datasource_info_list` items."
    )
    datasource_info_list: DatasourceInfoList = Field(
        description="List of datasource objects to process. The expected item structure depends on `datasource_type`."
    )
    start_node_id: str = Field(description="ID of the datasource node where the run starts.")
    is_published: bool = Field(
        description=(
            "Whether to run the published or draft version of the pipeline. `true` runs the latest published "
            "version; `false` runs the current draft (useful for testing unpublished changes)."
        )
    )
    response_mode: PipelineResponseMode = Field(
        description=(
            "Response mode for draft runs. Use `streaming` for SSE or `blocking` for JSON. Published runs are queued "
            "and always return batch metadata as JSON."
        )
    )


class DatasourcePluginsQuery(BaseModel):
    is_published: bool = Field(
        default=True,
        description=(
            "Whether to retrieve nodes from the published or draft pipeline. `true` returns nodes from the published "
            "version, `false` returns nodes from the draft."
        ),
    )


class DatasourceCredentialInfoResponse(ResponseModel):
    id: str | None = None
    name: str | None = None
    type: str | None = None
    is_default: bool | None = None


class DatasourcePluginResponse(ResponseModel):
    node_id: str | None = None
    plugin_id: str | None = None
    provider_name: str | None = None
    datasource_type: str | None = None
    title: str | None = None
    user_input_variables: list[dict[str, Any]] = Field(default_factory=list)
    credentials: list[DatasourceCredentialInfoResponse] = Field(default_factory=list)


class DatasourcePluginListResponse(RootModel[list[DatasourcePluginResponse]]):
    pass


class PipelineUploadFileResponse(ResponseModel):
    id: str
    name: str
    size: int
    extension: str
    mime_type: str | None = None
    created_by: str
    created_at: str | None = None

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | str | None) -> str | None:
        if isinstance(value, datetime):
            return value.isoformat()
        return value


class PublishedPipelineRunResponse(ResponseModel):
    batch: str
    dataset: PipelineDataset
    documents: list[PipelineDocument]


class PipelineRunJsonResponse(RootModel[PublishedPipelineRunResponse | WorkflowBlockingResponse]):
    """JSON result for published runs and draft runs using `response_mode: blocking`."""
