import contextlib
import logging
import uuid
from collections.abc import Callable, Generator, Mapping
from enum import StrEnum
from typing import Annotated, Any

from celery import shared_task
from flask import current_app, json
from pydantic import BaseModel, Discriminator, Field, Tag
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.execution_coordinator import clear_app_task_cancellation_signals
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    InvokeFrom,
    WorkflowAppGenerateEntity,
)
from core.app.entities.task_entities import WorkflowFinishStreamResponse, WorkflowStartStreamResponse
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig, WorkflowResumptionContext
from core.repositories import DifyCoreRepositoryFactory
from extensions.application_services.workflow import build_workflow_execution_dependencies
from extensions.ext_database import db
from graphon.entities import WorkflowStartReason
from graphon.enums import WorkflowExecutionStatus
from graphon.filters import ResponseStreamFilter
from graphon.runtime import GraphRuntimeState
from libs.datetime_utils import naive_utc_now
from libs.flask_utils import set_login_user
from libs.helper import to_timestamp
from models.account import Account
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import App, AppMode, Conversation, EndUser, Message
from models.workflow import Workflow, WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory
from repositories.workflow.debug_reservation_repository import WorkflowDebugReservationRepository
from repositories.workflow.definition_repository import workflow_from_snapshot
from repositories.workflow.execution_write_repository import WorkflowExecutionWriteRepository
from services.agent.retirement_service import WorkflowAgentRetirementService
from services.errors.workflow_service import WorkflowDebugReservationExpiredError
from services.workflow.contracts import WorkflowSnapshot
from services.workflow.debug_cancellation import DebugExecutionCancellation
from services.workflow.execution.adapters.chatflow.app_generator import AdvancedChatAppGenerator
from services.workflow.execution.adapters.response_converter import WorkflowResponseConverter
from services.workflow.execution.adapters.response_stream import WorkflowEventStream
from services.workflow.execution.adapters.workflow.app_generator import WorkflowAppGenerator
from services.workflow.variable_contracts import WorkflowExecutionVariables

logger = logging.getLogger(__name__)

WORKFLOW_BASED_APP_EXECUTION_QUEUE = "workflow_based_app_execution"


class _UserType(StrEnum):
    ACCOUNT = "account"
    END_USER = "end_user"


class _Account(BaseModel):
    TYPE: _UserType = _UserType.ACCOUNT

    user_id: str


class _EndUser(BaseModel):
    TYPE: _UserType = _UserType.END_USER
    end_user_id: str


def _get_user_type_descriminator(value: Any):
    match value:
        case _Account() | _EndUser():
            return value.TYPE
        case dict():
            user_type_str = value.get("TYPE")
            if user_type_str is None:
                return None
            try:
                user_type = _UserType(user_type_str)
            except ValueError:
                return None
            return user_type
        case _:
            # return None if the discriminator value isn't found
            return None


type User = Annotated[
    (Annotated[_Account, Tag(_UserType.ACCOUNT)] | Annotated[_EndUser, Tag(_UserType.END_USER)]),
    Discriminator(_get_user_type_descriminator),
]


class AppExecutionParams(BaseModel):
    app_id: str
    workflow_id: str
    tenant_id: str
    app_mode: AppMode = AppMode.ADVANCED_CHAT
    user: User
    args: Mapping[str, Any]

    invoke_from: InvokeFrom
    streaming: bool = True
    call_depth: int = 0
    root_node_id: str | None = None
    # Only trigger debugging pins a consumed event to a detached draft revision.
    workflow_snapshot: WorkflowSnapshot | None = None
    workflow_run_id: str = Field(default_factory=lambda: str(uuid.uuid4()))

    @classmethod
    def new(
        cls,
        app_model: App,
        workflow: Workflow,
        user: Account | EndUser,
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool = True,
        call_depth: int = 0,
        root_node_id: str | None = None,
        workflow_run_id: str | None = None,
        workflow_snapshot: WorkflowSnapshot | None = None,
    ):
        user_params: _Account | _EndUser
        match user:
            case Account():
                user_params = _Account(user_id=user.id)
            case EndUser():
                user_params = _EndUser(end_user_id=user.id)
            case _:
                raise AssertionError("this statement should be unreachable.")
        return cls(
            app_id=app_model.id,
            workflow_id=workflow.id,
            tenant_id=app_model.tenant_id,
            app_mode=AppMode.value_of(app_model.mode),
            user=user_params,
            args=args,
            invoke_from=invoke_from,
            streaming=streaming,
            call_depth=call_depth,
            root_node_id=root_node_id,
            workflow_snapshot=workflow_snapshot,
            workflow_run_id=workflow_run_id or str(uuid.uuid4()),
        )


class _AppRunner:
    def __init__(
        self,
        session_factory: sessionmaker | Engine,
        exec_params: AppExecutionParams,
        *,
        variables: WorkflowExecutionVariables,
    ):
        if isinstance(session_factory, Engine):
            session_factory = sessionmaker(bind=session_factory)
        self._session_factory = session_factory
        self._exec_params = exec_params
        self._variables = variables
        self._runtime = build_workflow_execution_dependencies(session_factory)
        self._validated_snapshot = False
        self._execution_finalized = False
        self._cancellation: DebugExecutionCancellation | None = None

    def _mark_execution_finalized(self) -> None:
        self._execution_finalized = True

    @contextlib.contextmanager
    def _session(self):
        with self._session_factory(expire_on_commit=False) as session, session.begin():
            yield session

    @contextlib.contextmanager
    def _setup_flask_context(self, user: Account | EndUser):
        flask_app = current_app._get_current_object()  # type: ignore
        with flask_app.app_context():
            set_login_user(user)
            yield

    def run(self):
        try:
            return self._run()
        except WorkflowDebugReservationExpiredError as exc:
            # claim() runs only after validating the persisted owner and snapshot.
            # An expired request needs to close SSE; duplicate delivery must not
            # emit a failure into the stream owned by an already running worker.
            if self._exec_params.streaming and not self._execution_finalized:
                _publish_failed_workflow_terminal_events(exc=exc, exec_params=self._exec_params)
            raise
        finally:
            snapshot = self._exec_params.workflow_snapshot
            if (
                not self._execution_finalized
                and self._validated_snapshot
                and snapshot is not None
                and snapshot.execution_id is not None
            ):
                WorkflowAgentRetirementService.finish_execution(
                    sessions=self._session_factory,
                    tenant_id=snapshot.tenant_id,
                    app_id=snapshot.app_id,
                    workflow_id=snapshot.id,
                    execution_id=snapshot.execution_id,
                    account_id=snapshot.created_by,
                )

    def _run(self):
        exec_params = self._exec_params
        completed_run: WorkflowRun | None = None
        completed_creator: Account | EndUser | None = None
        with self._session() as session:
            snapshot = exec_params.workflow_snapshot
            reserved_run = None
            if snapshot is not None and snapshot.execution_id is not None:
                reserved_run = session.scalar(
                    select(WorkflowRun)
                    .where(
                        WorkflowRun.id == exec_params.workflow_run_id,
                        WorkflowRun.tenant_id == exec_params.tenant_id,
                        WorkflowRun.app_id == exec_params.app_id,
                        WorkflowRun.workflow_id == exec_params.workflow_id,
                    )
                    .with_for_update()
                )
                if reserved_run is None or (
                    snapshot.execution_id,
                    snapshot.tenant_id,
                    snapshot.app_id,
                    snapshot.id,
                ) != (reserved_run.id, reserved_run.tenant_id, reserved_run.app_id, reserved_run.workflow_id):
                    raise ValueError("Workflow snapshot does not belong to this debugger invocation")
            workflow = session.get(Workflow, exec_params.workflow_id)
            if workflow is None:
                logger.warning("Workflow %s not found for execution", exec_params.workflow_id)
                return None
            app = session.get(App, workflow.app_id)
            if app is None:
                logger.warning("App %s not found for workflow %s", workflow.app_id, exec_params.workflow_id)
                return None

            snapshot = exec_params.workflow_snapshot
            if snapshot is not None:
                if (
                    (snapshot.execution_id is not None and snapshot.execution_id != exec_params.workflow_run_id)
                    or exec_params.invoke_from != InvokeFrom.DEBUGGER
                    or exec_params.app_mode != AppMode.WORKFLOW
                    or app.mode != AppMode.WORKFLOW
                    or (workflow.id, workflow.tenant_id, workflow.app_id)
                    != (exec_params.workflow_id, exec_params.tenant_id, exec_params.app_id)
                    or (snapshot.id, snapshot.tenant_id, snapshot.app_id) != (workflow.id, app.tenant_id, app.id)
                ):
                    raise ValueError("Workflow snapshot does not belong to this debugger invocation")
                workflow = workflow_from_snapshot(snapshot)
                if reserved_run is not None:
                    workflow.graph = reserved_run.graph or snapshot.graph
                    if WorkflowDebugReservationRepository.claim(session, reserved_run, naive_utc_now()):
                        self._validated_snapshot = True
                    else:
                        completed_run = reserved_run
                        self._mark_execution_finalized()
                        if exec_params.streaming:
                            completed_creator = _resolve_user_for_run(session, reserved_run)

        if completed_run is not None:
            # Redelivery never claims a lease, runs the engine, or repeats cleanup.
            # Replay the stored outcome after releasing the read transaction,
            # including failures recorded by expiry recovery before worker startup.
            if completed_creator is not None and completed_run.finished_at is not None:
                response = WorkflowResponseConverter.workflow_run_result_to_finish_response(
                    task_id=exec_params.workflow_run_id,
                    workflow_run=completed_run,
                    creator_user=completed_creator,
                )
                topic = WorkflowEventStream.get_response_topic(exec_params.app_mode, exec_params.workflow_run_id)
                topic.publish(json.dumps(response.model_dump(mode="json"), ensure_ascii=False).encode())
            return None

        with contextlib.nullcontext() if self._validated_snapshot else contextlib.nullcontext() as self._cancellation:
            pause_config = PauseStateLayerConfig(
                session_factory=self._session_factory,
                state_owner_user_id=workflow.created_by,
            )

            user = self._resolve_user()

            with self._setup_flask_context(user):
                try:
                    response = self._run_app(
                        app=app,
                        workflow=workflow,
                        user=user,
                        pause_state_config=pause_config,
                    )
                except Exception as exc:
                    if exec_params.streaming:
                        _publish_failed_workflow_terminal_events(
                            exc=exc,
                            exec_params=exec_params,
                        )
                    raise

                if not exec_params.streaming:
                    return response

                assert isinstance(response, Generator)
                _publish_streaming_response(
                    response,
                    exec_params.workflow_run_id,
                    exec_params.app_mode,
                    exec_params.workflow_id,
                    exec_params.args.get("inputs", {}),
                    WorkflowStartReason.INITIAL,
                    sessions=self._session_factory,
                    tenant_id=app.tenant_id,
                    app_id=app.id,
                    agent_snapshot=exec_params.workflow_snapshot is not None
                    and exec_params.workflow_snapshot.execution_id is not None,
                    on_finalized=self._mark_execution_finalized,
                    on_terminal=self._cancellation.finish if self._cancellation is not None else None,
                )

    def _run_app(
        self,
        *,
        app: App,
        workflow: Workflow,
        user: Account | EndUser,
        pause_state_config: PauseStateLayerConfig,
    ):
        variables = self._variables
        exec_params = self._exec_params
        if exec_params.app_mode == AppMode.ADVANCED_CHAT:
            return AdvancedChatAppGenerator(
                runtime=self._runtime,
                draft_variable_loader=variables.workflow_loader,
                draft_variable_saver=variables.saver_factory,
            ).generate(
                app_model=app,
                workflow=workflow,
                user=user,
                args=exec_params.args,
                invoke_from=exec_params.invoke_from,
                streaming=exec_params.streaming,
                workflow_run_id=exec_params.workflow_run_id,
                pause_state_config=pause_state_config,
            )
        if exec_params.app_mode == AppMode.WORKFLOW:
            return WorkflowAppGenerator(
                runtime=self._runtime,
                draft_variable_loader=variables.workflow_loader,
                draft_variable_saver=variables.saver_factory,
                cancellation=self._cancellation,
            ).generate(
                app_model=app,
                workflow=workflow,
                user=user,
                args=exec_params.args,
                invoke_from=exec_params.invoke_from,
                streaming=exec_params.streaming,
                call_depth=exec_params.call_depth,
                root_node_id=exec_params.root_node_id,
                workflow_run_id=exec_params.workflow_run_id,
                pause_state_config=pause_state_config,
            )

        logger.error("Unsupported app mode for execution: %s", exec_params.app_mode)
        return None

    def _resolve_user(self) -> Account | EndUser:
        user_params = self._exec_params.user

        match user_params:
            case _EndUser():
                with self._session() as session:
                    return session.get(EndUser, user_params.end_user_id)
            case _Account():
                with self._session() as session:
                    user: Account = session.get(Account, user_params.user_id)
                return user
            case _:
                raise AssertionError(f"user should only be _Account or _EndUser, got {type(user_params)}")


def _resolve_user_for_run(session: Session, workflow_run: WorkflowRun) -> Account | EndUser | None:
    role = CreatorUserRole(workflow_run.created_by_role)
    if role == CreatorUserRole.ACCOUNT:
        return session.get(Account, workflow_run.created_by)

    return session.get(EndUser, workflow_run.created_by)


def _publish_failed_workflow_terminal_events(exc: Exception, exec_params: AppExecutionParams) -> None:
    """Publish synthetic workflow lifecycle events for pre-runtime failures.

    Early failures can happen before the app generator creates a task entity or
    emits any workflow queue events. In that window SSE consumers still need a
    normal terminal event to close their state machines, so we synthesize a
    minimal `workflow_started -> workflow_finished(failed)` sequence here.

    `workflow_run_id` is reused as a synthetic `task_id` because no application
    task id exists yet on this failure path.
    """
    timestamp = to_timestamp(naive_utc_now())
    assert timestamp is not None

    topic = WorkflowEventStream.get_response_topic(exec_params.app_mode, exec_params.workflow_run_id)
    started_payload = WorkflowStartStreamResponse(
        task_id=exec_params.workflow_run_id,
        workflow_run_id=exec_params.workflow_run_id,
        data=WorkflowStartStreamResponse.Data(
            id=exec_params.workflow_run_id,
            workflow_id=exec_params.workflow_id,
            inputs=exec_params.args.get("inputs", {}),
            created_at=timestamp,
            reason=WorkflowStartReason.INITIAL,
        ),
    )
    topic.publish(json.dumps(started_payload.model_dump(mode="json"), ensure_ascii=False).encode())

    finished_payload = WorkflowFinishStreamResponse(
        task_id=exec_params.workflow_run_id,
        workflow_run_id=exec_params.workflow_run_id,
        data=WorkflowFinishStreamResponse.Data(
            id=exec_params.workflow_run_id,
            workflow_id=exec_params.workflow_id,
            status=WorkflowExecutionStatus.FAILED,
            outputs=None,
            error=str(exc),
            elapsed_time=0.0,
            total_tokens=0,
            total_steps=0,
            created_by={},
            created_at=timestamp,
            finished_at=timestamp,
            exceptions_count=1,
            files=[],
        ),
    )
    topic.publish(json.dumps(finished_payload.model_dump(mode="json"), ensure_ascii=False).encode())


def _get_event_data(event: str | Mapping[str, Any] | BaseModel) -> Mapping[str, Any] | None:
    if isinstance(event, BaseModel):
        # Temporary compatibility for legacy BaseModel stream events; remove after confirming generators always emit
        # str / Mapping responses.
        return event.model_dump()
    if isinstance(event, Mapping):
        return event
    return None


def _get_event_name(event: str | Mapping[str, Any] | BaseModel) -> str | None:
    event_data = _get_event_data(event)
    if event_data is None:
        return None

    event_name = event_data.get("event")
    if event_name is None:
        return None
    return str(event_name)


def _get_task_id(event: str | Mapping[str, Any] | BaseModel) -> str | None:
    event_data = _get_event_data(event)
    if event_data is None:
        return None

    task_id = event_data.get("task_id")
    return task_id if isinstance(task_id, str) and task_id else None


def _get_error_message(event: str | Mapping[str, Any] | BaseModel) -> str | None:
    event_data = _get_event_data(event)
    if event_data is None:
        return None

    message = event_data.get("message")
    return message if isinstance(message, str) and message else None


def _publish_streaming_response(
    response_stream: Generator[str | Mapping[str, Any] | BaseModel, None, None],
    workflow_run_id: str | uuid.UUID,
    app_mode: AppMode,
    workflow_id: str,
    inputs: Mapping[str, Any],
    started_reason: WorkflowStartReason,
    *,
    sessions: sessionmaker[Session],
    tenant_id: str,
    app_id: str,
    agent_snapshot: bool,
    on_finalized: Callable[[], None] | None = None,
    on_terminal: Callable[[], None] | None = None,
) -> None:
    """Publish engine outcomes, using synthetic failures only before an outcome is known.

    `_AppRunner.run()` provides fallback execution cleanup until this helper
    commits the execution state. Resource cleanup runs after terminal delivery
    and remains independently retryable. An observed pause or completion remains authoritative even when
    delivery fails; retry its actual event once without inventing a failed result.

    Notify the initial runner after execution finalization succeeds, even when
    streaming raises. Its fallback must not infer a second outcome from database
    state that asynchronous persistence may have changed in the meantime.
    """
    normalized_workflow_run_id = str(workflow_run_id)

    def _publish_failed_terminal_event(error_message: str, task_id: str, publish_started: bool) -> None:
        timestamp = to_timestamp(naive_utc_now())
        assert timestamp is not None

        if publish_started:
            started_payload = WorkflowStartStreamResponse(
                task_id=task_id,
                workflow_run_id=normalized_workflow_run_id,
                data=WorkflowStartStreamResponse.Data(
                    id=normalized_workflow_run_id,
                    workflow_id=workflow_id,
                    inputs=inputs,
                    created_at=timestamp,
                    reason=started_reason,
                ),
            )
            topic.publish(
                json.dumps(
                    started_payload.model_dump(mode="json", fallback=str),
                    ensure_ascii=False,
                ).encode()
            )

        finished_payload = WorkflowFinishStreamResponse(
            task_id=task_id,
            workflow_run_id=normalized_workflow_run_id,
            data=WorkflowFinishStreamResponse.Data(
                id=normalized_workflow_run_id,
                workflow_id=workflow_id,
                status=WorkflowExecutionStatus.FAILED,
                outputs=None,
                error=error_message,
                elapsed_time=0.0,
                total_tokens=0,
                total_steps=0,
                created_by={},
                created_at=timestamp,
                finished_at=timestamp,
                exceptions_count=1,
                files=[],
            ),
        )
        topic.publish(json.dumps(finished_payload.model_dump(mode="json"), ensure_ascii=False).encode())

    terminal_events = {"workflow_finished", "workflow_paused"}
    unexpected_stream_end_message = "Workflow stream ended without a terminal event"
    topic = WorkflowEventStream.get_response_topic(app_mode, normalized_workflow_run_id)
    started_published = False
    terminal_published = False
    last_task_id = normalized_workflow_run_id
    stream_error_message: str | None = None

    terminal_status: WorkflowExecutionStatus | None = None
    terminal_payload: str | None = None
    finalized = False

    def finalize() -> None:
        nonlocal finalized
        if agent_snapshot and not finalized:
            WorkflowExecutionWriteRepository(sessions).finish(
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                execution_id=normalized_workflow_run_id,
                status=terminal_status,
            )
            finalized = True
            if on_finalized is not None:
                on_finalized()

    try:
        try:
            for event in response_stream:
                event_name = _get_event_name(event)
                task_id = _get_task_id(event)
                if task_id is not None:
                    last_task_id = task_id

                # Engine outcomes own execution state. Serialization and Redis
                # delivery can fail while a paused execution still needs its Agents.
                if event_name == "workflow_paused":
                    terminal_status = WorkflowExecutionStatus.PAUSED
                elif event_name == "workflow_finished":
                    data = _get_event_data(event) or {}
                    terminal_status = WorkflowExecutionStatus(data.get("data", {}).get("status", "failed"))

                if event_name in terminal_events:
                    if on_terminal is not None:
                        on_terminal()
                    # A subscriber can resume immediately on receiving PAUSED.
                    # Commit and acknowledge this worker's outcome first; neither
                    # this helper nor the outer runner may finalize it again.
                    finalize()

                try:
                    if isinstance(event, BaseModel):
                        payload = json.dumps(event.model_dump(mode="json"), ensure_ascii=False)
                    else:
                        payload = json.dumps(event, ensure_ascii=False, default=str)
                except (TypeError, ValueError):
                    logger.exception("error while encoding event")
                    continue

                if event_name in terminal_events:
                    terminal_payload = payload
                topic.publish(payload.encode())

                if event_name == "workflow_started":
                    started_published = True
                elif event_name in terminal_events:
                    terminal_published = True
                elif event_name == "error":
                    stream_error_message = _get_error_message(event) or stream_error_message
        except Exception as exc:
            if not terminal_published and terminal_payload is not None:
                logger.exception("Retrying engine terminal event publication for run %s", normalized_workflow_run_id)
                topic.publish(terminal_payload.encode())
            elif not terminal_published and terminal_status is None:
                logger.exception(
                    "Workflow stream for run %s failed before terminal event; publishing fallback terminal event",
                    normalized_workflow_run_id,
                )
                _publish_failed_terminal_event(
                    error_message=str(exc) or exc.__class__.__name__,
                    task_id=last_task_id,
                    publish_started=not started_published,
                )
            raise

        if not terminal_published and terminal_status is None:
            logger.warning(
                "Workflow stream for run %s ended without a terminal event; publishing fallback terminal event",
                normalized_workflow_run_id,
            )
            _publish_failed_terminal_event(
                error_message=stream_error_message or unexpected_stream_end_message,
                task_id=last_task_id,
                publish_started=not started_published,
            )
    finally:
        try:
            if isinstance(response_stream, Generator):
                response_stream.close()
        finally:
            finalize()
            if agent_snapshot and finalized:
                # Cleanup dispatch is independent of the engine outcome and SSE.
                # Retain durable retry evidence if the resource broker is down.
                try:
                    WorkflowAgentRetirementService.retire_finished_execution(
                        delete_unstarted=False,
                        sessions=sessions,
                        tenant_id=tenant_id,
                        app_id=app_id,
                        workflow_id=workflow_id,
                        execution_id=normalized_workflow_run_id,
                        account_id=None,
                    )
                except Exception:
                    logger.exception("Failed to dispatch Agent cleanup for run %s", normalized_workflow_run_id)


@shared_task(queue=WORKFLOW_BASED_APP_EXECUTION_QUEUE)
def workflow_based_app_execution_task(
    payload: str,
) -> Mapping[str, Any] | None:
    from extensions.ext_application_services import application_services

    exec_params = AppExecutionParams.model_validate_json(payload)

    logger.info("workflow_based_app_execution_task run with params: %s", exec_params)

    runner = _AppRunner(db.engine, exec_params=exec_params, variables=application_services().workflow_variables)
    return runner.run()


def _resume_app_execution(payload: dict[str, Any], *, variables: WorkflowExecutionVariables) -> None:
    workflow_run_id = payload["workflow_run_id"]

    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
    workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker=session_factory)

    pause_entity = workflow_run_repo.get_workflow_pause(workflow_run_id)
    if pause_entity is None:
        logger.warning("No pause entity found for workflow run %s", workflow_run_id)
        return

    try:
        resumption_context = WorkflowResumptionContext.loads(pause_entity.get_state().decode())
    except Exception:
        logger.exception("Failed to load resumption context for workflow run %s", workflow_run_id)
        return

    generate_entity = resumption_context.get_generate_entity()

    graph_runtime_state = GraphRuntimeState.from_snapshot(resumption_context.serialized_graph_runtime_state)
    response_stream_filter = resumption_context.get_response_stream_filter()

    conversation = None
    message = None
    with Session(db.engine, expire_on_commit=False) as session:
        workflow_run = session.get(WorkflowRun, workflow_run_id)
        if workflow_run is None:
            logger.warning("Workflow run %s not found during resume", workflow_run_id)
            return

        workflow = session.get(Workflow, workflow_run.workflow_id)
        if workflow is None:
            logger.warning("Workflow %s not found during resume", workflow_run.workflow_id)
            return

        app_model = session.get(App, workflow_run.app_id)
        if app_model is None:
            logger.warning("App %s not found during resume", workflow_run.app_id)
            return

        user = _resolve_user_for_run(session, workflow_run)
        if user is None:
            logger.warning("User %s not found for workflow run %s", workflow_run.created_by, workflow_run_id)
            return

        if isinstance(generate_entity, AdvancedChatAppGenerateEntity):
            if generate_entity.conversation_id is None:
                logger.warning("Conversation id missing in resumption context for workflow run %s", workflow_run_id)
                return

            conversation = session.get(Conversation, generate_entity.conversation_id)
            if conversation is None:
                logger.warning(
                    "Conversation %s not found for workflow run %s", generate_entity.conversation_id, workflow_run_id
                )
                return

            message = session.scalar(
                select(Message)
                .where(
                    Message.conversation_id == conversation.id,
                    Message.workflow_run_id == workflow_run_id,
                )
                .order_by(Message.created_at.desc())
                .limit(1)
            )
            if message is None:
                logger.warning("Message not found for workflow run %s", workflow_run_id)
                return

    binding_snapshot = workflow_run.graph_dict.get("_agent_bindings", {})
    if binding_snapshot.get("execution_id") == workflow_run.id and workflow_run.graph is not None:
        # The resumed graph and its Agent generations belong to the original execution.
        workflow.graph = workflow_run.graph

    if not isinstance(generate_entity, (AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity)):
        logger.error(
            "Unsupported resumption entity for workflow run %s (found %s)",
            workflow_run_id,
            type(generate_entity),
        )
        return

    # The resumed attempt reuses the paused run's task ID, so cancellation
    # signals armed against that ID before or during the pause would abort it
    # immediately and report it as stopped by the user. This attempt is starting
    # deliberately, so drop them before any engine can observe them.
    clear_app_task_cancellation_signals(generate_entity.task_id)

    workflow_run_repo.resume_workflow_pause(workflow_run_id, pause_entity)

    pause_config = PauseStateLayerConfig(
        session_factory=session_factory,
        state_owner_user_id=workflow.created_by,
    )

    match generate_entity:
        case AdvancedChatAppGenerateEntity():
            assert conversation is not None
            assert message is not None
            _resume_advanced_chat(
                variables=variables,
                app_model=app_model,
                workflow=workflow,
                user=user,
                conversation=conversation,
                message=message,
                generate_entity=generate_entity,
                graph_runtime_state=graph_runtime_state,
                response_stream_filter=response_stream_filter,
                session_factory=session_factory,
                pause_state_config=pause_config,
                workflow_run_id=workflow_run_id,
                workflow_run=workflow_run,
            )
        case WorkflowAppGenerateEntity():
            _resume_workflow(
                variables=variables,
                app_model=app_model,
                workflow=workflow,
                user=user,
                generate_entity=generate_entity,
                graph_runtime_state=graph_runtime_state,
                response_stream_filter=response_stream_filter,
                session_factory=session_factory,
                pause_state_config=pause_config,
                workflow_run_id=workflow_run_id,
                workflow_run=workflow_run,
                workflow_run_repo=workflow_run_repo,
                pause_entity=pause_entity,
            )


def _resume_advanced_chat(
    *,
    variables: WorkflowExecutionVariables,
    app_model: App,
    workflow: Workflow,
    user: Account | EndUser,
    conversation: Conversation,
    message: Message,
    generate_entity: AdvancedChatAppGenerateEntity,
    graph_runtime_state: GraphRuntimeState,
    response_stream_filter: ResponseStreamFilter,
    session_factory: sessionmaker,
    pause_state_config: PauseStateLayerConfig,
    workflow_run_id: str,
    workflow_run: WorkflowRun,
) -> None:
    resumed_generate_entity = generate_entity.model_copy(update={"stream": True})

    try:
        triggered_from = WorkflowRunTriggeredFrom(workflow_run.triggered_from)
    except ValueError:
        triggered_from = WorkflowRunTriggeredFrom.APP_RUN

    workflow_execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
        session_factory=session_factory,
        tenant_id=app_model.tenant_id,
        user=user,
        app_id=app_model.id,
        triggered_from=triggered_from,
    )
    workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
        session_factory=session_factory,
        tenant_id=app_model.tenant_id,
        user=user,
        app_id=app_model.id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    generator = AdvancedChatAppGenerator(
        runtime=build_workflow_execution_dependencies(session_factory),
        draft_variable_loader=variables.workflow_loader,
        draft_variable_saver=variables.saver_factory,
    )

    try:
        response = generator.resume(
            app_model=app_model,
            workflow=workflow,
            user=user,
            conversation=conversation,
            message=message,
            application_generate_entity=resumed_generate_entity,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            graph_runtime_state=graph_runtime_state,
            pause_state_config=pause_state_config,
            response_stream_filter=response_stream_filter,
        )
    except Exception:
        logger.exception("Failed to resume chatflow execution for workflow run %s", workflow_run_id)
        raise

    assert isinstance(response, Generator)
    _publish_streaming_response(
        response,
        workflow_run_id,
        AppMode.ADVANCED_CHAT,
        workflow.id,
        generate_entity.inputs,
        WorkflowStartReason.RESUMPTION,
        sessions=session_factory,
        tenant_id=workflow.tenant_id,
        app_id=workflow.app_id,
        agent_snapshot="_agent_bindings" in workflow_run.graph_dict,
    )


def _resume_workflow(
    *,
    variables: WorkflowExecutionVariables,
    app_model: App,
    workflow: Workflow,
    user: Account | EndUser,
    generate_entity: WorkflowAppGenerateEntity,
    graph_runtime_state: GraphRuntimeState,
    response_stream_filter: ResponseStreamFilter,
    session_factory: sessionmaker,
    pause_state_config: PauseStateLayerConfig,
    workflow_run_id: str,
    workflow_run: WorkflowRun,
    workflow_run_repo,
    pause_entity,
) -> None:
    resumed_generate_entity = generate_entity.model_copy(update={"stream": True})

    try:
        triggered_from = WorkflowRunTriggeredFrom(workflow_run.triggered_from)
    except ValueError:
        triggered_from = WorkflowRunTriggeredFrom.APP_RUN

    workflow_execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
        session_factory=session_factory,
        tenant_id=app_model.tenant_id,
        user=user,
        app_id=app_model.id,
        triggered_from=triggered_from,
    )
    workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
        session_factory=session_factory,
        tenant_id=app_model.tenant_id,
        user=user,
        app_id=app_model.id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    with (
        contextlib.nullcontext()
        if workflow_run.graph_dict.get("_agent_bindings", {}).get("execution_id") == workflow_run_id
        else contextlib.nullcontext()
    ) as cancellation:
        generator = WorkflowAppGenerator(
            runtime=build_workflow_execution_dependencies(session_factory),
            draft_variable_loader=variables.workflow_loader,
            draft_variable_saver=variables.saver_factory,
            cancellation=cancellation,
        )
        try:
            response = generator.resume(
                app_model=app_model,
                workflow=workflow,
                user=user,
                application_generate_entity=resumed_generate_entity,
                graph_runtime_state=graph_runtime_state,
                workflow_execution_repository=workflow_execution_repository,
                workflow_node_execution_repository=workflow_node_execution_repository,
                pause_state_config=pause_state_config,
                response_stream_filter=response_stream_filter,
            )
        except Exception:
            logger.exception("Failed to resume workflow execution for workflow run %s", workflow_run_id)
            raise

        assert isinstance(response, Generator)
        _publish_streaming_response(
            response,
            workflow_run_id,
            AppMode.WORKFLOW,
            workflow.id,
            generate_entity.inputs,
            WorkflowStartReason.RESUMPTION,
            sessions=session_factory,
            tenant_id=workflow.tenant_id,
            app_id=workflow.app_id,
            agent_snapshot="_agent_bindings" in workflow_run.graph_dict,
            on_terminal=cancellation.finish if cancellation is not None else None,
        )

    try:
        workflow_run_repo.delete_workflow_pause(pause_entity)
    except Exception as exc:
        if exc.__class__.__name__ != "_WorkflowRunError" or "WorkflowPause not found" not in str(exc):
            raise
        logger.info(
            "Skipped deleting workflow pause %s after resume because it was already replaced or removed",
            pause_entity.id,
        )


@shared_task(queue=WORKFLOW_BASED_APP_EXECUTION_QUEUE, name="resume_app_execution")
def resume_app_execution(payload: dict[str, Any]) -> None:
    from extensions.ext_application_services import application_services

    _resume_app_execution(payload, variables=application_services().workflow_variables)
