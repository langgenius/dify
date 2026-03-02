import logging
import threading
from collections.abc import Generator, Mapping
from typing import Any, Literal

from celery import shared_task
from flask import current_app, json
from pydantic import BaseModel
from sqlalchemy.orm import Session, sessionmaker

import contexts
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.apps.workflow.app_config_manager import WorkflowAppConfigManager
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.task_entities import StreamEvent
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from core.ops.ops_trace_manager import TraceQueueManager
from core.repositories import DifyCoreRepositoryFactory
from dify_graph.entities.workflow_execution import WorkflowRunRerunMetadata
from dify_graph.enums import WorkflowExecutionStatus
from dify_graph.runtime import GraphRuntimeState
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.flask_utils import set_login_user
from models import Account, EndUser, WorkflowNodeExecutionTriggeredFrom
from models.enums import WorkflowRunTriggeredFrom
from models.model import App, AppMode
from models.workflow import Workflow

logger = logging.getLogger(__name__)

WORKFLOW_RUN_RERUN_QUEUE = "workflow_based_app_execution"


class WorkflowRunRerunTaskPayload(BaseModel):
    app_id: str
    workflow_id: str
    tenant_id: str
    user_id: str
    user_role: Literal["account", "end_user"]
    task_id: str
    workflow_run_id: str
    target_node_id: str
    user_inputs: dict[str, Any]
    execution_graph_config: dict[str, Any]
    rerun_metadata: WorkflowRunRerunMetadata
    graph_runtime_state_snapshot: str


def _publish_streaming_response(
    response_stream: Generator[str | Mapping[str, Any], None, None],
    workflow_run_id: str,
) -> None:
    topic = MessageBasedAppGenerator.get_response_topic(AppMode.WORKFLOW, workflow_run_id)
    for event in response_stream:
        try:
            payload = json.dumps(event)
        except TypeError:
            logger.exception("error while encoding rerun event")
            continue

        topic.publish(payload.encode())


def _resolve_user(session: Session, payload: WorkflowRunRerunTaskPayload) -> Account | EndUser | None:
    if payload.user_role == "end_user":
        return session.get(EndUser, payload.user_id)

    user = session.get(Account, payload.user_id)
    if user:
        user.set_tenant_id(payload.tenant_id)
    return user


def _resolve_invoke_from(user_role: Literal["account", "end_user"]) -> InvokeFrom:
    if user_role == "account":
        return InvokeFrom.DEBUGGER
    return InvokeFrom.SERVICE_API


def _publish_failed_terminal_event(
    *,
    task_id: str,
    workflow_run_id: str,
    workflow_id: str,
    error: str,
) -> None:
    now = int(naive_utc_now().timestamp())
    event = {
        "event": StreamEvent.WORKFLOW_FINISHED.value,
        "task_id": task_id,
        "workflow_run_id": workflow_run_id,
        "data": {
            "id": workflow_run_id,
            "workflow_id": workflow_id,
            "status": WorkflowExecutionStatus.FAILED.value,
            "outputs": None,
            "error": error,
            "elapsed_time": 0.0,
            "total_tokens": 0,
            "total_steps": 0,
            "created_by": {},
            "created_at": now,
            "finished_at": now,
            "exceptions_count": 1,
            "files": [],
        },
    }
    topic = MessageBasedAppGenerator.get_response_topic(AppMode.WORKFLOW, workflow_run_id)
    topic.publish(json.dumps(event).encode())


def _extract_terminal_event_identifiers(payload: str) -> tuple[str, str, str] | None:
    try:
        payload_dict = json.loads(payload)
    except Exception:
        return None

    if not isinstance(payload_dict, dict):
        return None

    task_id = payload_dict.get("task_id")
    workflow_run_id = payload_dict.get("workflow_run_id")
    workflow_id = payload_dict.get("workflow_id")
    if not (isinstance(task_id, str) and isinstance(workflow_run_id, str) and isinstance(workflow_id, str)):
        return None
    return task_id, workflow_run_id, workflow_id


@shared_task(queue=WORKFLOW_RUN_RERUN_QUEUE)
def workflow_run_rerun_task(payload: str) -> None:
    try:
        params = WorkflowRunRerunTaskPayload.model_validate_json(payload)
    except Exception:
        logger.exception("Invalid workflow rerun task payload")
        identifiers = _extract_terminal_event_identifiers(payload)
        if identifiers is not None:
            task_id, workflow_run_id, workflow_id = identifiers
            try:
                _publish_failed_terminal_event(
                    task_id=task_id,
                    workflow_run_id=workflow_run_id,
                    workflow_id=workflow_id,
                    error="Invalid rerun task payload.",
                )
            except Exception:
                logger.exception(
                    "Failed to publish rerun terminal event for invalid payload workflow_id=%s workflow_run_id=%s",
                    workflow_id,
                    workflow_run_id,
                )
        return

    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)

    def _log_failure(message: str) -> None:
        logger.warning(
            "%s tenant_id=%s app_id=%s workflow_id=%s workflow_run_id=%s",
            message,
            params.tenant_id,
            params.app_id,
            params.workflow_id,
            params.workflow_run_id,
        )

    def _publish_failure(message: str) -> None:
        try:
            _publish_failed_terminal_event(
                task_id=params.task_id,
                workflow_run_id=params.workflow_run_id,
                workflow_id=params.workflow_id,
                error=message,
            )
        except Exception:
            logger.exception(
                "Failed to publish rerun terminal event tenant_id=%s app_id=%s workflow_id=%s workflow_run_id=%s",
                params.tenant_id,
                params.app_id,
                params.workflow_id,
                params.workflow_run_id,
            )

    try:
        with Session(db.engine, expire_on_commit=False) as session:
            workflow = session.get(Workflow, params.workflow_id)
            if workflow is None:
                message = "Workflow not found for rerun task."
                _log_failure(message)
                _publish_failure(message)
                return

            if workflow.app_id != params.app_id or workflow.tenant_id != params.tenant_id:
                message = "Workflow ownership mismatch for rerun task."
                _log_failure(message)
                _publish_failure(message)
                return

            app_model = session.get(App, params.app_id)
            if app_model is None:
                message = "App not found for rerun task."
                _log_failure(message)
                _publish_failure(message)
                return

            if app_model.tenant_id != params.tenant_id:
                message = "App ownership mismatch for rerun task."
                _log_failure(message)
                _publish_failure(message)
                return

            user = _resolve_user(session, params)
            if user is None:
                message = "User not found for rerun task."
                _log_failure(message)
                _publish_failure(message)
                return

            if isinstance(user, Account):
                if user.current_tenant_id != params.tenant_id:
                    message = "Account tenant mismatch for rerun task."
                    _log_failure(message)
                    _publish_failure(message)
                    return
            elif user.tenant_id != params.tenant_id:
                message = "End user tenant mismatch for rerun task."
                _log_failure(message)
                _publish_failure(message)
                return

        app_config = WorkflowAppConfigManager.get_app_config(app_model=app_model, workflow=workflow)
        file_upload_config = FileUploadConfigManager.convert(workflow.features_dict, is_vision=False)
        trace_user_id = user.id if isinstance(user, Account) else user.session_id
        trace_manager = TraceQueueManager(app_id=app_model.id, user_id=trace_user_id)
        invoke_from = _resolve_invoke_from(params.user_role)
        generate_entity = WorkflowAppGenerateEntity(
            task_id=params.task_id,
            app_config=app_config,
            file_upload_config=file_upload_config,
            inputs=params.user_inputs,
            files=[],
            user_id=user.id,
            stream=True,
            invoke_from=invoke_from,
            call_depth=0,
            trace_manager=trace_manager,
            workflow_execution_id=params.workflow_run_id,
        )

        contexts.plugin_tool_providers.set({})
        contexts.plugin_tool_providers_lock.set(threading.Lock())

        workflow_execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
            session_factory=session_factory,
            user=user,
            app_id=app_model.id,
            triggered_from=WorkflowRunTriggeredFrom.RERUN,
        )
        workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=session_factory,
            user=user,
            app_id=app_model.id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )
        pause_state_config = PauseStateLayerConfig(
            session_factory=session_factory,
            state_owner_user_id=workflow.created_by,
        )
        graph_runtime_state = GraphRuntimeState.from_snapshot(params.graph_runtime_state_snapshot)

        flask_app = current_app._get_current_object()  # type: ignore
        with flask_app.app_context():
            set_login_user(user)
            response = WorkflowAppGenerator().rerun(
                app_model=app_model,
                workflow=workflow,
                user=user,
                application_generate_entity=generate_entity,
                workflow_execution_repository=workflow_execution_repository,
                workflow_node_execution_repository=workflow_node_execution_repository,
                execution_graph_config=params.execution_graph_config,
                graph_runtime_state=graph_runtime_state,
                rerun_metadata=params.rerun_metadata,
                root_node_id=params.target_node_id,
                streaming=True,
                pause_state_config=pause_state_config,
            )

            if isinstance(response, Generator):
                _publish_streaming_response(response, params.workflow_run_id)
    except Exception:
        logger.exception(
            "Failed to execute workflow rerun task tenant_id=%s app_id=%s workflow_id=%s workflow_run_id=%s",
            params.tenant_id,
            params.app_id,
            params.workflow_id,
            params.workflow_run_id,
        )
        _publish_failure("Rerun execution failed.")
        raise
