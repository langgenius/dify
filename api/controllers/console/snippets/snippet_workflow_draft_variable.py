"""
Snippet draft workflow variable APIs.

Mirrors console app routes under /apps/.../workflows/draft/variables for snippet scope,
using CustomizedSnippet.id as WorkflowDraftVariable.app_id (same invariant as snippet execution).

Snippet workflows do not expose system variables (`node_id == sys`) or conversation variables
(`node_id == conversation`): paginated list queries exclude those rows; single-variable GET/PATCH/DELETE/reset
reject them; `GET .../system-variables` and `GET .../conversation-variables` return empty lists for API parity.
Other routes mirror `workflow_draft_variable` app APIs under `/snippets/...`.
"""

from collections.abc import Callable
from functools import wraps
from typing import Any

from flask import Response, request
from flask_restx import Resource, marshal, marshal_with
from sqlalchemy.orm import Session

from controllers.console import console_ns
from controllers.console.app.error import DraftWorkflowNotExist
from controllers.console.app.workflow_draft_variable import (
    WorkflowDraftVariableListQuery,
    WorkflowDraftVariableUpdatePayload,
    _ensure_variable_access,
    _file_access_controller,
    validate_node_id,
    workflow_draft_variable_list_model,
    workflow_draft_variable_list_without_value_model,
    workflow_draft_variable_model,
)
from controllers.console.snippets.snippet_workflow import get_snippet
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
from controllers.web.error import InvalidArgumentError, NotFoundError
from core.workflow.variable_prefixes import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from extensions.ext_database import db
from factories.file_factory import build_from_mapping, build_from_mappings
from factories.variable_factory import build_segment_with_type
from graphon.variables.types import SegmentType
from libs.login import current_user, login_required
from models.snippet import CustomizedSnippet
from models.workflow import WorkflowDraftVariable
from services.snippet_service import SnippetService
from services.workflow_draft_variable_service import WorkflowDraftVariableList, WorkflowDraftVariableService

_SNIPPET_EXCLUDED_DRAFT_VARIABLE_NODE_IDS: frozenset[str] = frozenset(
    {SYSTEM_VARIABLE_NODE_ID, CONVERSATION_VARIABLE_NODE_ID}
)


def _ensure_snippet_draft_variable_row_allowed(
    *,
    variable: WorkflowDraftVariable,
    variable_id: str,
) -> None:
    """Snippet scope only supports canvas-node draft variables; treat sys/conversation rows as not found."""
    if variable.node_id in _SNIPPET_EXCLUDED_DRAFT_VARIABLE_NODE_IDS:
        raise NotFoundError(description=f"variable not found, id={variable_id}")


def _snippet_draft_var_prerequisite[**P, R](f: Callable[P, R]) -> Callable[P, R]:
    """Setup, auth, snippet resolution, and tenant edit permission (same stack as snippet workflow APIs)."""

    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    @edit_permission_required
    @wraps(f)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        return f(*args, **kwargs)

    return wrapper


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/variables")
class SnippetWorkflowVariableCollectionApi(Resource):
    @console_ns.expect(console_ns.models[WorkflowDraftVariableListQuery.__name__])
    @console_ns.doc("get_snippet_workflow_variables")
    @console_ns.doc(description="List draft workflow variables without values (paginated, snippet scope)")
    @console_ns.response(
        200,
        "Workflow variables retrieved successfully",
        workflow_draft_variable_list_without_value_model,
    )
    @_snippet_draft_var_prerequisite
    @marshal_with(workflow_draft_variable_list_without_value_model)
    def get(self, snippet: CustomizedSnippet) -> WorkflowDraftVariableList:
        args = WorkflowDraftVariableListQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        snippet_service = SnippetService()
        if snippet_service.get_draft_workflow(snippet=snippet) is None:
            raise DraftWorkflowNotExist()

        with Session(bind=db.engine, expire_on_commit=False) as session:
            draft_var_srv = WorkflowDraftVariableService(session=session)
            workflow_vars = draft_var_srv.list_variables_without_values(
                app_id=snippet.id,
                page=args.page,
                limit=args.limit,
                user_id=current_user.id,
                exclude_node_ids=_SNIPPET_EXCLUDED_DRAFT_VARIABLE_NODE_IDS,
            )

        return workflow_vars

    @console_ns.doc("delete_snippet_workflow_variables")
    @console_ns.doc(description="Delete all draft workflow variables for the current user (snippet scope)")
    @console_ns.response(204, "Workflow variables deleted successfully")
    @_snippet_draft_var_prerequisite
    def delete(self, snippet: CustomizedSnippet) -> Response:
        draft_var_srv = WorkflowDraftVariableService(session=db.session())
        draft_var_srv.delete_user_workflow_variables(snippet.id, user_id=current_user.id)
        db.session.commit()
        return Response("", 204)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/variables")
class SnippetNodeVariableCollectionApi(Resource):
    @console_ns.doc("get_snippet_node_variables")
    @console_ns.doc(description="Get variables for a specific node (snippet draft workflow)")
    @console_ns.response(200, "Node variables retrieved successfully", workflow_draft_variable_list_model)
    @_snippet_draft_var_prerequisite
    @marshal_with(workflow_draft_variable_list_model)
    def get(self, snippet: CustomizedSnippet, node_id: str) -> WorkflowDraftVariableList:
        validate_node_id(node_id)
        with Session(bind=db.engine, expire_on_commit=False) as session:
            draft_var_srv = WorkflowDraftVariableService(session=session)
            node_vars = draft_var_srv.list_node_variables(snippet.id, node_id, user_id=current_user.id)

        return node_vars

    @console_ns.doc("delete_snippet_node_variables")
    @console_ns.doc(description="Delete all variables for a specific node (snippet draft workflow)")
    @console_ns.response(204, "Node variables deleted successfully")
    @_snippet_draft_var_prerequisite
    def delete(self, snippet: CustomizedSnippet, node_id: str) -> Response:
        validate_node_id(node_id)
        srv = WorkflowDraftVariableService(db.session())
        srv.delete_node_variables(snippet.id, node_id, user_id=current_user.id)
        db.session.commit()
        return Response("", 204)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/variables/<uuid:variable_id>")
class SnippetVariableApi(Resource):
    @console_ns.doc("get_snippet_workflow_variable")
    @console_ns.doc(description="Get a specific draft workflow variable (snippet scope)")
    @console_ns.response(200, "Variable retrieved successfully", workflow_draft_variable_model)
    @console_ns.response(404, "Variable not found")
    @_snippet_draft_var_prerequisite
    @marshal_with(workflow_draft_variable_model)
    def get(self, snippet: CustomizedSnippet, variable_id: str) -> WorkflowDraftVariable:
        draft_var_srv = WorkflowDraftVariableService(session=db.session())
        variable = _ensure_variable_access(
            variable=draft_var_srv.get_variable(variable_id=variable_id),
            app_id=snippet.id,
            variable_id=variable_id,
        )
        _ensure_snippet_draft_variable_row_allowed(variable=variable, variable_id=variable_id)
        return variable

    @console_ns.doc("update_snippet_workflow_variable")
    @console_ns.doc(description="Update a draft workflow variable (snippet scope)")
    @console_ns.expect(console_ns.models[WorkflowDraftVariableUpdatePayload.__name__])
    @console_ns.response(200, "Variable updated successfully", workflow_draft_variable_model)
    @console_ns.response(404, "Variable not found")
    @_snippet_draft_var_prerequisite
    @marshal_with(workflow_draft_variable_model)
    def patch(self, snippet: CustomizedSnippet, variable_id: str) -> WorkflowDraftVariable:
        draft_var_srv = WorkflowDraftVariableService(session=db.session())
        args_model = WorkflowDraftVariableUpdatePayload.model_validate(console_ns.payload or {})

        variable = _ensure_variable_access(
            variable=draft_var_srv.get_variable(variable_id=variable_id),
            app_id=snippet.id,
            variable_id=variable_id,
        )
        _ensure_snippet_draft_variable_row_allowed(variable=variable, variable_id=variable_id)

        new_name = args_model.name
        raw_value = args_model.value
        if new_name is None and raw_value is None:
            return variable

        new_value = None
        if raw_value is not None:
            if variable.value_type == SegmentType.FILE:
                if not isinstance(raw_value, dict):
                    raise InvalidArgumentError(description=f"expected dict for file, got {type(raw_value)}")
                raw_value = build_from_mapping(
                    mapping=raw_value,
                    tenant_id=snippet.tenant_id,
                    access_controller=_file_access_controller,
                )
            elif variable.value_type == SegmentType.ARRAY_FILE:
                if not isinstance(raw_value, list):
                    raise InvalidArgumentError(description=f"expected list for files, got {type(raw_value)}")
                if len(raw_value) > 0 and not isinstance(raw_value[0], dict):
                    raise InvalidArgumentError(description=f"expected dict for files[0], got {type(raw_value)}")
                raw_value = build_from_mappings(
                    mappings=raw_value,
                    tenant_id=snippet.tenant_id,
                    access_controller=_file_access_controller,
                )
            new_value = build_segment_with_type(variable.value_type, raw_value)
        draft_var_srv.update_variable(variable, name=new_name, value=new_value)
        db.session.commit()
        return variable

    @console_ns.doc("delete_snippet_workflow_variable")
    @console_ns.doc(description="Delete a draft workflow variable (snippet scope)")
    @console_ns.response(204, "Variable deleted successfully")
    @console_ns.response(404, "Variable not found")
    @_snippet_draft_var_prerequisite
    def delete(self, snippet: CustomizedSnippet, variable_id: str) -> Response:
        draft_var_srv = WorkflowDraftVariableService(session=db.session())
        variable = _ensure_variable_access(
            variable=draft_var_srv.get_variable(variable_id=variable_id),
            app_id=snippet.id,
            variable_id=variable_id,
        )
        _ensure_snippet_draft_variable_row_allowed(variable=variable, variable_id=variable_id)
        draft_var_srv.delete_variable(variable)
        db.session.commit()
        return Response("", 204)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/variables/<uuid:variable_id>/reset")
class SnippetVariableResetApi(Resource):
    @console_ns.doc("reset_snippet_workflow_variable")
    @console_ns.doc(description="Reset a draft workflow variable to its default value (snippet scope)")
    @console_ns.response(200, "Variable reset successfully", workflow_draft_variable_model)
    @console_ns.response(204, "Variable reset (no content)")
    @console_ns.response(404, "Variable not found")
    @_snippet_draft_var_prerequisite
    def put(self, snippet: CustomizedSnippet, variable_id: str) -> Response | Any:
        draft_var_srv = WorkflowDraftVariableService(session=db.session())
        snippet_service = SnippetService()
        draft_workflow = snippet_service.get_draft_workflow(snippet=snippet)
        if draft_workflow is None:
            raise NotFoundError(
                f"Draft workflow not found, snippet_id={snippet.id}",
            )
        variable = _ensure_variable_access(
            variable=draft_var_srv.get_variable(variable_id=variable_id),
            app_id=snippet.id,
            variable_id=variable_id,
        )
        _ensure_snippet_draft_variable_row_allowed(variable=variable, variable_id=variable_id)

        resetted = draft_var_srv.reset_variable(draft_workflow, variable)
        db.session.commit()
        if resetted is None:
            return Response("", 204)
        return marshal(resetted, workflow_draft_variable_model)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/conversation-variables")
class SnippetConversationVariableCollectionApi(Resource):
    @console_ns.doc("get_snippet_conversation_variables")
    @console_ns.doc(
        description="Conversation variables are not used in snippet workflows; returns an empty list for API parity"
    )
    @console_ns.response(200, "Conversation variables retrieved successfully", workflow_draft_variable_list_model)
    @_snippet_draft_var_prerequisite
    @marshal_with(workflow_draft_variable_list_model)
    def get(self, snippet: CustomizedSnippet) -> WorkflowDraftVariableList:
        return WorkflowDraftVariableList(variables=[])


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/system-variables")
class SnippetSystemVariableCollectionApi(Resource):
    @console_ns.doc("get_snippet_system_variables")
    @console_ns.doc(
        description="System variables are not used in snippet workflows; returns an empty list for API parity"
    )
    @console_ns.response(200, "System variables retrieved successfully", workflow_draft_variable_list_model)
    @_snippet_draft_var_prerequisite
    @marshal_with(workflow_draft_variable_list_model)
    def get(self, snippet: CustomizedSnippet) -> WorkflowDraftVariableList:
        return WorkflowDraftVariableList(variables=[])


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/environment-variables")
class SnippetEnvironmentVariableCollectionApi(Resource):
    @console_ns.doc("get_snippet_environment_variables")
    @console_ns.doc(description="Get environment variables from snippet draft workflow graph")
    @console_ns.response(200, "Environment variables retrieved successfully")
    @console_ns.response(404, "Draft workflow not found")
    @_snippet_draft_var_prerequisite
    def get(self, snippet: CustomizedSnippet) -> dict[str, list[dict[str, Any]]]:
        snippet_service = SnippetService()
        workflow = snippet_service.get_draft_workflow(snippet=snippet)
        if workflow is None:
            raise DraftWorkflowNotExist()

        env_vars_list: list[dict[str, Any]] = []
        for v in workflow.environment_variables:
            env_vars_list.append(
                {
                    "id": v.id,
                    "type": "env",
                    "name": v.name,
                    "description": v.description,
                    "selector": v.selector,
                    "value_type": v.value_type.exposed_type().value,
                    "value": v.value,
                    "edited": False,
                    "visible": True,
                    "editable": True,
                }
            )

        return {"items": env_vars_list}
