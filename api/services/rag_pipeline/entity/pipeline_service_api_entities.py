from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, Field


class DatasourceNodeRunApiEntity(BaseModel):
    pipeline_id: str
    node_id: str
    inputs: dict[str, Any]
    datasource_type: str
    credential_id: str | None = None
    is_published: bool


class PipelineRunApiEntity(BaseModel):
    inputs: Mapping[str, Any] = Field(description="Input values for the pipeline run.")
    datasource_type: str = Field(description="Datasource type to run.")
    datasource_info_list: list[Mapping[str, Any]] = Field(
        description="Datasource records to process.",
        json_schema_extra={
            "items": {
                "type": "object",
                "properties": {
                    "reference": {
                        "description": (
                            "Use the `id` returned by the Upload Pipeline File endpoint. `related_id` is accepted "
                            "as an alias."
                        ),
                        "type": "string",
                    },
                    "name": {"description": "File name. Defaults to `untitled`.", "type": "string"},
                    "workspace_id": {"description": "External platform workspace or database ID.", "type": "string"},
                    "page": {
                        "description": "Page details.",
                        "type": "object",
                        "properties": {
                            "page_id": {"description": "Page identifier.", "type": "string"},
                            "type": {"description": "Page type defined by the datasource plugin.", "type": "string"},
                            "page_name": {"description": "Display name. Defaults to `untitled`.", "type": "string"},
                        },
                    },
                    "credential_id": {
                        "description": "Credential for authenticating with the external platform.",
                        "type": "string",
                    },
                    "url": {"description": "URL to crawl.", "type": "string"},
                    "title": {"description": "Used as the document name. Defaults to `untitled`.", "type": "string"},
                    "id": {"description": "File or folder ID.", "type": "string"},
                    "type": {
                        "description": "Whether this entry is a single file or a folder to expand.",
                        "type": "string",
                    },
                    "bucket": {"description": "Storage bucket name.", "type": "string"},
                },
            }
        },
    )
    start_node_id: str = Field(description="ID of the datasource node where the run starts.")
    is_published: bool = Field(description="Whether to run the published pipeline or the draft pipeline.")
    response_mode: str = Field(description="Response mode. Use `streaming` for SSE or `blocking` for JSON.")
