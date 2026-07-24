from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel


class DatasourceNodeRunApiEntity(BaseModel):
    pipeline_id: str
    node_id: str
    inputs: dict[str, Any]
    datasource_type: str
    credential_id: str | None = None
    is_published: bool


class PipelineRunApiEntity(BaseModel):
    inputs: Mapping[str, Any]
    datasource_type: str
    datasource_info_list: list[Mapping[str, Any]]
    start_node_id: str
    is_published: bool
    response_mode: str
