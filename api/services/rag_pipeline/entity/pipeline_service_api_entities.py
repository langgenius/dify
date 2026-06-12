from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, Field
from pydantic.json_schema import JsonDict

_OPAQUE_JSON_SCHEMA: JsonDict = {"x-dify-opaque": True}


class DatasourceNodeRunApiEntity(BaseModel):
    pipeline_id: str
    node_id: str
    inputs: dict[str, Any] = Field(json_schema_extra=_OPAQUE_JSON_SCHEMA)
    datasource_type: str
    credential_id: str | None = None
    is_published: bool


class PipelineRunApiEntity(BaseModel):
    inputs: Mapping[str, Any] = Field(json_schema_extra=_OPAQUE_JSON_SCHEMA)
    datasource_type: str
    datasource_info_list: list[Mapping[str, Any]] = Field(json_schema_extra=_OPAQUE_JSON_SCHEMA)
    start_node_id: str
    is_published: bool
    response_mode: str
