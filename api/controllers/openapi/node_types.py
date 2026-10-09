"""Node types the server can run: server knowledge, not workspace data."""

from __future__ import annotations

from collections.abc import Mapping
from http import HTTPStatus
from typing import Any, get_args

from flask_restx import Resource
from pydantic import BaseModel, ValidationError

from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint
from controllers.openapi._errors import NodeTypeNotFound
from controllers.openapi._models import NodeTypeDetailResponse, NodeTypeListResponse, NodeTypeRow
from controllers.openapi.auth.context import Context
from core.workflow.node_factory import LATEST_VERSION, get_node_type_classes_mapping
from graphon.nodes.base.node import Node
from services.workflow_service import WorkflowService


def _model_of(annotation: object) -> type[BaseModel] | None:
    for candidate in (annotation, *get_args(annotation)):
        if isinstance(candidate, type) and issubclass(candidate, BaseModel):
            return candidate
    return None


def _complete_default_config(node_class: type[Node], default_config: Mapping[str, Any]) -> dict[str, Any]:
    """Add the keys each sub-object's model defaults; keys the default already has win."""
    config = default_config.get("config")
    if not isinstance(config, Mapping):
        return dict(default_config)
    fields = node_class._get_node_data_type().model_fields
    completed = dict(config)
    for key, value in config.items():
        field = fields.get(key)
        model = _model_of(field.annotation) if field else None
        if model is None or not isinstance(value, Mapping):
            continue
        try:
            filled = model.model_validate(value).model_dump(mode="json")
        except ValidationError:
            continue
        completed[key] = {**filled, **value}
    return {**default_config, "config": completed}


@openapi_ns.route("/node-types")
class NodeTypeListApi(Resource):
    @endpoint(
        op="get.node_type",
        kind=Kind.OBJECT,
        summary="Every node type this server can run; import decides which a mode allows",
        examples=(Example(title="List node types", input={}),),
        requirements=(),
        returns=(HTTPStatus.OK, NodeTypeListResponse, "Node types"),
    )
    def get(self, ctx: Context):
        rows = [
            NodeTypeRow(type=str(node_type), version=versions[LATEST_VERSION].version())
            for node_type, versions in get_node_type_classes_mapping().items()
        ]
        return NodeTypeListResponse(data=sorted(rows, key=lambda row: row.type))


@openapi_ns.route("/node-types/<string:node_type>")
class NodeTypeDetailApi(Resource):
    @endpoint(
        op="describe.node_type",
        kind=Kind.OBJECT,
        summary="The JSON schema of a node type's data and its default config",
        examples=(Example(title="Describe the LLM node", input={"node_type": "llm"}),),
        requirements=(),
        returns=(HTTPStatus.OK, NodeTypeDetailResponse, "Node type"),
    )
    def get(self, ctx: Context, node_type: str):
        node_class = get_node_type_classes_mapping().get(node_type, {}).get(LATEST_VERSION)
        if node_class is None:
            raise NodeTypeNotFound()
        return NodeTypeDetailResponse(
            type=node_type,
            version=node_class.version(),
            schema=node_class._get_node_data_type().model_json_schema(),
            default_config=_complete_default_config(node_class, WorkflowService().get_default_block_config(node_type)),
        )
