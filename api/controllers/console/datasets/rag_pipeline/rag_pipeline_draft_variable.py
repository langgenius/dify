from typing import Any
from uuid import UUID

from flask import Response
from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.schema import query_params_from_model, register_schema_models
from controllers.console import console_ns
from controllers.console.app.workflow_draft_variable import (
    EnvironmentVariableListResponse,
)
from controllers.console.app.workflow_variable_admission import console_variable_admission
from controllers.console.wraps import (
    model_validate,
)
from extensions.ext_application_services import application_services
from fields.workflow_draft_variable_fields import (
    WorkflowDraftVariableListResponse,
    WorkflowDraftVariableListWithoutValueResponse,
    WorkflowDraftVariableResponse,
)
from libs.helper import dump_response
from machinery.context import RequestContext
from services.workflow.contracts import WorkflowOwner


class PaginationQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=100_000)
    limit: int = Field(default=20, ge=1, le=100)


class WorkflowDraftVariablePatchPayload(BaseModel):
    name: str | None = None
    value: Any | None = None


register_schema_models(console_ns, PaginationQuery, WorkflowDraftVariablePatchPayload)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/variables")
class RagPipelineVariableCollectionApi(Resource):
    @console_ns.doc(params=query_params_from_model(PaginationQuery))
    @console_ns.response(
        200,
        "Workflow variables retrieved successfully",
        console_ns.models[WorkflowDraftVariableListWithoutValueResponse.__name__],
    )
    @console_variable_admission("pipeline")
    @model_validate(PaginationQuery)
    def get(self, req_data: PaginationQuery, request_context: RequestContext, pipeline_id: UUID):
        """List draft pipeline variables without loading their values."""
        variables = application_services().console_workflow_variables.list_variables(
            request_context, WorkflowOwner(str(pipeline_id), "pipeline"), page=req_data.page, limit=req_data.limit
        )
        return dump_response(WorkflowDraftVariableListWithoutValueResponse, variables)

    @console_ns.response(204, "Workflow variables deleted successfully")
    @console_variable_admission("pipeline")
    def delete(self, request_context: RequestContext, pipeline_id: UUID):
        application_services().console_workflow_variables.delete_all(
            request_context, WorkflowOwner(str(pipeline_id), "pipeline")
        )
        return Response("", 204)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/nodes/<string:node_id>/variables")
class RagPipelineNodeVariableCollectionApi(Resource):
    @console_ns.response(
        200,
        "Node variables retrieved successfully",
        console_ns.models[WorkflowDraftVariableListResponse.__name__],
    )
    @console_variable_admission("pipeline")
    def get(self, request_context: RequestContext, pipeline_id: UUID, node_id: str):
        variables = application_services().console_workflow_variables.node(
            request_context, WorkflowOwner(str(pipeline_id), "pipeline"), node_id
        )
        return dump_response(WorkflowDraftVariableListResponse, variables)

    @console_ns.response(204, "Node variables deleted successfully")
    @console_variable_admission("pipeline")
    def delete(self, request_context: RequestContext, pipeline_id: UUID, node_id: str):
        application_services().console_workflow_variables.delete_node(
            request_context, WorkflowOwner(str(pipeline_id), "pipeline"), node_id
        )
        return Response("", 204)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/variables/<uuid:variable_id>")
class RagPipelineVariableApi(Resource):
    @console_ns.response(
        200,
        "Variable retrieved successfully",
        console_ns.models[WorkflowDraftVariableResponse.__name__],
    )
    @console_variable_admission("pipeline")
    def get(self, request_context: RequestContext, pipeline_id: UUID, variable_id: UUID):
        variable = application_services().console_workflow_variables.get(
            request_context, WorkflowOwner(str(pipeline_id), "pipeline"), str(variable_id)
        )
        return dump_response(WorkflowDraftVariableResponse, variable)

    @console_ns.response(
        200,
        "Variable updated successfully",
        console_ns.models[WorkflowDraftVariableResponse.__name__],
    )
    @console_variable_admission("pipeline")
    @console_ns.expect(console_ns.models[WorkflowDraftVariablePatchPayload.__name__])
    @model_validate(WorkflowDraftVariablePatchPayload)
    def patch(
        self,
        req_data: WorkflowDraftVariablePatchPayload,
        request_context: RequestContext,
        pipeline_id: UUID,
        variable_id: UUID,
    ):
        variable = application_services().console_workflow_variables.patch(
            request_context,
            WorkflowOwner(str(pipeline_id), "pipeline"),
            str(variable_id),
            name=req_data.name,
            value=req_data.value,
        )
        return dump_response(WorkflowDraftVariableResponse, variable)

    @console_ns.response(204, "Variable deleted successfully")
    @console_variable_admission("pipeline")
    def delete(self, request_context: RequestContext, pipeline_id: UUID, variable_id: UUID):
        application_services().console_workflow_variables.delete(
            request_context, WorkflowOwner(str(pipeline_id), "pipeline"), str(variable_id)
        )
        return Response("", 204)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/variables/<uuid:variable_id>/reset")
class RagPipelineVariableResetApi(Resource):
    @console_ns.response(
        200,
        "Variable reset successfully",
        console_ns.models[WorkflowDraftVariableResponse.__name__],
    )
    @console_ns.response(204, "Variable reset (no content)")
    @console_variable_admission("pipeline")
    def put(self, request_context: RequestContext, pipeline_id: UUID, variable_id: UUID):
        variable = application_services().console_workflow_variables.reset(
            request_context, WorkflowOwner(str(pipeline_id), "pipeline"), str(variable_id)
        )
        if variable is None:
            return Response("", 204)
        return dump_response(WorkflowDraftVariableResponse, variable)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/system-variables")
class RagPipelineSystemVariableCollectionApi(Resource):
    @console_ns.response(
        200,
        "System variables retrieved successfully",
        console_ns.models[WorkflowDraftVariableListResponse.__name__],
    )
    @console_variable_admission("pipeline")
    def get(self, request_context: RequestContext, pipeline_id: UUID):
        variables = application_services().console_workflow_variables.system(
            request_context, WorkflowOwner(str(pipeline_id), "pipeline")
        )
        return dump_response(WorkflowDraftVariableListResponse, variables)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/draft/environment-variables")
class RagPipelineEnvironmentVariableCollectionApi(Resource):
    @console_ns.doc(summary="Get environment variables")
    @console_ns.response(
        200,
        "Environment variables retrieved successfully",
        console_ns.models[EnvironmentVariableListResponse.__name__],
    )
    @console_variable_admission("pipeline")
    def get(self, request_context: RequestContext, pipeline_id: UUID):
        items = application_services().console_workflow_variables.environment(
            request_context, WorkflowOwner(str(pipeline_id), "pipeline")
        )
        return dump_response(EnvironmentVariableListResponse, {"items": items})
