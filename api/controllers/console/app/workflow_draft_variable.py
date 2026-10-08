from typing import Any, Self
from uuid import UUID

from flask import Response
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, model_validator

from controllers.common.fields import SimpleResultResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.workflow_variable_admission import console_variable_admission
from controllers.console.wraps import (
    RBACPermission,
    model_validate,
)
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from fields.workflow_draft_variable_fields import (
    WorkflowDraftVariableFullContentResponse,
    WorkflowDraftVariableListResponse,
    WorkflowDraftVariableListWithoutValueResponse,
    WorkflowDraftVariableResponse,
    WorkflowDraftVariableWithoutValueResponse,
)
from libs.helper import dump_response
from machinery.context import RequestContext
from services.workflow.contracts import WorkflowOwner


class WorkflowDraftVariableListQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=100_000, description="Page number")
    limit: int = Field(default=20, ge=1, le=100, description="Items per page")


class WorkflowDraftVariableUpdatePayload(BaseModel):
    name: str | None = Field(default=None, description="Variable name")
    value: Any | None = Field(default=None, description="Variable value")


class WorkflowVariableItemPayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str | None = None
    name: str | None = None
    value_type: str | None = None
    value: Any | None = None
    description: str | None = None


class ConversationVariableItemPayload(WorkflowVariableItemPayload):
    pass


class EnvironmentVariableItemPayload(WorkflowVariableItemPayload):
    pass


class ConversationVariableUpdatePayload(BaseModel):
    conversation_variables: list[ConversationVariableItemPayload] = Field(
        ...,
        description="Conversation variables for the draft workflow",
    )


class EnvironmentVariableUpdatePayload(BaseModel):
    environment_variables: list[EnvironmentVariableItemPayload] = Field(
        ...,
        description="Environment variables for the draft workflow",
    )
    patch: bool = Field(
        default=False,
        description="Treat environment_variables as per-ID upserts instead of replacing the full collection",
    )
    deleted_environment_variable_ids: list[str] = Field(
        default_factory=list,
        description="Environment variable IDs to delete when patch is true",
    )

    @model_validator(mode="after")
    def validate_patch(self) -> Self:
        """Validate the per-variable patch contract without changing legacy replacement requests."""
        if not self.patch:
            if self.deleted_environment_variable_ids:
                raise ValueError("deleted_environment_variable_ids requires patch=true")
            return self

        upsert_ids = [variable.id for variable in self.environment_variables]
        if any(not variable_id for variable_id in upsert_ids):
            raise ValueError("patched environment variables require an id")
        if len(set(upsert_ids)) != len(upsert_ids):
            raise ValueError("patched environment variable ids must be unique")
        if any(not variable_id for variable_id in self.deleted_environment_variable_ids):
            raise ValueError("deleted environment variable ids must not be empty")
        if len(set(self.deleted_environment_variable_ids)) != len(self.deleted_environment_variable_ids):
            raise ValueError("deleted environment variable ids must be unique")
        if set(upsert_ids).intersection(self.deleted_environment_variable_ids):
            raise ValueError("an environment variable cannot be upserted and deleted in the same patch")
        return self


class EnvironmentVariableItemResponse(ResponseModel):
    id: str
    type: str
    name: str
    description: str | None = None
    selector: list[str]
    value_type: str
    value: Any
    edited: bool
    visible: bool
    editable: bool


class EnvironmentVariableListResponse(ResponseModel):
    items: list[EnvironmentVariableItemResponse]


register_schema_models(
    console_ns,
    WorkflowDraftVariableListQuery,
    WorkflowDraftVariableUpdatePayload,
    ConversationVariableItemPayload,
    ConversationVariableUpdatePayload,
    EnvironmentVariableItemPayload,
    EnvironmentVariableUpdatePayload,
)
register_response_schema_models(console_ns, SimpleResultResponse, EnvironmentVariableListResponse)
register_response_schema_models(
    console_ns,
    WorkflowDraftVariableFullContentResponse,
    WorkflowDraftVariableWithoutValueResponse,
    WorkflowDraftVariableResponse,
    WorkflowDraftVariableListWithoutValueResponse,
    WorkflowDraftVariableListResponse,
)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/variables")
class WorkflowVariableCollectionApi(Resource):
    @console_ns.doc(params=query_params_from_model(WorkflowDraftVariableListQuery))
    @console_ns.doc("get_workflow_variables")
    @console_ns.doc(description="Get draft workflow variables")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params={"page": "Page number (1-100000)", "limit": "Number of items per page (1-100)"})
    @console_ns.response(
        200,
        "Workflow variables retrieved successfully",
        console_ns.models[WorkflowDraftVariableListWithoutValueResponse.__name__],
    )
    @console_variable_admission("app")
    @model_validate(WorkflowDraftVariableListQuery)
    def get(self, req_data: WorkflowDraftVariableListQuery, request_context: RequestContext, app_id: UUID):
        """List draft workflow variables without loading their values."""
        variables = application_services().console_workflow_variables.list_variables(
            request_context, WorkflowOwner(str(app_id), "app"), page=req_data.page, limit=req_data.limit
        )
        return dump_response(WorkflowDraftVariableListWithoutValueResponse, variables)

    @console_ns.doc("delete_workflow_variables")
    @console_ns.doc(description="Delete all draft workflow variables")
    @console_ns.response(204, "Workflow variables deleted successfully")
    @console_variable_admission("app")
    def delete(self, request_context: RequestContext, app_id: UUID):
        application_services().console_workflow_variables.delete_all(request_context, WorkflowOwner(str(app_id), "app"))
        return Response("", 204)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/variables")
class NodeVariableCollectionApi(Resource):
    @console_ns.doc("get_node_variables")
    @console_ns.doc(description="Get variables for a specific node")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.response(
        200,
        "Node variables retrieved successfully",
        console_ns.models[WorkflowDraftVariableListResponse.__name__],
    )
    @console_variable_admission("app")
    def get(self, request_context: RequestContext, app_id: UUID, node_id: str):
        variables = application_services().console_workflow_variables.node(
            request_context, WorkflowOwner(str(app_id), "app"), node_id
        )
        return dump_response(WorkflowDraftVariableListResponse, variables)

    @console_ns.doc("delete_node_variables")
    @console_ns.doc(description="Delete all variables for a specific node")
    @console_ns.response(204, "Node variables deleted successfully")
    @console_variable_admission("app")
    def delete(self, request_context: RequestContext, app_id: UUID, node_id: str):
        application_services().console_workflow_variables.delete_node(
            request_context, WorkflowOwner(str(app_id), "app"), node_id
        )
        return Response("", 204)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/variables/<uuid:variable_id>")
class VariableApi(Resource):
    @console_ns.doc("get_variable")
    @console_ns.doc(description="Get a specific workflow variable")
    @console_ns.doc(params={"app_id": "Application ID", "variable_id": "Variable ID"})
    @console_ns.response(
        200,
        "Variable retrieved successfully",
        console_ns.models[WorkflowDraftVariableResponse.__name__],
    )
    @console_ns.response(404, "Variable not found")
    @console_variable_admission("app")
    def get(self, request_context: RequestContext, app_id: UUID, variable_id: UUID):
        variable = application_services().console_workflow_variables.get(
            request_context, WorkflowOwner(str(app_id), "app"), str(variable_id)
        )
        return dump_response(WorkflowDraftVariableResponse, variable)

    @console_ns.doc("update_variable")
    @console_ns.doc(description="Update a workflow variable")
    @console_ns.expect(console_ns.models[WorkflowDraftVariableUpdatePayload.__name__])
    @console_ns.response(
        200,
        "Variable updated successfully",
        console_ns.models[WorkflowDraftVariableResponse.__name__],
    )
    @console_ns.response(404, "Variable not found")
    @console_variable_admission("app")
    @model_validate(WorkflowDraftVariableUpdatePayload)
    def patch(
        self,
        req_data: WorkflowDraftVariableUpdatePayload,
        request_context: RequestContext,
        app_id: UUID,
        variable_id: UUID,
    ):
        variable = application_services().console_workflow_variables.patch(
            request_context,
            WorkflowOwner(str(app_id), "app"),
            str(variable_id),
            name=req_data.name,
            value=req_data.value,
        )
        return dump_response(WorkflowDraftVariableResponse, variable)

    @console_ns.doc("delete_variable")
    @console_ns.doc(description="Delete a workflow variable")
    @console_ns.response(204, "Variable deleted successfully")
    @console_ns.response(404, "Variable not found")
    @console_variable_admission("app")
    def delete(self, request_context: RequestContext, app_id: UUID, variable_id: UUID):
        application_services().console_workflow_variables.delete(
            request_context, WorkflowOwner(str(app_id), "app"), str(variable_id)
        )
        return Response("", 204)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/variables/<uuid:variable_id>/reset")
class VariableResetApi(Resource):
    @console_ns.doc("reset_variable")
    @console_ns.doc(description="Reset a workflow variable to its default value")
    @console_ns.doc(params={"app_id": "Application ID", "variable_id": "Variable ID"})
    @console_ns.response(
        200,
        "Variable reset successfully",
        console_ns.models[WorkflowDraftVariableResponse.__name__],
    )
    @console_ns.response(204, "Variable reset (no content)")
    @console_ns.response(404, "Variable not found")
    @console_variable_admission("app")
    def put(self, request_context: RequestContext, app_id: UUID, variable_id: UUID):
        variable = application_services().console_workflow_variables.reset(
            request_context, WorkflowOwner(str(app_id), "app"), str(variable_id)
        )
        if variable is None:
            return Response("", 204)
        return dump_response(WorkflowDraftVariableResponse, variable)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/conversation-variables")
class ConversationVariableCollectionApi(Resource):
    @console_ns.doc("get_conversation_variables")
    @console_ns.doc(description="Get conversation variables for workflow")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200,
        "Conversation variables retrieved successfully",
        console_ns.models[WorkflowDraftVariableListResponse.__name__],
    )
    @console_ns.response(404, "Draft workflow not found")
    @console_variable_admission("app")
    def get(self, request_context: RequestContext, app_id: UUID):
        variables = application_services().console_workflow_variables.conversation(
            request_context, WorkflowOwner(str(app_id), "app")
        )
        return dump_response(WorkflowDraftVariableListResponse, variables)

    @console_ns.expect(console_ns.models[ConversationVariableUpdatePayload.__name__])
    @console_ns.doc("update_conversation_variables")
    @console_ns.doc(description="Update conversation variables for workflow draft")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200,
        "Conversation variables updated successfully",
        console_ns.models[SimpleResultResponse.__name__],
    )
    @console_variable_admission("app", permission=RBACPermission.APP_EDIT)
    @model_validate(ConversationVariableUpdatePayload)
    def post(self, req_data: ConversationVariableUpdatePayload, request_context: RequestContext, app_id: UUID):
        values = [variable.model_dump(mode="json", exclude_unset=True) for variable in req_data.conversation_variables]
        application_services().console_workflow_variables.update_conversation(request_context, str(app_id), values)
        return {"result": "success"}


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/system-variables")
class SystemVariableCollectionApi(Resource):
    @console_ns.doc("get_system_variables")
    @console_ns.doc(description="Get system variables for workflow")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200,
        "System variables retrieved successfully",
        console_ns.models[WorkflowDraftVariableListResponse.__name__],
    )
    @console_variable_admission("app")
    def get(self, request_context: RequestContext, app_id: UUID):
        variables = application_services().console_workflow_variables.system(
            request_context, WorkflowOwner(str(app_id), "app")
        )
        return dump_response(WorkflowDraftVariableListResponse, variables)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/environment-variables")
class EnvironmentVariableCollectionApi(Resource):
    @console_ns.doc("get_environment_variables", summary="Get environment variables")
    @console_ns.doc(description="Get environment variables for workflow")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200,
        "Environment variables retrieved successfully",
        console_ns.models[EnvironmentVariableListResponse.__name__],
    )
    @console_ns.response(404, "Draft workflow not found")
    @console_variable_admission("app")
    def get(self, request_context: RequestContext, app_id: UUID):
        items = application_services().console_workflow_variables.environment(
            request_context, WorkflowOwner(str(app_id), "app")
        )
        return dump_response(EnvironmentVariableListResponse, {"items": items})

    @console_ns.expect(console_ns.models[EnvironmentVariableUpdatePayload.__name__])
    @console_ns.doc("update_environment_variables")
    @console_ns.doc(description="Update environment variables for workflow draft")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200,
        "Environment variables updated successfully",
        console_ns.models[SimpleResultResponse.__name__],
    )
    @console_variable_admission("app", permission=RBACPermission.APP_EDIT)
    @model_validate(EnvironmentVariableUpdatePayload)
    def post(self, req_data: EnvironmentVariableUpdatePayload, request_context: RequestContext, app_id: UUID):
        values = [variable.model_dump(mode="json", exclude_unset=True) for variable in req_data.environment_variables]
        application_services().console_workflow_variables.update_environment(
            request_context,
            str(app_id),
            values,
            deleted_ids=req_data.deleted_environment_variable_ids if req_data.patch else None,
        )
        return {"result": "success"}
