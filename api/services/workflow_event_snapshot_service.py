from __future__ import annotations

import json
import logging
import queue
import threading
import time
from collections.abc import Generator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from sqlalchemy import desc, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.apps.message_generator import MessageGenerator
from core.app.apps.streaming_utils import StreamEventWithCursor, stream_topic_events
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity
from core.app.entities.task_entities import (
    HumanInputRequiredResponse,
    MessageEndStreamResponse,
    MessageReplaceStreamResponse,
    NodeFinishStreamResponse,
    NodeStartStreamResponse,
    StreamEvent,
    WorkflowFinishStreamResponse,
    WorkflowPauseStreamResponse,
    WorkflowStartStreamResponse,
)
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
from core.workflow.human_input_forms import (
    load_form_dispositions_by_form_id,
)
from core.workflow.human_input_policy import (
    FormDisposition,
    HumanInputSurface,
    enrich_human_input_pause_reasons,
    resolve_human_input_pause_reason_inputs,
    resolve_variable_select_input_options,
)
from core.workflow.nodes.human_input.pause_reason import (
    DifyHITLEventType,
    HumanInputRequired,
)
from extensions.ext_storage import storage
from graphon.entities import WorkflowStartReason
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from graphon.runtime import GraphRuntimeState
from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool
from graphon.workflow_type_encoder import WorkflowRuntimeTypeConverter
from libs.broadcast_channel.channel import CursorMessage, Topic
from libs.broadcast_channel.cursor import normalize_stream_cursor
from libs.broadcast_channel.exc import SubscriptionClosedError
from models.enums import WorkflowRunTriggeredFrom
from models.human_input import HumanInputForm
from models.model import AppMode, Message
from models.workflow import WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from models.workflow_handoff import WorkflowRunHandoff
from repositories.api_workflow_node_execution_repository import WorkflowNodeExecutionSnapshot
from repositories.entities.workflow_pause import WorkflowPauseEntity
from repositories.factory import DifyAPIRepositoryFactory
from repositories.sqlalchemy_workflow_handoff_repository import SQLAlchemyWorkflowRunHandoffRepository
from services.workflow_handoff_service import WorkflowHandoffService

logger = logging.getLogger(__name__)

_TERMINAL_WORKFLOW_STATUSES = frozenset(
    {
        WorkflowExecutionStatus.SUCCEEDED,
        WorkflowExecutionStatus.FAILED,
        WorkflowExecutionStatus.STOPPED,
        WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
    }
)


@dataclass(frozen=True)
class MessageContext:
    conversation_id: str
    message_id: str
    created_at: int
    answer: str | None = None


@dataclass
class BufferState:
    queue: queue.Queue[Mapping[str, Any] | StreamEventWithCursor]
    stop_event: threading.Event
    done_event: threading.Event
    task_id_ready: threading.Event
    task_id_hint: str | None = None


@runtime_checkable
class _RetainedCursorTopic(Protocol):
    def earliest_cursor(self) -> str | None: ...

    def latest_cursor(self) -> str | None: ...


@runtime_checkable
class _CursorReceiver(Protocol):
    def receive_with_cursor(self, timeout: float | None = 0.1) -> CursorMessage | None: ...


def build_workflow_event_stream(
    *,
    app_mode: AppMode,
    workflow_run: WorkflowRun,
    tenant_id: str,
    app_id: str,
    session_maker: sessionmaker[Session],
    human_input_surface: HumanInputSurface | None = None,
    idle_timeout: float = 300,
    ping_interval: float = 10.0,
    close_on_pause: bool = True,
    cursor: str | None = None,
    node_execution_triggered_from: WorkflowNodeExecutionTriggeredFrom | None = None,
) -> Generator[Mapping[str, Any] | StreamEventWithCursor | str, None, None]:
    topic = MessageGenerator.get_response_topic(app_mode, workflow_run.id)

    terminal_events = None if close_on_pause else [StreamEvent.WORKFLOW_FINISHED]
    has_retained_events = _topic_has_retained_events(topic)
    force_cursor_snapshot = False
    if cursor is not None:
        normalized_cursor = normalize_stream_cursor(cursor)
        retained_window = _topic_retained_cursor_window(topic)
        cursor_key = _stream_cursor_key(normalized_cursor)

        # A terminal database row is the authoritative full-state replacement.
        # Replaying strictly after a tail cursor would otherwise wait for the
        # normal 300-second idle timeout even though no future event can arrive.
        if workflow_run.status in _TERMINAL_WORKFLOW_STATUSES:
            force_cursor_snapshot = True
        elif retained_window is not None:
            earliest_cursor, latest_cursor = retained_window
            earliest_key = _stream_cursor_key(earliest_cursor)
            latest_key = _stream_cursor_key(latest_cursor)
            cursor_is_replayable = normalized_cursor == "0-0" or earliest_key <= cursor_key <= latest_key

            # A closed pause stream whose cursor already addresses the retained
            # tail also needs a persisted pause event rather than a long wait.
            cursor_is_closed_pause_tail = (
                close_on_pause and workflow_run.status == WorkflowExecutionStatus.PAUSED and cursor_key == latest_key
            )
            if cursor_is_replayable and not cursor_is_closed_pause_tail:
                return stream_topic_events(
                    topic=topic,
                    idle_timeout=idle_timeout,
                    ping_interval=ping_interval,
                    terminal_events=terminal_events,
                    cursor=normalized_cursor,
                )
            force_cursor_snapshot = True
        else:
            # The key expired (or the transport cannot prove that this cursor
            # is still retained). Reconstruct current state from the database
            # and buffer live events so RUNNING runs do not lose the gap.
            force_cursor_snapshot = True

    # A paused or terminal run can outlive its Redis Streams retention window.
    # In that case a Last-Event-ID no longer has a log to address; fall through
    # to the persisted snapshot so reconnect emits a full-state pause/terminal
    # event instead of a lone ping followed by EOF.

    if has_retained_events and not force_cursor_snapshot:
        # The durable event log is the primary source of continuation truth.
        # Replaying it is both ordered and cursor-addressable; the DB snapshot
        # remains a compatibility fallback for runs whose event log predates
        # Streams or has expired.
        return stream_topic_events(
            topic=topic,
            idle_timeout=idle_timeout,
            ping_interval=ping_interval,
            terminal_events=terminal_events,
            cursor="0-0",
        )

    workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)
    node_execution_repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(session_maker)

    pause_entity: WorkflowPauseEntity | None = None
    if workflow_run.status == WorkflowExecutionStatus.PAUSED:
        try:
            pause_entity = workflow_run_repo.get_workflow_pause(workflow_run.id)
        except Exception:
            logger.exception("Failed to load workflow pause for run %s", workflow_run.id)
            pause_entity = None

    resumption_context = _load_resumption_context(pause_entity)
    latest_handoff = _get_latest_workflow_handoff(session_maker, workflow_run.id)
    handoff_resumption_context = None
    if resumption_context is None and latest_handoff is not None:
        handoff_resumption_context = _load_handoff_resumption_context(
            session_maker=session_maker,
            handoff=latest_handoff,
        )
    resolved_node_triggered_from = _resolve_node_execution_triggered_from(
        workflow_run=workflow_run,
        resumption_context=resumption_context or handoff_resumption_context,
        override=node_execution_triggered_from,
    )
    message_context: MessageContext | None = None
    if app_mode == AppMode.ADVANCED_CHAT:
        if workflow_run.status == WorkflowExecutionStatus.PAUSED:
            if resumption_context is None:
                raise AssertionError(
                    "WorkflowResumptionContext is required for advanced-chat snapshot replay, "
                    f"workflow_run_id={workflow_run.id}"
                )
            generate_entity = resumption_context.get_generate_entity()
            if not isinstance(generate_entity, AdvancedChatAppGenerateEntity):
                raise AssertionError(
                    "AdvancedChatAppGenerateEntity is required for advanced-chat snapshot replay, "
                    f"workflow_run_id={workflow_run.id}, generate_entity_type={type(generate_entity).__name__}"
                )
            if not generate_entity.conversation_id:
                raise AssertionError(
                    f"conversation_id is required for advanced-chat snapshot replay, workflow_run_id={workflow_run.id}"
                )
            message_context = _get_message_context_by_conversation(
                session_maker,
                conversation_id=generate_entity.conversation_id,
                workflow_run_id=workflow_run.id,
            )
        else:
            # Compatibility fallback for non-suspended snapshot requests. This app-scoped lookup is not optimal;
            # a dedicated index or stronger lookup key would be preferable.
            message_context = _get_message_context_by_app(
                session_maker,
                app_id=app_id,
                workflow_run_id=workflow_run.id,
            )

    node_snapshots = node_execution_repo.get_execution_snapshots_by_workflow_run(
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_run.workflow_id,
        # ``triggered_from`` is part of the node-execution lookup index. It must
        # match the repository used by the original or resumed execution: one-
        # step runs write SINGLE_STEP rows, full RAG runs write
        # RAG_PIPELINE_RUN rows, and ordinary runs write WORKFLOW_RUN rows.
        triggered_from=resolved_node_triggered_from,
        workflow_run_id=workflow_run.id,
    )

    def _generate() -> Generator[Mapping[str, Any] | StreamEventWithCursor | str, None, None]:
        # Close the small check/query race without combining a DB snapshot with
        # an already-retained event log.  If events arrived while the fallback
        # snapshot was being read, replay the log instead.
        if not force_cursor_snapshot and _topic_has_retained_events(topic):
            yield from stream_topic_events(
                topic=topic,
                idle_timeout=idle_timeout,
                ping_interval=ping_interval,
                terminal_events=terminal_events,
                cursor="0-0",
            )
            return

        # send a PING event immediately to prevent the connection staying in pending state for a long time.
        #
        # This simplify the debugging process as the DevTools in Chrome does not
        # provide complete curl command for pending connections.
        yield StreamEvent.PING.value

        last_msg_time = time.time()
        last_ping_time = last_msg_time

        with topic.subscribe() as sub:
            buffer_state = _start_buffering(sub)
            try:
                task_id = _resolve_task_id(
                    resumption_context,
                    buffer_state,
                    workflow_run.id,
                    latest_handoff_task_id=latest_handoff.task_id if latest_handoff is not None else None,
                )

                snapshot_events = _build_snapshot_events(
                    workflow_run=workflow_run,
                    node_snapshots=node_snapshots,
                    task_id=task_id,
                    message_context=message_context,
                    pause_entity=pause_entity,
                    resumption_context=resumption_context,
                    session_maker=session_maker,
                    human_input_surface=human_input_surface,
                )

                for snapshot_event in snapshot_events:
                    last_msg_time = time.time()
                    last_ping_time = last_msg_time
                    yield snapshot_event
                    if _is_terminal_event(snapshot_event, close_on_pause=close_on_pause):
                        return

                while True:
                    if buffer_state.done_event.is_set() and buffer_state.queue.empty():
                        return

                    try:
                        event = buffer_state.queue.get(timeout=1)
                    except queue.Empty:
                        current_time = time.time()
                        if current_time - last_msg_time > idle_timeout:
                            logger.debug(
                                "Idle timeout of %s seconds reached, closing workflow event stream.",
                                idle_timeout,
                            )
                            return
                        if current_time - last_ping_time >= ping_interval:
                            yield StreamEvent.PING.value
                            last_ping_time = current_time
                        continue

                    last_msg_time = time.time()
                    last_ping_time = last_msg_time
                    yield event
                    if _is_terminal_event(event, close_on_pause=close_on_pause):
                        return
            finally:
                buffer_state.stop_event.set()

    return _generate()


def _topic_has_retained_events(topic: Topic) -> bool:
    if not isinstance(topic, _RetainedCursorTopic):
        return False
    try:
        return topic.latest_cursor() is not None
    except Exception:
        logger.exception("Failed to inspect retained workflow events")
        return False


def _topic_retained_cursor_window(topic: Topic) -> tuple[str, str] | None:
    if not isinstance(topic, _RetainedCursorTopic):
        return None
    try:
        earliest = topic.earliest_cursor()
        latest = topic.latest_cursor()
    except Exception:
        logger.exception("Failed to inspect retained workflow event cursor window")
        return None
    if earliest is None or latest is None:
        return None
    return normalize_stream_cursor(earliest), normalize_stream_cursor(latest)


def _stream_cursor_key(cursor: str) -> tuple[int, int]:
    milliseconds, sequence = normalize_stream_cursor(cursor).split("-", maxsplit=1)
    return int(milliseconds), int(sequence)


def _get_message_context_by_conversation(
    session_maker: sessionmaker[Session],
    *,
    conversation_id: str,
    workflow_run_id: str,
) -> MessageContext | None:
    """Look up a paused or suspended Advanced Chat snapshot message by conversation and workflow run.

    Use this exact lookup after recovering ``conversation_id`` from persisted resumption context. Its predicates match
    ``message_workflow_run_id_idx``.
    """
    with session_maker() as session:
        stmt = (
            select(Message)
            .where(
                Message.conversation_id == conversation_id,
                Message.workflow_run_id == workflow_run_id,
            )
            .order_by(desc(Message.created_at))
            .limit(1)
        )
        message = session.scalar(stmt)
        if message is None:
            return None
        return _to_message_context(message)


def _get_message_context_by_app(
    session_maker: sessionmaker[Session],
    *,
    app_id: str,
    workflow_run_id: str,
) -> MessageContext | None:
    """Look up a non-suspended or running Advanced Chat reconnect snapshot by app and workflow run.

    This compatibility path applies only when no resumption context is expected. The app-scoped query is not optimal;
    a dedicated index or stronger lookup key would be preferable.
    """
    with session_maker() as session:
        stmt = (
            select(Message)
            .where(
                Message.app_id == app_id,
                Message.workflow_run_id == workflow_run_id,
            )
            .order_by(desc(Message.created_at))
            .limit(1)
        )
        message = session.scalar(stmt)
        if message is None:
            return None
        return _to_message_context(message)


def _to_message_context(message: Message) -> MessageContext:
    created_at = int(message.created_at.timestamp()) if message.created_at else 0
    return MessageContext(
        conversation_id=message.conversation_id,
        message_id=message.id,
        created_at=created_at,
        answer=message.answer,
    )


def _load_resumption_context(pause_entity: WorkflowPauseEntity | None) -> WorkflowResumptionContext | None:
    if pause_entity is None:
        return None
    try:
        raw_state = pause_entity.get_state().decode()
        return WorkflowResumptionContext.loads(raw_state)
    except Exception:
        logger.exception("Failed to load resumption context")
        return None


def _get_latest_workflow_handoff(
    session_maker: sessionmaker[Session],
    workflow_run_id: str,
) -> WorkflowRunHandoff | None:
    """Return the newest durable execution segment, if the run was handed off."""
    try:
        handoff = SQLAlchemyWorkflowRunHandoffRepository(session_maker).get_latest_by_run(workflow_run_id)
    except Exception:
        # Snapshot reconnect must remain compatible with runs created before
        # handoff support and with a rolling migration where this best-effort
        # lookup is temporarily unavailable.
        logger.warning(
            "Failed to load latest workflow handoff for event snapshot, workflow_run_id=%s",
            workflow_run_id,
            exc_info=True,
        )
        return None
    # Test doubles and compatibility session factories can return an untyped
    # sentinel. Do not let it leak into the public event contract.
    return handoff if isinstance(handoff, WorkflowRunHandoff) else None


def _load_handoff_resumption_context(
    *,
    session_maker: sessionmaker[Session],
    handoff: WorkflowRunHandoff,
) -> WorkflowResumptionContext | None:
    """Best-effort load of the generate entity that produced a handoff segment."""
    try:
        handoff_service = WorkflowHandoffService(
            repository=SQLAlchemyWorkflowRunHandoffRepository(session_maker),
            storage=storage,
        )
        serialized_state = handoff_service.load_and_verify_state(handoff)
        return WorkflowResumptionContext.loads(serialized_state.decode())
    except Exception:
        # A terminal handoff snapshot may already have been garbage-collected.
        # The run-level trigger remains a safe fallback for full executions.
        logger.warning(
            "Failed to load workflow handoff context for event snapshot, "
            "workflow_run_id=%s, handoff_id=%s, generation=%s",
            handoff.workflow_run_id,
            handoff.id,
            handoff.generation,
            exc_info=True,
        )
        return None


def _resolve_node_execution_triggered_from(
    *,
    workflow_run: WorkflowRun,
    resumption_context: WorkflowResumptionContext | None,
    override: WorkflowNodeExecutionTriggeredFrom | None = None,
) -> WorkflowNodeExecutionTriggeredFrom:
    """Resolve the indexed node-execution source used by this run segment."""
    if override is not None:
        return override

    if resumption_context is not None:
        try:
            generate_entity = resumption_context.get_generate_entity()
            if generate_entity.single_iteration_run is not None or generate_entity.single_loop_run is not None:
                return WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP
        except Exception:
            logger.warning(
                "Failed to inspect workflow resumption context for event snapshot, workflow_run_id=%s",
                workflow_run.id,
                exc_info=True,
            )

    try:
        run_triggered_from = WorkflowRunTriggeredFrom(workflow_run.triggered_from)
    except ValueError:
        logger.warning(
            "Unknown workflow run trigger source for event snapshot, workflow_run_id=%s, triggered_from=%s",
            workflow_run.id,
            workflow_run.triggered_from,
        )
        return WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN

    if run_triggered_from in {
        WorkflowRunTriggeredFrom.RAG_PIPELINE_RUN,
        WorkflowRunTriggeredFrom.RAG_PIPELINE_DEBUGGING,
    }:
        return WorkflowNodeExecutionTriggeredFrom.RAG_PIPELINE_RUN
    return WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN


def resolve_workflow_event_task_id(
    *,
    workflow_run: WorkflowRun,
    session_maker: sessionmaker[Session],
) -> str:
    """Use the task identity of the newest execution segment when available."""
    latest_handoff = _get_latest_workflow_handoff(session_maker, workflow_run.id)
    return latest_handoff.task_id if latest_handoff is not None else workflow_run.id


def _resolve_task_id(
    resumption_context: WorkflowResumptionContext | None,
    buffer_state: BufferState | None,
    workflow_run_id: str,
    wait_timeout: float = 0.2,
    *,
    latest_handoff_task_id: str | None = None,
) -> str:
    if latest_handoff_task_id:
        return latest_handoff_task_id
    if resumption_context is not None:
        generate_entity = resumption_context.get_generate_entity()
        if generate_entity.task_id:
            return generate_entity.task_id
    if buffer_state is None:
        return workflow_run_id
    if buffer_state.task_id_hint is None:
        buffer_state.task_id_ready.wait(timeout=wait_timeout)
    if buffer_state.task_id_hint:
        return buffer_state.task_id_hint
    return workflow_run_id


def _build_snapshot_events(
    *,
    workflow_run: WorkflowRun,
    node_snapshots: Sequence[WorkflowNodeExecutionSnapshot],
    task_id: str,
    message_context: MessageContext | None,
    pause_entity: WorkflowPauseEntity | None,
    resumption_context: WorkflowResumptionContext | None,
    session_maker: sessionmaker[Session] | None = None,
    human_input_surface: HumanInputSurface | None = None,
) -> list[Mapping[str, Any]]:
    events: list[Mapping[str, Any]] = []
    variable_pool = _load_variable_pool_from_resumption_context(resumption_context)

    workflow_started = _build_workflow_started_event(
        workflow_run=workflow_run,
        task_id=task_id,
    )
    _apply_message_context(workflow_started, message_context)
    events.append(workflow_started)

    if message_context is not None and message_context.answer is not None:
        message_replace = _build_message_replace_event(task_id=task_id, answer=message_context.answer)
        _apply_message_context(message_replace, message_context)
        events.append(message_replace)

    for snapshot in node_snapshots:
        node_started = _build_node_started_event(
            workflow_run_id=workflow_run.id,
            task_id=task_id,
            snapshot=snapshot,
        )
        _apply_message_context(node_started, message_context)
        events.append(node_started)

        if snapshot.status != WorkflowNodeExecutionStatus.RUNNING.value:
            node_finished = _build_node_finished_event(
                workflow_run_id=workflow_run.id,
                task_id=task_id,
                snapshot=snapshot,
            )
            _apply_message_context(node_finished, message_context)
            events.append(node_finished)

    if workflow_run.status == WorkflowExecutionStatus.PAUSED and pause_entity is not None:
        for human_input_event in _build_human_input_required_events(
            workflow_run_id=workflow_run.id,
            task_id=task_id,
            pause_entity=pause_entity,
            session_maker=session_maker,
            human_input_surface=human_input_surface,
            variable_pool=variable_pool,
        ):
            _apply_message_context(human_input_event, message_context)
            events.append(human_input_event)

        pause_event = _build_pause_event(
            workflow_run=workflow_run,
            workflow_run_id=workflow_run.id,
            task_id=task_id,
            pause_entity=pause_entity,
            resumption_context=resumption_context,
            session_maker=session_maker,
            human_input_surface=human_input_surface,
        )
        if pause_event is not None:
            _apply_message_context(pause_event, message_context)
            events.append(pause_event)

    if workflow_run.status in _TERMINAL_WORKFLOW_STATUSES:
        # Advanced Chat live streams always emit ``message_end`` before the
        # workflow terminal event. Preserve that contract when Redis history
        # has expired and the stream is reconstructed from the database. A
        # message context is only loaded for Advanced Chat, so workflow-only
        # and RAG snapshots remain unchanged.
        if message_context is not None:
            message_end = _build_message_end_event(
                task_id=task_id,
                message_id=message_context.message_id,
            )
            _apply_message_context(message_end, message_context)
            events.append(message_end)

        workflow_finished = _build_workflow_finished_event(
            workflow_run=workflow_run,
            task_id=task_id,
        )
        _apply_message_context(workflow_finished, message_context)
        events.append(workflow_finished)

    return events


def _build_workflow_started_event(
    *,
    workflow_run: WorkflowRun,
    task_id: str,
) -> dict[str, Any]:
    response = WorkflowStartStreamResponse(
        task_id=task_id,
        workflow_run_id=workflow_run.id,
        data=WorkflowStartStreamResponse.Data(
            id=workflow_run.id,
            workflow_id=workflow_run.workflow_id,
            inputs=workflow_run.inputs_dict or {},
            created_at=int(workflow_run.created_at.timestamp()),
            reason=WorkflowStartReason.INITIAL,
        ),
    )
    payload = response.model_dump(mode="json")
    payload["event"] = response.event.value
    return payload


def _build_workflow_finished_event(
    *,
    workflow_run: WorkflowRun,
    task_id: str,
) -> dict[str, Any]:
    outputs = workflow_run.outputs_dict
    finished_at = workflow_run.finished_at
    response = WorkflowFinishStreamResponse(
        task_id=task_id,
        workflow_run_id=workflow_run.id,
        data=WorkflowFinishStreamResponse.Data(
            id=workflow_run.id,
            workflow_id=workflow_run.workflow_id,
            status=workflow_run.status,
            outputs=outputs,
            error=workflow_run.error,
            elapsed_time=float(workflow_run.elapsed_time or 0.0),
            total_tokens=int(workflow_run.total_tokens or 0),
            total_steps=int(workflow_run.total_steps or 0),
            created_by={},
            created_at=int(workflow_run.created_at.timestamp()),
            finished_at=int(finished_at.timestamp()) if finished_at is not None else None,
            files=WorkflowResponseConverter.fetch_files_from_node_outputs(outputs),
            exceptions_count=int(workflow_run.exceptions_count or 0),
            handoff_duration=float(workflow_run.handoff_duration or 0.0),
        ),
    )
    payload = response.model_dump(mode="json")
    payload["event"] = response.event.value
    return payload


def _build_message_replace_event(*, task_id: str, answer: str) -> dict[str, Any]:
    response = MessageReplaceStreamResponse(
        task_id=task_id,
        answer=answer,
        reason="",
    )
    payload = response.model_dump(mode="json")
    payload["event"] = response.event.value
    return payload


def _build_message_end_event(*, task_id: str, message_id: str) -> dict[str, Any]:
    response = MessageEndStreamResponse(
        task_id=task_id,
        id=message_id,
    )
    payload = response.model_dump(mode="json")
    payload["event"] = response.event.value
    return payload


def _build_node_started_event(
    *,
    workflow_run_id: str,
    task_id: str,
    snapshot: WorkflowNodeExecutionSnapshot,
) -> dict[str, Any]:
    created_at = int(snapshot.created_at.timestamp()) if snapshot.created_at else 0
    response = NodeStartStreamResponse(
        task_id=task_id,
        workflow_run_id=workflow_run_id,
        data=NodeStartStreamResponse.Data(
            id=snapshot.execution_id,
            node_id=snapshot.node_id,
            node_type=snapshot.node_type,
            title=snapshot.title,
            index=snapshot.index,
            predecessor_node_id=None,
            inputs=None,
            created_at=created_at,
            extras={},
            iteration_id=snapshot.iteration_id,
            loop_id=snapshot.loop_id,
        ),
    )
    return response.to_ignore_detail_dict()


def _build_human_input_required_events(
    *,
    workflow_run_id: str,
    task_id: str,
    pause_entity: WorkflowPauseEntity,
    session_maker: sessionmaker[Session] | None,
    human_input_surface: HumanInputSurface | None,
    variable_pool: ReadOnlyVariablePool | None,
) -> list[dict[str, Any]]:
    reasons = pause_entity.get_pause_reasons()
    human_input_form_ids = [reason.form_id for reason in reasons if isinstance(reason, HumanInputRequired)]

    expiration_times_by_form_id: dict[str, int] = {}
    display_in_ui_by_form_id: dict[str, bool] = {}
    dispositions_by_form_id: dict[str, FormDisposition] = {}
    if human_input_form_ids and session_maker is not None:
        stmt = select(HumanInputForm.id, HumanInputForm.expiration_time, HumanInputForm.form_definition).where(
            HumanInputForm.id.in_(human_input_form_ids)
        )
        with session_maker() as session:
            for form_id, expiration_time, form_definition in session.execute(stmt):
                expiration_times_by_form_id[str(form_id)] = int(expiration_time.timestamp())
                try:
                    definition_payload = json.loads(form_definition) if form_definition else {}
                except (TypeError, json.JSONDecodeError):
                    definition_payload = {}
                display_in_ui_by_form_id[str(form_id)] = bool(definition_payload.get("display_in_ui"))
            dispositions_by_form_id = load_form_dispositions_by_form_id(
                human_input_form_ids,
                session=session,
                surface=human_input_surface,
            )

    events: list[dict[str, Any]] = []
    for reason in reasons:
        if not isinstance(reason, HumanInputRequired):
            continue

        form_id = reason.form_id

        expiration_time = expiration_times_by_form_id.get(form_id)
        if expiration_time is None:
            continue

        resolved_inputs = resolve_variable_select_input_options(
            reason.inputs,
            variable_pool=variable_pool,
        )
        disposition = dispositions_by_form_id.get(form_id)

        response = HumanInputRequiredResponse(
            task_id=task_id,
            workflow_run_id=workflow_run_id,
            data=HumanInputRequiredResponse.Data(
                form_id=form_id,
                node_id=reason.node_id,
                node_title=reason.node_title,
                form_content=reason.form_content,
                inputs=resolved_inputs,
                actions=reason.actions,
                display_in_ui=display_in_ui_by_form_id.get(form_id, False),
                form_token=disposition.form_token if disposition else None,
                approval_channels=list(disposition.approval_channels) if disposition else [],
                resolved_default_values=reason.resolved_default_values,
                expiration_time=expiration_time,
            ),
        )
        payload = response.model_dump(mode="json")
        payload["event"] = response.event.value
        events.append(payload)

    return events


def _load_variable_pool_from_resumption_context(
    resumption_context: WorkflowResumptionContext | None,
) -> ReadOnlyVariablePool | None:
    if resumption_context is None:
        return None
    state = GraphRuntimeState.from_snapshot(resumption_context.serialized_graph_runtime_state)

    return state.variable_pool


def _build_node_finished_event(
    *,
    workflow_run_id: str,
    task_id: str,
    snapshot: WorkflowNodeExecutionSnapshot,
) -> dict[str, Any]:
    created_at = int(snapshot.created_at.timestamp()) if snapshot.created_at else 0
    finished_at = int(snapshot.finished_at.timestamp()) if snapshot.finished_at else created_at
    response = NodeFinishStreamResponse(
        task_id=task_id,
        workflow_run_id=workflow_run_id,
        data=NodeFinishStreamResponse.Data(
            id=snapshot.execution_id,
            node_id=snapshot.node_id,
            node_type=snapshot.node_type,
            title=snapshot.title,
            index=snapshot.index,
            predecessor_node_id=None,
            inputs=None,
            process_data=None,
            outputs=None,
            status=WorkflowNodeExecutionStatus(snapshot.status),
            error=None,
            elapsed_time=snapshot.elapsed_time,
            execution_metadata=None,
            created_at=created_at,
            finished_at=finished_at,
            files=[],
            iteration_id=snapshot.iteration_id,
            loop_id=snapshot.loop_id,
        ),
    )
    return response.to_ignore_detail_dict()


def _build_pause_event(
    *,
    workflow_run: WorkflowRun,
    workflow_run_id: str,
    task_id: str,
    pause_entity: WorkflowPauseEntity,
    resumption_context: WorkflowResumptionContext | None,
    session_maker: sessionmaker[Session] | None,
    human_input_surface: HumanInputSurface | None = None,
) -> dict[str, Any] | None:
    paused_nodes: list[str] = []
    outputs: dict[str, Any] = {}
    variable_pool: ReadOnlyVariablePool | None = None
    if resumption_context is not None:
        state = GraphRuntimeState.from_snapshot(resumption_context.serialized_graph_runtime_state)
        paused_nodes = state.get_paused_nodes()
        outputs = dict(WorkflowRuntimeTypeConverter().to_json_encodable(state.outputs or {}))
        variable_pool = state.variable_pool

    resolved_pause_reasons = resolve_human_input_pause_reason_inputs(
        pause_entity.get_pause_reasons(),
        variable_pool=variable_pool,
    )
    reasons = [reason.model_dump(mode="json") for reason in resolved_pause_reasons]
    human_input_form_ids = [
        form_id
        for reason in reasons
        if reason.get("TYPE") == DifyHITLEventType.HUMAN_INPUT_REQUIRED
        for form_id in [reason.get("form_id")]
        if isinstance(form_id, str)
    ]
    dispositions_by_form_id: dict[str, FormDisposition] = {}
    expiration_times_by_form_id: dict[str, int] = {}
    if human_input_form_ids and session_maker is not None:
        with session_maker() as session:
            dispositions_by_form_id = load_form_dispositions_by_form_id(
                human_input_form_ids,
                session=session,
                surface=human_input_surface,
            )
            stmt = select(HumanInputForm.id, HumanInputForm.expiration_time).where(
                HumanInputForm.id.in_(human_input_form_ids)
            )
            for row in session.execute(stmt):
                form_id, expiration_time, *_rest = row
                expiration_times_by_form_id[str(form_id)] = int(expiration_time.timestamp())
        # Reconnect paths must preserve the same pause-reason contract as live streams;
        # otherwise clients see schema drift after resume.
        reasons = enrich_human_input_pause_reasons(
            reasons,
            dispositions_by_form_id=dispositions_by_form_id,
            expiration_times_by_form_id=expiration_times_by_form_id,
        )

    response = WorkflowPauseStreamResponse(
        task_id=task_id,
        workflow_run_id=workflow_run_id,
        data=WorkflowPauseStreamResponse.Data(
            workflow_run_id=workflow_run_id,
            paused_nodes=paused_nodes,
            outputs=outputs,
            reasons=reasons,
            status=workflow_run.status,
            created_at=int(workflow_run.created_at.timestamp()),
            elapsed_time=float(workflow_run.elapsed_time or 0.0),
            total_tokens=int(workflow_run.total_tokens or 0),
            total_steps=int(workflow_run.total_steps or 0),
            handoff_duration=float(workflow_run.handoff_duration or 0.0),
        ),
    )
    payload = response.model_dump(mode="json")
    payload["event"] = response.event.value
    return payload


def _apply_message_context(payload: dict[str, Any], message_context: MessageContext | None) -> None:
    if message_context is None:
        return
    payload["conversation_id"] = message_context.conversation_id
    payload["message_id"] = message_context.message_id
    payload["created_at"] = message_context.created_at


def _start_buffering(subscription) -> BufferState:
    buffer_state = BufferState(
        queue=queue.Queue(maxsize=2048),
        stop_event=threading.Event(),
        done_event=threading.Event(),
        task_id_ready=threading.Event(),
    )

    def _worker() -> None:
        try:
            while not buffer_state.stop_event.is_set():
                if isinstance(subscription, _CursorReceiver):
                    cursor_message = subscription.receive_with_cursor(timeout=1)
                    msg = None if cursor_message is None else cursor_message.payload
                else:
                    cursor_message = None
                    msg = subscription.receive(timeout=1)
                if msg is None:
                    continue
                event = _parse_event_message(msg)
                if event is None:
                    continue
                task_id = event.get("task_id")
                if task_id and buffer_state.task_id_hint is None:
                    buffer_state.task_id_hint = str(task_id)
                    buffer_state.task_id_ready.set()
                buffered_event: Mapping[str, Any] | StreamEventWithCursor = event
                if cursor_message is not None:
                    buffered_event = StreamEventWithCursor(event=event, cursor=cursor_message.cursor)
                # Apply lossless backpressure while the database snapshot is
                # being built. Advancing past a dropped Redis cursor would let
                # the client acknowledge a gap that Last-Event-ID can never
                # repair. The Streams subscription itself remains replayable
                # while this bounded queue waits for the HTTP consumer.
                while not buffer_state.stop_event.is_set():
                    try:
                        buffer_state.queue.put(buffered_event, timeout=1)
                        break
                    except queue.Full:
                        continue
        except SubscriptionClosedError:
            pass
        except Exception:
            logger.exception("Failed while buffering workflow events")
        finally:
            buffer_state.done_event.set()

    thread = threading.Thread(target=_worker, name=f"workflow-event-buffer-{id(subscription)}", daemon=True)
    thread.start()
    return buffer_state


def _parse_event_message(message: bytes) -> Mapping[str, Any] | None:
    try:
        event = json.loads(message)
    except json.JSONDecodeError:
        logger.warning("Failed to decode workflow event payload")
        return None
    if not isinstance(event, dict):
        return None
    return event


def _is_terminal_event(
    event: Mapping[str, Any] | StreamEventWithCursor | str,
    close_on_pause: bool = True,
    *,
    include_paused: bool | None = None,
) -> bool:
    if include_paused is not None:
        close_on_pause = include_paused
    if isinstance(event, StreamEventWithCursor):
        event = event.event
    if not isinstance(event, Mapping):
        return False
    event_type = event.get("event")
    if event_type == StreamEvent.WORKFLOW_FINISHED.value:
        return True
    if close_on_pause:
        return event_type == StreamEvent.WORKFLOW_PAUSED.value
    return False
