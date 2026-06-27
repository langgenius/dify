import logging
from collections.abc import Callable
from functools import wraps

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import BadRequest, InternalServerError, NotFound

from controllers.common.controller_schemas import WorkflowUpdatePayload
from controllers.common.fields import EventStreamResponse, SimpleResultResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import DraftWorkflowNotExist, DraftWorkflowNotSync
from controllers.console.app.workflow import (
    RESTORE_SOURCE_WORKFLOW_MUST_BE_PUBLISHED_MESSAGE,
    PublishWorkflowPayload,
    PublishWorkflowResponse,
    SyncDraftWorkflowResponse,
    WorkflowPaginationResponse,
    WorkflowResponse,
)
from controllers.console.snippets.payloads import (
    SnippetDraftNodeRunPayload,
    SnippetDraftRunPayload,
    SnippetDraftSyncPayload,
    SnippetIterationNodeRunPayload,
    SnippetLoopNodeRunPayload,
    SnippetWorkflowListQuery,
    WorkflowRunQuery,
)
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    rbac_permission_required,
    setup_required,
    with_current_user,
)
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from fields.base import ResponseModel
from fields.workflow_run_fields import (
    WorkflowRunDetailResponse,
    WorkflowRunNodeExecutionListResponse,
    WorkflowRunNodeExecutionResponse,
    WorkflowRunPaginationResponse,
)
from graphon.graph_engine.manager import GraphEngineManager
from libs import helper
from libs.helper import dump_response, to_timestamp
from libs.login import current_account_with_tenant, login_required
from models import Account
from models.snippet import CustomizedSnippet
from services.errors.app import IsDraftWorkflowError, WorkflowHashNotEqualError, WorkflowNotFoundError
from services.snippet_generate_service import SnippetGenerateService
from services.snippet_service import SnippetService

logger = logging.getLogger(__name__)

# Register Pydantic models with Swagger


def _snippet_session_maker() -> sessionmaker[Session]:
    return sessionmaker(bind=db.engine, expire_on_commit=False)


def _snippet_service() -> SnippetService:
    return SnippetService(_snippet_session_maker())


class SnippetWorkflowResponse(WorkflowResponse):
    input_fields: list[dict] = Field(default_factory=list)


class SnippetDraftConfigResponse(ResponseModel):
    parallel_depth_limit: int


class SnippetWorkflowPaginationResponse(BaseModel):
    items: list[SnippetWorkflowResponse]
    page: int
    limit: int
    has_more: bool


register_schema_models(
    console_ns,
    SnippetDraftSyncPayload,
    SnippetDraftNodeRunPayload,
    SnippetDraftRunPayload,
    SnippetIterationNodeRunPayload,
    SnippetLoopNodeRunPayload,
    SnippetWorkflowListQuery,
    WorkflowRunQuery,
    WorkflowUpdatePayload,
    PublishWorkflowPayload,
)
register_response_schema_models(
    console_ns,
    EventStreamResponse,
    SimpleResultResponse,
    SnippetDraftConfigResponse,
    SnippetWorkflowResponse,
    SnippetWorkflowPaginationResponse,
    PublishWorkflowResponse,
    WorkflowPaginationResponse,
    SyncDraftWorkflowResponse,
    WorkflowRunPaginationResponse,
    WorkflowRunDetailResponse,
    WorkflowRunNodeExecutionListResponse,
    WorkflowRunNodeExecutionResponse,
)


class SnippetNotFoundError(Exception):
    """Snippet not found error."""

    pass


def get_snippet[**P, R](view_func: Callable[P, R]) -> Callable[P, R]:
    """Decorator to fetch and validate snippet access."""

    @wraps(view_func)
    def decorated_view(*args: P.args, **kwargs: P.kwargs) -> R:
        if not kwargs.get("snippet_id"):
            raise ValueError("missing snippet_id in path parameters")

        _, current_tenant_id = current_account_with_tenant()

        snippet_id = str(kwargs.get("snippet_id"))
        del kwargs["snippet_id"]

        snippet_service = _snippet_service()
        snippet = snippet_service.get_snippet_by_id(
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
    @console_ns.response(
        200,
        "Draft workflow retrieved successfully",
        console_ns.models[SnippetWorkflowResponse.__name__],
    )
    @console_ns.response(404, "Snippet or draft workflow not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    @edit_permission_required
    def get(self, snippet: CustomizedSnippet):
        """Get draft workflow for snippet."""
        snippet_service = _snippet_service()
        workflow = snippet_service.get_draft_workflow(snippet=snippet)

        if not workflow:
            raise DraftWorkflowNotExist()

        workflow.conversation_variables = []
        response = dump_response(SnippetWorkflowResponse, workflow)
        response["input_fields"] = snippet.input_fields_list
        return response

    @console_ns.doc("sync_snippet_draft_workflow")
    @console_ns.expect(console_ns.models.get(SnippetDraftSyncPayload.__name__))
    @console_ns.response(
        200,
        "Draft workflow synced successfully",
        console_ns.models[SyncDraftWorkflowResponse.__name__],
    )
    @console_ns.response(400, "Hash mismatch")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @get_snippet
    @edit_permission_required
    @rbac_permission_required(
        RBACResourceScope.WORKSPACE, RBACPermission.SNIPPETS_CREATE_AND_MODIFY, resource_required=False
    )
    def post(self, current_user: Account, snippet: CustomizedSnippet):
        """Sync draft workflow for snippet."""
        payload = SnippetDraftSyncPayload.model_validate(console_ns.payload or {})

        try:
            snippet_service = _snippet_service()
            workflow = snippet_service.sync_draft_workflow(
                snippet=snippet,
                graph=payload.graph,
                unique_hash=payload.hash,
                account=current_user,
                input_fields=payload.input_fields,
            )
        except WorkflowHashNotEqualError:
            raise DraftWorkflowNotSync()
        except ValueError as e:
            return {"message": str(e)}, 400

        return SyncDraftWorkflowResponse(
            result="success",
            hash=workflow.unique_hash,
            updated_at=to_timestamp(workflow.updated_at or workflow.created_at),
        ).model_dump(mode="json")


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/config")
class SnippetDraftConfigApi(Resource):
    @console_ns.doc("get_snippet_draft_config")
    @console_ns.response(
        200,
        "Draft config retrieved successfully",
        console_ns.models[SnippetDraftConfigResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    @edit_permission_required
    def get(self, snippet: CustomizedSnippet):
        """Get snippet draft workflow configuration limits."""
        return SnippetDraftConfigResponse(parallel_depth_limit=3).model_dump(mode="json")


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/publish")
class SnippetPublishedWorkflowApi(Resource):
    @console_ns.doc("get_snippet_published_workflow")
    @console_ns.response(
        200,
        "Published workflow retrieved successfully",
        console_ns.models[SnippetWorkflowResponse.__name__],
    )
    @console_ns.response(404, "Snippet not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    @edit_permission_required
    def get(self, snippet: CustomizedSnippet):
        """Get published workflow for snippet."""
        if not snippet.is_published:
            return None

        snippet_service = _snippet_service()
        workflow = snippet_service.get_published_workflow(snippet=snippet)

        if not workflow:
            return None

        response = dump_response(SnippetWorkflowResponse, workflow)
        response["input_fields"] = snippet.input_fields_list
        return response

    @console_ns.doc("publish_snippet_workflow")
    @console_ns.response(200, "Workflow published successfully", console_ns.models[PublishWorkflowResponse.__name__])
    @console_ns.response(400, "No draft workflow found")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @get_snippet
    @edit_permission_required
    @rbac_permission_required(
        RBACResourceScope.WORKSPACE, RBACPermission.SNIPPETS_CREATE_AND_MODIFY, resource_required=False
    )
    def post(self, current_user: Account, snippet: CustomizedSnippet):
        """Publish snippet workflow."""
        snippet_service = _snippet_service()

        with Session(db.engine) as session:
            snippet = session.merge(snippet)
            try:
                workflow = snippet_service.publish_workflow(
                    session=session,
                    snippet=snippet,
                    account=current_user,
                )
                workflow_created_at = to_timestamp(workflow.created_at)
                session.commit()
            except ValueError as e:
                return {"message": str(e)}, 400

        return PublishWorkflowResponse(result="success", created_at=workflow_created_at).model_dump(mode="json")


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
        snippet_service = _snippet_service()
        return snippet_service.get_default_block_configs()


@console_ns.route("/snippets/<uuid:snippet_id>/workflows")
class SnippetPublishedAllWorkflowApi(Resource):
    @console_ns.doc(params=query_params_from_model(SnippetWorkflowListQuery))
    @console_ns.doc("get_all_snippet_published_workflows")
    @console_ns.doc(description="Get all published workflows for a snippet")
    @console_ns.doc(params={"snippet_id": "Snippet ID"})
    @console_ns.response(
        200,
        "Published workflows retrieved successfully",
        console_ns.models[SnippetWorkflowPaginationResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    @edit_permission_required
    @rbac_permission_required(
        RBACResourceScope.WORKSPACE, RBACPermission.SNIPPETS_CREATE_AND_MODIFY, resource_required=False
    )
    def get(self, snippet: CustomizedSnippet):
        """Get all published workflow versions for snippet."""
        args = SnippetWorkflowListQuery.model_validate(request.args.to_dict(flat=True))

        snippet_service = _snippet_service()
        with Session(db.engine) as session:
            workflows, has_more = snippet_service.get_all_published_workflows(
                session=session,
                snippet=snippet,
                page=args.page,
                limit=args.limit,
            )

        response = SnippetWorkflowPaginationResponse.model_validate(
            {
                "items": workflows,
                "page": args.page,
                "limit": args.limit,
                "has_more": has_more,
            },
            from_attributes=True,
        ).model_dump(mode="json")
        for item in response["items"]:
            item["input_fields"] = snippet.input_fields_list
        return response


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/<string:workflow_id>/restore")
class SnippetDraftWorkflowRestoreApi(Resource):
    @console_ns.doc("restore_snippet_workflow_to_draft")
    @console_ns.doc(description="Restore a published snippet workflow version into the draft workflow")
    @console_ns.doc(params={"snippet_id": "Snippet ID", "workflow_id": "Published workflow ID"})
    @console_ns.response(200, "Workflow restored successfully", console_ns.models[SyncDraftWorkflowResponse.__name__])
    @console_ns.response(400, "Source workflow must be published")
    @console_ns.response(404, "Workflow not found")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @get_snippet
    @edit_permission_required
    @rbac_permission_required(
        RBACResourceScope.WORKSPACE, RBACPermission.SNIPPETS_CREATE_AND_MODIFY, resource_required=False
    )
    def post(self, current_user: Account, snippet: CustomizedSnippet, workflow_id: str):
        """Restore a published snippet workflow version into the draft workflow."""
        snippet_service = _snippet_service()

        try:
            workflow = snippet_service.restore_published_workflow_to_draft(
                snippet=snippet,
                workflow_id=workflow_id,
                account=current_user,
            )
        except IsDraftWorkflowError as exc:
            raise BadRequest(RESTORE_SOURCE_WORKFLOW_MUST_BE_PUBLISHED_MESSAGE) from exc
        except WorkflowNotFoundError as exc:
            raise NotFound(str(exc)) from exc
        except ValueError as exc:
            raise BadRequest(str(exc)) from exc

        return SyncDraftWorkflowResponse(
            result="success",
            hash=workflow.unique_hash,
            updated_at=to_timestamp(workflow.updated_at or workflow.created_at),
        ).model_dump(mode="json")


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/<string:workflow_id>")
class SnippetWorkflowByIdApi(Resource):
    @console_ns.doc("update_snippet_workflow_by_id")
    @console_ns.doc(description="Update published snippet workflow attributes")
    @console_ns.doc(params={"snippet_id": "Snippet ID", "workflow_id": "Workflow ID"})
    @console_ns.expect(console_ns.models[WorkflowUpdatePayload.__name__])
    @console_ns.response(200, "Workflow updated successfully", console_ns.models[SnippetWorkflowResponse.__name__])
    @console_ns.response(400, "No valid fields to update")
    @console_ns.response(404, "Workflow not found")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @get_snippet
    @edit_permission_required
    @rbac_permission_required(
        RBACResourceScope.WORKSPACE, RBACPermission.SNIPPETS_CREATE_AND_MODIFY, resource_required=False
    )
    def patch(self, current_user: Account, snippet: CustomizedSnippet, workflow_id: str):
        """Update a published snippet workflow version's display metadata."""
        payload = WorkflowUpdatePayload.model_validate(console_ns.payload or {})
        update_data = payload.model_dump(exclude_unset=True)

        if not update_data:
            return {"message": "No valid fields to update"}, 400

        snippet_service = _snippet_service()
        with _snippet_session_maker().begin() as session:
            workflow = snippet_service.update_workflow(
                session=session,
                snippet=snippet,
                workflow_id=workflow_id,
                account=current_user,
                data=update_data,
            )
            if not workflow:
                raise NotFound("Workflow not found")

        response = SnippetWorkflowResponse.model_validate(workflow, from_attributes=True).model_dump(mode="json")
        response["input_fields"] = snippet.input_fields_list
        return response


@console_ns.route("/snippets/<uuid:snippet_id>/workflow-runs")
class SnippetWorkflowRunsApi(Resource):
    @console_ns.doc("list_snippet_workflow_runs")
    @console_ns.doc(params=query_params_from_model(WorkflowRunQuery))
    @console_ns.response(
        200,
        "Workflow runs retrieved successfully",
        console_ns.models[WorkflowRunPaginationResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
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

        snippet_service = _snippet_service()
        result = snippet_service.get_snippet_workflow_runs(snippet=snippet, args=args)

        return dump_response(WorkflowRunPaginationResponse, result)


@console_ns.route("/snippets/<uuid:snippet_id>/workflow-runs/<uuid:run_id>")
class SnippetWorkflowRunDetailApi(Resource):
    @console_ns.doc("get_snippet_workflow_run_detail")
    @console_ns.response(
        200,
        "Workflow run detail retrieved successfully",
        console_ns.models[WorkflowRunDetailResponse.__name__],
    )
    @console_ns.response(404, "Workflow run not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    def get(self, snippet: CustomizedSnippet, run_id):
        """Get workflow run detail for snippet."""
        run_id = str(run_id)

        snippet_service = _snippet_service()
        workflow_run = snippet_service.get_snippet_workflow_run(snippet=snippet, run_id=run_id)

        if not workflow_run:
            raise NotFound("Workflow run not found")

        return dump_response(WorkflowRunDetailResponse, workflow_run)


@console_ns.route("/snippets/<uuid:snippet_id>/workflow-runs/<uuid:run_id>/node-executions")
class SnippetWorkflowRunNodeExecutionsApi(Resource):
    @console_ns.doc("list_snippet_workflow_run_node_executions")
    @console_ns.response(
        200,
        "Node executions retrieved successfully",
        console_ns.models[WorkflowRunNodeExecutionListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    def get(self, snippet: CustomizedSnippet, run_id):
        """List node executions for a workflow run."""
        run_id = str(run_id)

        snippet_service = _snippet_service()
        node_executions = snippet_service.get_snippet_workflow_run_node_executions(
            snippet=snippet,
            run_id=run_id,
        )

        return dump_response(WorkflowRunNodeExecutionListResponse, {"data": node_executions})


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/run")
class SnippetDraftNodeRunApi(Resource):
    @console_ns.doc("run_snippet_draft_node")
    @console_ns.doc(description="Run a single node in snippet draft workflow (single-step debugging)")
    @console_ns.doc(params={"snippet_id": "Snippet ID", "node_id": "Node ID"})
    @console_ns.expect(console_ns.models.get(SnippetDraftNodeRunPayload.__name__))
    @console_ns.response(
        200, "Node run completed successfully", console_ns.models[WorkflowRunNodeExecutionResponse.__name__]
    )
    @console_ns.response(404, "Snippet or draft workflow not found")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @get_snippet
    @edit_permission_required
    def post(self, current_user: Account, snippet: CustomizedSnippet, node_id: str):
        """
        Run a single node in snippet draft workflow.

        Executes a specific node with provided inputs for single-step debugging.
        Returns the node execution result including status, outputs, and timing.
        """
        payload = SnippetDraftNodeRunPayload.model_validate(console_ns.payload or {})

        user_inputs = payload.inputs

        # Get draft workflow for file parsing
        snippet_service = _snippet_service()
        draft_workflow = snippet_service.get_draft_workflow(snippet=snippet)
        if not draft_workflow:
            raise NotFound("Draft workflow not found")

        files = SnippetGenerateService.parse_files(draft_workflow, payload.files)

        workflow_node_execution = SnippetGenerateService.run_draft_node(
            snippet=snippet,
            node_id=node_id,
            user_inputs=user_inputs,
            account=current_user,
            query=payload.query,
            files=files,
            session_maker=_snippet_session_maker(),
        )

        return dump_response(WorkflowRunNodeExecutionResponse, workflow_node_execution)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/last-run")
class SnippetDraftNodeLastRunApi(Resource):
    @console_ns.doc("get_snippet_draft_node_last_run")
    @console_ns.doc(description="Get last run result for a node in snippet draft workflow")
    @console_ns.doc(params={"snippet_id": "Snippet ID", "node_id": "Node ID"})
    @console_ns.response(
        200, "Node last run retrieved successfully", console_ns.models[WorkflowRunNodeExecutionResponse.__name__]
    )
    @console_ns.response(404, "Snippet, draft workflow, or node last run not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    def get(self, snippet: CustomizedSnippet, node_id: str):
        """
        Get the last run result for a specific node in snippet draft workflow.

        Returns the most recent execution record for the given node,
        including status, inputs, outputs, and timing information.
        """
        snippet_service = _snippet_service()
        draft_workflow = snippet_service.get_draft_workflow(snippet=snippet)
        if not draft_workflow:
            raise NotFound("Draft workflow not found")

        node_exec = snippet_service.get_snippet_node_last_run(
            snippet=snippet,
            workflow=draft_workflow,
            node_id=node_id,
        )
        if node_exec is None:
            raise NotFound("Node last run not found")

        return dump_response(WorkflowRunNodeExecutionResponse, node_exec)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/iteration/nodes/<string:node_id>/run")
class SnippetDraftRunIterationNodeApi(Resource):
    @console_ns.doc("run_snippet_draft_iteration_node")
    @console_ns.doc(description="Run draft workflow iteration node for snippet")
    @console_ns.doc(params={"snippet_id": "Snippet ID", "node_id": "Node ID"})
    @console_ns.expect(console_ns.models.get(SnippetIterationNodeRunPayload.__name__))
    @console_ns.response(
        200,
        "Iteration node run started successfully (SSE stream)",
        console_ns.models[EventStreamResponse.__name__],
    )
    @console_ns.response(404, "Snippet or draft workflow not found")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @get_snippet
    @edit_permission_required
    def post(self, current_user: Account, snippet: CustomizedSnippet, node_id: str):
        """
        Run a draft workflow iteration node for snippet.

        Iteration nodes execute their internal sub-graph multiple times over an input list.
        Returns an SSE event stream with iteration progress and results.
        """
        args = SnippetIterationNodeRunPayload.model_validate(console_ns.payload or {}).model_dump(exclude_none=True)

        try:
            response = SnippetGenerateService.generate_single_iteration(
                snippet=snippet,
                user=current_user,
                node_id=node_id,
                args=args,
                streaming=True,
                session_maker=_snippet_session_maker(),
            )

            # response-contract:ignore compact_generate_response
            return helper.compact_generate_response(response)
        except ValueError as e:
            raise e
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/loop/nodes/<string:node_id>/run")
class SnippetDraftRunLoopNodeApi(Resource):
    @console_ns.doc("run_snippet_draft_loop_node")
    @console_ns.doc(description="Run draft workflow loop node for snippet")
    @console_ns.doc(params={"snippet_id": "Snippet ID", "node_id": "Node ID"})
    @console_ns.expect(console_ns.models.get(SnippetLoopNodeRunPayload.__name__))
    @console_ns.response(
        200,
        "Loop node run started successfully (SSE stream)",
        console_ns.models[EventStreamResponse.__name__],
    )
    @console_ns.response(404, "Snippet or draft workflow not found")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @get_snippet
    @edit_permission_required
    def post(self, current_user: Account, snippet: CustomizedSnippet, node_id: str):
        """
        Run a draft workflow loop node for snippet.

        Loop nodes execute their internal sub-graph repeatedly until a condition is met.
        Returns an SSE event stream with loop progress and results.
        """
        args = SnippetLoopNodeRunPayload.model_validate(console_ns.payload or {})

        try:
            response = SnippetGenerateService.generate_single_loop(
                snippet=snippet,
                user=current_user,
                node_id=node_id,
                args=args,
                streaming=True,
                session_maker=_snippet_session_maker(),
            )

            # response-contract:ignore compact_generate_response
            return helper.compact_generate_response(response)
        except ValueError as e:
            raise e
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/run")
class SnippetDraftWorkflowRunApi(Resource):
    @console_ns.doc("run_snippet_draft_workflow")
    @console_ns.expect(console_ns.models.get(SnippetDraftRunPayload.__name__))
    @console_ns.response(
        200,
        "Draft workflow run started successfully (SSE stream)",
        console_ns.models[EventStreamResponse.__name__],
    )
    @console_ns.response(404, "Snippet or draft workflow not found")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @get_snippet
    @edit_permission_required
    def post(self, current_user: Account, snippet: CustomizedSnippet):
        """
        Run draft workflow for snippet.

        Executes the snippet's draft workflow with the provided inputs
        and returns an SSE event stream with execution progress and results.
        """
        payload = SnippetDraftRunPayload.model_validate(console_ns.payload or {})
        args = payload.model_dump(exclude_none=True)

        try:
            response = SnippetGenerateService.generate(
                snippet=snippet,
                user=current_user,
                args=args,
                invoke_from=InvokeFrom.DEBUGGER,
                streaming=True,
                session_maker=_snippet_session_maker(),
            )

            # response-contract:ignore compact_generate_response
            return helper.compact_generate_response(response)
        except ValueError as e:
            raise e
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


@console_ns.route("/snippets/<uuid:snippet_id>/workflow-runs/tasks/<string:task_id>/stop")
class SnippetWorkflowTaskStopApi(Resource):
    @console_ns.doc("stop_snippet_workflow_task")
    @console_ns.response(200, "Task stopped successfully", console_ns.models[SimpleResultResponse.__name__])
    @console_ns.response(404, "Snippet not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_snippet
    @edit_permission_required
    def post(self, snippet: CustomizedSnippet, task_id: str):
        """
        Stop a running snippet workflow task.

        Uses both the legacy stop flag mechanism and the graph engine
        command channel for backward compatibility.
        """
        # Stop using both mechanisms for backward compatibility
        # Legacy stop flag mechanism (without user check)
        AppQueueManager.set_stop_flag_no_user_check(task_id)

        # New graph engine command channel mechanism
        GraphEngineManager(redis_client).send_stop_command(task_id)

        return SimpleResultResponse(result="success").model_dump(mode="json")
