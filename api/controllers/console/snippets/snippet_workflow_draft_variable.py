"""
Snippet draft workflow variable APIs.

Mirrors console app routes under /apps/.../workflows/draft/variables for snippet scope,
using CustomizedSnippet.id as WorkflowDraftVariable.app_id (same invariant as snippet execution).

Snippet workflows do not expose system variables (`node_id == sys`) or conversation variables
(`node_id == conversation`): paginated list queries exclude those rows; single-variable GET/PATCH/DELETE/reset
reject them; `GET .../system-variables` and `GET .../conversation-variables` return empty lists for API parity.
Other routes mirror `workflow_draft_variable` app APIs under `/snippets/...`.
"""

from uuid import UUID

from flask import Response
from flask_restx import Resource

from controllers.common.schema import query_params_from_model
from controllers.console import console_ns
from controllers.console.app.workflow_draft_variable import (
    EnvironmentVariableListResponse,
    WorkflowDraftVariableListQuery,
    WorkflowDraftVariableUpdatePayload,
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


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/variables")
class SnippetWorkflowVariableCollectionApi(Resource):
    @console_ns.doc(params=query_params_from_model(WorkflowDraftVariableListQuery))
    @console_ns.doc("get_snippet_workflow_variables")
    @console_ns.doc(description="List draft workflow variables without values (paginated, snippet scope)")
    @console_ns.response(
        200,
        "Workflow variables retrieved successfully",
        console_ns.models[WorkflowDraftVariableListWithoutValueResponse.__name__],
    )
    @console_variable_admission("snippet")
    @model_validate(WorkflowDraftVariableListQuery)
    def get(self, req_data: WorkflowDraftVariableListQuery, request_context: RequestContext, snippet_id: UUID):
        variables = application_services().console_workflow_variables.list_variables(
            request_context, WorkflowOwner(str(snippet_id), "snippet"), page=req_data.page, limit=req_data.limit
        )
        return dump_response(WorkflowDraftVariableListWithoutValueResponse, variables)

    @console_ns.doc("delete_snippet_workflow_variables")
    @console_ns.doc(description="Delete all draft workflow variables for the current user (snippet scope)")
    @console_ns.response(204, "Workflow variables deleted successfully")
    @console_variable_admission("snippet")
    def delete(self, request_context: RequestContext, snippet_id: UUID):
        application_services().console_workflow_variables.delete_all(
            request_context, WorkflowOwner(str(snippet_id), "snippet")
        )
        return Response("", 204)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/variables")
class SnippetNodeVariableCollectionApi(Resource):
    @console_ns.doc("get_snippet_node_variables")
    @console_ns.doc(description="Get variables for a specific node (snippet draft workflow)")
    @console_ns.response(
        200,
        "Node variables retrieved successfully",
        console_ns.models[WorkflowDraftVariableListResponse.__name__],
    )
    @console_variable_admission("snippet")
    def get(self, request_context: RequestContext, snippet_id: UUID, node_id: str):
        variables = application_services().console_workflow_variables.node(
            request_context, WorkflowOwner(str(snippet_id), "snippet"), node_id
        )
        return dump_response(WorkflowDraftVariableListResponse, variables)

    @console_ns.doc("delete_snippet_node_variables")
    @console_ns.doc(description="Delete all variables for a specific node (snippet draft workflow)")
    @console_ns.response(204, "Node variables deleted successfully")
    @console_variable_admission("snippet")
    def delete(self, request_context: RequestContext, snippet_id: UUID, node_id: str):
        application_services().console_workflow_variables.delete_node(
            request_context, WorkflowOwner(str(snippet_id), "snippet"), node_id
        )
        return Response("", 204)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/variables/<uuid:variable_id>")
class SnippetVariableApi(Resource):
    @console_ns.doc("get_snippet_workflow_variable")
    @console_ns.doc(description="Get a specific draft workflow variable (snippet scope)")
    @console_ns.response(
        200,
        "Variable retrieved successfully",
        console_ns.models[WorkflowDraftVariableResponse.__name__],
    )
    @console_ns.response(404, "Variable not found")
    @console_variable_admission("snippet")
    def get(self, request_context: RequestContext, snippet_id: UUID, variable_id: UUID):
        variable = application_services().console_workflow_variables.get(
            request_context, WorkflowOwner(str(snippet_id), "snippet"), str(variable_id)
        )
        return dump_response(WorkflowDraftVariableResponse, variable)

    @console_ns.doc("update_snippet_workflow_variable")
    @console_ns.doc(description="Update a draft workflow variable (snippet scope)")
    @console_ns.expect(console_ns.models[WorkflowDraftVariableUpdatePayload.__name__])
    @console_ns.response(
        200,
        "Variable updated successfully",
        console_ns.models[WorkflowDraftVariableResponse.__name__],
    )
    @console_ns.response(404, "Variable not found")
    @console_variable_admission("snippet")
    @model_validate(WorkflowDraftVariableUpdatePayload)
    def patch(
        self,
        req_data: WorkflowDraftVariableUpdatePayload,
        request_context: RequestContext,
        snippet_id: UUID,
        variable_id: UUID,
    ):
        variable = application_services().console_workflow_variables.patch(
            request_context,
            WorkflowOwner(str(snippet_id), "snippet"),
            str(variable_id),
            name=req_data.name,
            value=req_data.value,
        )
        return dump_response(WorkflowDraftVariableResponse, variable)

    @console_ns.doc("delete_snippet_workflow_variable")
    @console_ns.doc(description="Delete a draft workflow variable (snippet scope)")
    @console_ns.response(204, "Variable deleted successfully")
    @console_ns.response(404, "Variable not found")
    @console_variable_admission("snippet")
    def delete(self, request_context: RequestContext, snippet_id: UUID, variable_id: UUID):
        application_services().console_workflow_variables.delete(
            request_context, WorkflowOwner(str(snippet_id), "snippet"), str(variable_id)
        )
        return Response("", 204)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/variables/<uuid:variable_id>/reset")
class SnippetVariableResetApi(Resource):
    @console_ns.doc("reset_snippet_workflow_variable")
    @console_ns.doc(description="Reset a draft workflow variable to its default value (snippet scope)")
    @console_ns.response(
        200,
        "Variable reset successfully",
        console_ns.models[WorkflowDraftVariableResponse.__name__],
    )
    @console_ns.response(204, "Variable reset (no content)")
    @console_ns.response(404, "Variable not found")
    @console_variable_admission("snippet")
    def put(self, request_context: RequestContext, snippet_id: UUID, variable_id: UUID):
        variable = application_services().console_workflow_variables.reset(
            request_context, WorkflowOwner(str(snippet_id), "snippet"), str(variable_id)
        )
        if variable is None:
            return Response("", 204)
        return dump_response(WorkflowDraftVariableResponse, variable)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/conversation-variables")
class SnippetConversationVariableCollectionApi(Resource):
    @console_ns.doc("get_snippet_conversation_variables")
    @console_ns.doc(
        description="Conversation variables are not used in snippet workflows; returns an empty list for API parity"
    )
    @console_ns.response(
        200,
        "Conversation variables retrieved successfully",
        console_ns.models[WorkflowDraftVariableListResponse.__name__],
    )
    @console_variable_admission("snippet")
    def get(self, request_context: RequestContext, snippet_id: UUID):
        variables = application_services().console_workflow_variables.conversation(
            request_context, WorkflowOwner(str(snippet_id), "snippet")
        )
        return dump_response(WorkflowDraftVariableListResponse, variables)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/system-variables")
class SnippetSystemVariableCollectionApi(Resource):
    @console_ns.doc("get_snippet_system_variables")
    @console_ns.doc(
        description="System variables are not used in snippet workflows; returns an empty list for API parity"
    )
    @console_ns.response(
        200,
        "System variables retrieved successfully",
        console_ns.models[WorkflowDraftVariableListResponse.__name__],
    )
    @console_variable_admission("snippet")
    def get(self, request_context: RequestContext, snippet_id: UUID):
        variables = application_services().console_workflow_variables.system(
            request_context, WorkflowOwner(str(snippet_id), "snippet")
        )
        return dump_response(WorkflowDraftVariableListResponse, variables)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/environment-variables")
class SnippetEnvironmentVariableCollectionApi(Resource):
    @console_ns.doc("get_snippet_environment_variables")
    @console_ns.doc(description="Get environment variables from snippet draft workflow graph")
    @console_ns.response(
        200,
        "Environment variables retrieved successfully",
        console_ns.models[EnvironmentVariableListResponse.__name__],
    )
    @console_ns.response(404, "Draft workflow not found")
    @console_variable_admission("snippet")
    def get(self, request_context: RequestContext, snippet_id: UUID):
        items = application_services().console_workflow_variables.environment(
            request_context, WorkflowOwner(str(snippet_id), "snippet")
        )
        return dump_response(EnvironmentVariableListResponse, {"items": items})
