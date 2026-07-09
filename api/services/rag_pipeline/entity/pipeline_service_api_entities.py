from collections.abc import Mapping
from typing import Annotated, Any

from pydantic import BaseModel, Field, WithJsonSchema

DatasourceType = Annotated[
    str,
    WithJsonSchema({"enum": ["local_file", "online_document", "website_crawl", "online_drive"], "type": "string"}),
]
PipelineResponseMode = Annotated[
    str,
    WithJsonSchema({"enum": ["streaming", "blocking"], "type": "string"}),
]
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
                                    "Use the `id` returned by the "
                                    "[Upload Pipeline File](/api-reference/knowledge-pipeline/upload-pipeline-file) "
                                    "endpoint. `related_id` is accepted as an alias."
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
                                    "provider's default credential is used."
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


class DatasourceNodeRunApiEntity(BaseModel):
    pipeline_id: str
    node_id: str
    inputs: dict[str, Any]
    datasource_type: DatasourceType
    credential_id: str | None = None
    is_published: bool


class PipelineRunApiEntity(BaseModel):
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
        description="Response mode. Use `streaming` for SSE or `blocking` for JSON."
    )
