"""Node types the server can run: server knowledge, not workspace data."""

from __future__ import annotations

from http import HTTPStatus
from typing import Final

from flask_restx import Resource

from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint
from controllers.openapi._errors import NodeTypeNotFound
from controllers.openapi._models import (
    NodeTypeDescribeQuery,
    NodeTypeDetailResponse,
    NodeTypeFieldRow,
    NodeTypeListResponse,
    NodeTypeRow,
)
from controllers.openapi.auth.context import Context
from core.workflow.node_factory import LATEST_VERSION, get_node_type_classes_mapping
from services.workflow.authoring.canvas_defaults import purpose_fields
from services.workflow.authoring.node_options import block_seed
from services.workflow.authoring.node_spec import NodeTarget, top_level_hints
from services.workflow.node_defaults import node_data_schema
from services.workflow_variable_reference_validator import source_handle_order

# The response and the seed already carry these.
_IDENTITY_FIELDS: Final = frozenset({"type", "title", "version", "desc"})


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
        summary="A node type's seed, its fields and its handles; the full data schema on request",
        examples=(
            Example(title="Describe the LLM node", input={"node_type": "llm"}),
            Example(title="Also get its JSON schema", input={"node_type": "llm", "include_schema": True}),
        ),
        requirements=(),
        query=NodeTypeDescribeQuery,
        returns=(HTTPStatus.OK, NodeTypeDetailResponse, "Node type"),
    )
    def get(self, ctx: Context, node_type: str, *, query: NodeTypeDescribeQuery):
        node_class = get_node_type_classes_mapping().get(node_type, {}).get(LATEST_VERSION)
        if node_class is None:
            raise NodeTypeNotFound()
        version = node_class.version()
        seed = block_seed(node_type, version)
        schema = node_data_schema(node_class)
        target = NodeTarget(id="", data=seed, node_class=node_class, top_level=True, references=())
        purposes = purpose_fields(node_type, version)
        return NodeTypeDetailResponse(
            type=node_type,
            version=version,
            seed=seed,
            fields=[
                NodeTypeFieldRow.describing(hint, purpose=hint.loc[0] in purposes)
                for hint in top_level_hints(target, schema, skip=_IDENTITY_FIELDS)
            ],
            handles=list(source_handle_order(seed)),
            schema=schema if query.include_schema else None,
        )
