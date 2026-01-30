import logging
from collections.abc import Callable
from functools import wraps
from typing import ParamSpec, TypeVar

from flask import request
from flask_restx import Resource, marshal_with
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import DraftWorkflowNotExist, DraftWorkflowNotSync
from controllers.console.app.workflow import workflow_model
from controllers.console.app.workflow_run import (
    workflow_run_detail_model,
    workflow_run_node_execution_list_model,
    workflow_run_pagination_model,
)
from controllers.console.snippets.payloads import (
    PublishWorkflowPayload,
    SnippetDraftSyncPayload,
    WorkflowRunQuery,
)
from controllers.console.wraps import (
    account_initialization_required,
    edit_permission_required,
    setup_required,
)
from extensions.ext_database import db
from factories import variable_factory
from libs.helper import TimestampField
from libs.login import current_account_with_tenant, login_required
from models.snippet import CustomizedSnippet
from services.errors.app import WorkflowHashNotEqualError
from services.snippet_service import SnippetService

logger = logging.getLogger(__name__)

P = ParamSpec("P")
R = TypeVar("R")

# Register Pydantic models with Swagger
register_schema_models(
    console_ns,
    SnippetDraftSyncPayload,
    WorkflowRunQuery,
    PublishWorkflowPayload,
)


class SnippetNotFoundError(Exception):
    """Snippet not found error."""

    pass


def get_snippet(view_func: Callable[P, R]):
    """Decorator to fetch and validate snippet access."""

    @wraps(view_func)
    def decorated_view(*args: P.args, **kwargs: P.kwargs):
        if not kwargs.get("snippet_id"):
            raise ValueError("missing snippet_id in path parameters")

        _, current_tenant_id = current_account_with_tenant()

        snippet_id = str(kwargs.get("snippet_id"))
        del kwargs["snippet_id"]

        snippet = SnippetService.get_snippet_by_id(
            snippet_id=snippet_id,
            tenant_id=current_tenant_id,
        )

        if not snippet:
            raise NotFound("Snippet not found")

        kwargs["snippet"] = snippet

        return view_func(*args, **kwargs)

    return decorated_view


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft")
class SnippetDraftWorkflowApi(Resource):
    @console_ns.doc("get_snippet_draft_workflow")
    @console_ns.response(200, "Draft workflow retrieved successfully", workflow_model)
    @console_ns.response(404, "Snippet or draft workflow not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    @edit_permission_required
    @marshal_with(workflow_model)
    def get(self, snippet: CustomizedSnippet):
        """Get draft workflow for snippet."""
        snippet_service = SnippetService()
        workflow = snippet_service.get_draft_workflow(snippet=snippet)

        if not workflow:
            raise DraftWorkflowNotExist()

        return workflow

    @console_ns.doc("sync_snippet_draft_workflow")
    @console_ns.expect(console_ns.models.get(SnippetDraftSyncPayload.__name__))
    @console_ns.response(200, "Draft workflow synced successfully")
    @console_ns.response(400, "Hash mismatch")
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    @edit_permission_required
    def post(self, snippet: CustomizedSnippet):
        """Sync draft workflow for snippet."""
        current_user, _ = current_account_with_tenant()

        payload = SnippetDraftSyncPayload.model_validate(console_ns.payload or {})

        try:
            environment_variables_list = payload.environment_variables or []
            environment_variables = [
                variable_factory.build_environment_variable_from_mapping(obj) for obj in environment_variables_list
            ]
            conversation_variables_list = payload.conversation_variables or []
            conversation_variables = [
                variable_factory.build_conversation_variable_from_mapping(obj) for obj in conversation_variables_list
            ]
            snippet_service = SnippetService()
            workflow = snippet_service.sync_draft_workflow(
                snippet=snippet,
                graph=payload.graph,
                unique_hash=payload.hash,
                account=current_user,
                environment_variables=environment_variables,
                conversation_variables=conversation_variables,
                input_variables=payload.input_variables,
            )
        except WorkflowHashNotEqualError:
            raise DraftWorkflowNotSync()

        return {
            "result": "success",
            "hash": workflow.unique_hash,
            "updated_at": TimestampField().format(workflow.updated_at or workflow.created_at),
        }


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/config")
class SnippetDraftConfigApi(Resource):
    @console_ns.doc("get_snippet_draft_config")
    @console_ns.response(200, "Draft config retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    @edit_permission_required
    def get(self, snippet: CustomizedSnippet):
        """Get snippet draft workflow configuration limits."""
        return {
            "parallel_depth_limit": 3,
        }


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/publish")
class SnippetPublishedWorkflowApi(Resource):
    @console_ns.doc("get_snippet_published_workflow")
    @console_ns.response(200, "Published workflow retrieved successfully", workflow_model)
    @console_ns.response(404, "Snippet not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    @edit_permission_required
    @marshal_with(workflow_model)
    def get(self, snippet: CustomizedSnippet):
        """Get published workflow for snippet."""
        if not snippet.is_published:
            return None

        snippet_service = SnippetService()
        workflow = snippet_service.get_published_workflow(snippet=snippet)

        return workflow

    @console_ns.doc("publish_snippet_workflow")
    @console_ns.expect(console_ns.models.get(PublishWorkflowPayload.__name__))
    @console_ns.response(200, "Workflow published successfully")
    @console_ns.response(400, "No draft workflow found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    @edit_permission_required
    def post(self, snippet: CustomizedSnippet):
        """Publish snippet workflow."""
        current_user, _ = current_account_with_tenant()
        snippet_service = SnippetService()

        with Session(db.engine) as session:
            snippet = session.merge(snippet)
            try:
                workflow = snippet_service.publish_workflow(
                    session=session,
                    snippet=snippet,
                    account=current_user,
                )
                workflow_created_at = TimestampField().format(workflow.created_at)
                session.commit()
            except ValueError as e:
                return {"message": str(e)}, 400

        return {
            "result": "success",
            "created_at": workflow_created_at,
        }


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/default-workflow-block-configs")
class SnippetDefaultBlockConfigsApi(Resource):
    @console_ns.doc("get_snippet_default_block_configs")
    @console_ns.response(200, "Default block configs retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    @edit_permission_required
    def get(self, snippet: CustomizedSnippet):
        """Get default block configurations for snippet workflow."""
        snippet_service = SnippetService()
        return snippet_service.get_default_block_configs()


@console_ns.route("/snippets/<uuid:snippet_id>/workflow-runs")
class SnippetWorkflowRunsApi(Resource):
    @console_ns.doc("list_snippet_workflow_runs")
    @console_ns.response(200, "Workflow runs retrieved successfully", workflow_run_pagination_model)
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    @marshal_with(workflow_run_pagination_model)
    def get(self, snippet: CustomizedSnippet):
        """List workflow runs for snippet."""
        query = WorkflowRunQuery.model_validate(
            {
                "last_id": request.args.get("last_id"),
                "limit": request.args.get("limit", type=int, default=20),
            }
        )
        args = {
            "last_id": query.last_id,
            "limit": query.limit,
        }

        snippet_service = SnippetService()
        result = snippet_service.get_snippet_workflow_runs(snippet=snippet, args=args)

        return result


@console_ns.route("/snippets/<uuid:snippet_id>/workflow-runs/<uuid:run_id>")
class SnippetWorkflowRunDetailApi(Resource):
    @console_ns.doc("get_snippet_workflow_run_detail")
    @console_ns.response(200, "Workflow run detail retrieved successfully", workflow_run_detail_model)
    @console_ns.response(404, "Workflow run not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    @marshal_with(workflow_run_detail_model)
    def get(self, snippet: CustomizedSnippet, run_id):
        """Get workflow run detail for snippet."""
        run_id = str(run_id)

        snippet_service = SnippetService()
        workflow_run = snippet_service.get_snippet_workflow_run(snippet=snippet, run_id=run_id)

        if not workflow_run:
            raise NotFound("Workflow run not found")

        return workflow_run


@console_ns.route("/snippets/<uuid:snippet_id>/workflow-runs/<uuid:run_id>/node-executions")
class SnippetWorkflowRunNodeExecutionsApi(Resource):
    @console_ns.doc("list_snippet_workflow_run_node_executions")
    @console_ns.response(200, "Node executions retrieved successfully", workflow_run_node_execution_list_model)
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    @marshal_with(workflow_run_node_execution_list_model)
    def get(self, snippet: CustomizedSnippet, run_id):
        """List node executions for a workflow run."""
        run_id = str(run_id)

        snippet_service = SnippetService()
        node_executions = snippet_service.get_snippet_workflow_run_node_executions(
            snippet=snippet,
            run_id=run_id,
        )

        return {"data": node_executions}
