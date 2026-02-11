from __future__ import annotations

import json
import logging
import queue
import threading
import time
from collections.abc import Generator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.message_generator import MessageGenerator
from core.app.entities.task_entities import (
    MessageReplaceStreamResponse,
    NodeFinishStreamResponse,
    NodeStartStreamResponse,
    StreamEvent,
    WorkflowPauseStreamResponse,
    WorkflowStartStreamResponse,
)
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
from core.workflow.entities import WorkflowStartReason
from core.workflow.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from core.workflow.runtime import GraphRuntimeState
from core.workflow.workflow_type_encoder import WorkflowRuntimeTypeConverter
from models.model import AppMode, Message
from models.workflow import WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from repositories.api_workflow_node_execution_repository import WorkflowNodeExecutionSnapshot
from repositories.entities.workflow_pause import WorkflowPauseEntity
from repositories.factory import DifyAPIRepositoryFactory

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MessageContext:
    conversation_id: str
    message_id: str
    created_at: int
    answer: str | None = None


@dataclass
class BufferState:
    queue: queue.Queue[Mapping[str, Any]]
    stop_event: threading.Event
    done_event: threading.Event
    task_id_ready: threading.Event
    task_id_hint: str | None = None


def build_workflow_event_stream(
    *,
    app_mode: AppMode,
    workflow_run: WorkflowRun,
    tenant_id: str,
    app_id: str,
    session_maker: sessionmaker[Session],
    idle_timeout: float = 300,
    ping_interval: float = 10.0,
) -> Generator[Mapping[str, Any] | str, None, None]:
    topic = MessageGenerator.get_response_topic(app_mode, workflow_run.id)
    workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)
    node_execution_repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(session_maker)
    message_context = (
        _get_message_context(session_maker, workflow_run.id) if app_mode == AppMode.ADVANCED_CHAT else None
    )

    pause_entity: WorkflowPauseEntity | None = None
    if workflow_run.status == WorkflowExecutionStatus.PAUSED:
        try:
            pause_entity = workflow_run_repo.get_workflow_pause(workflow_run.id)
        except Exception:
            logger.exception("Failed to load workflow pause for run %s", workflow_run.id)
            pause_entity = None

    resumption_context = _load_resumption_context(pause_entity)
    node_snapshots = node_execution_repo.get_execution_snapshots_by_workflow_run(
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_run.workflow_id,
        # NOTE(QuantumGhost): for events resumption, we only care about
        # the execution records from `WORKFLOW_RUN`.
        #
        # Ideally filtering with `workflow_run_id` is enough. However,
        # due to the index of `WorkflowNodeExecution` table, we have to
        # add a filter condition of `triggered_from` to
        # ensure that we can utilize the index.
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id=workflow_run.id,
    )

    def _generate() -> Generator[Mapping[str, Any] | str, None, None]:
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
                task_id = _resolve_task_id(resumption_context, buffer_state, workflow_run.id)

                snapshot_events = _build_snapshot_events(
                    workflow_run=workflow_run,
                    node_snapshots=node_snapshots,
                    task_id=task_id,
                    message_context=message_context,
                    pause_entity=pause_entity,
                    resumption_context=resumption_context,
                )

                for event in snapshot_events:
                    last_msg_time = time.time()
                    last_ping_time = last_msg_time
                    yield event
                    if _is_terminal_event(event, include_paused=True):
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
                    if _is_terminal_event(event, include_paused=True):
                        return
            finally:
                buffer_state.stop_event.set()

    return _generate()


def _get_message_context(session_maker: sessionmaker[Session], workflow_run_id: str) -> MessageContext | None:
    with session_maker() as session:
        stmt = select(Message).where(Message.workflow_run_id == workflow_run_id).order_by(desc(Message.created_at))
        message = session.scalar(stmt)
        if message is None:
            return None
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


def _resolve_task_id(
    resumption_context: WorkflowResumptionContext | None,
    buffer_state: BufferState | None,
    workflow_run_id: str,
    wait_timeout: float = 0.2,
) -> str:
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
) -> list[Mapping[str, Any]]:
    events: list[Mapping[str, Any]] = []

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
        pause_event = _build_pause_event(
            workflow_run=workflow_run,
            workflow_run_id=workflow_run.id,
            task_id=task_id,
            pause_entity=pause_entity,
            resumption_context=resumption_context,
        )
        if pause_event is not None:
            _apply_message_context(pause_event, message_context)
            events.append(pause_event)

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


def _build_message_replace_event(*, task_id: str, answer: str) -> dict[str, Any]:
    response = MessageReplaceStreamResponse(
        task_id=task_id,
        answer=answer,
        reason="",
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
) -> dict[str, Any] | None:
    paused_nodes: list[str] = []
    outputs: dict[str, Any] = {}
    if resumption_context is not None:
        state = GraphRuntimeState.from_snapshot(resumption_context.serialized_graph_runtime_state)
        paused_nodes = state.get_paused_nodes()
        outputs = dict(WorkflowRuntimeTypeConverter().to_json_encodable(state.outputs or {}))

    reasons = [reason.model_dump(mode="json") for reason in pause_entity.get_pause_reasons()]
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
        dropped_count = 0
        try:
            while not buffer_state.stop_event.is_set():
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
                try:
                    buffer_state.queue.put_nowait(event)
                except queue.Full:
                    dropped_count += 1
                    try:
                        buffer_state.queue.get_nowait()
                    except queue.Empty:
                        pass
                    try:
                        buffer_state.queue.put_nowait(event)
                    except queue.Full:
                        continue
                    logger.warning("Dropped buffered workflow event, total_dropped=%s", dropped_count)
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


def _is_terminal_event(event: Mapping[str, Any] | str, include_paused=False) -> bool:
    if not isinstance(event, Mapping):
        return False
    event_type = event.get("event")
    if event_type == StreamEvent.WORKFLOW_FINISHED.value:
        return True
    if include_paused:
        return event_type == StreamEvent.WORKFLOW_PAUSED.value
    return False
