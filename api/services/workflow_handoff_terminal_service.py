import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol

from core.app.apps.message_generator import MessageGenerator
from core.app.entities.task_entities import (
    MessageEndStreamResponse,
    MessageReplaceStreamResponse,
    WorkflowFinishStreamResponse,
)
from libs.helper import to_timestamp
from models.model import AppMode
from models.workflow_handoff import WorkflowHandoffResumeRoute
from repositories.workflow_handoff_repository import (
    WorkflowHandoffSnapshotDeleteOutcome,
    WorkflowHandoffTerminalEvent,
    WorkflowHandoffTerminalScope,
    WorkflowRunHandoffRepository,
)


class WorkflowHandoffSnapshotStorage(Protocol):
    def exists(self, filename: str) -> bool: ...

    def delete(self, filename: str) -> None: ...


type WorkflowHandoffTerminalPublisher = Callable[[AppMode, str, bytes], None]


@dataclass(frozen=True)
class WorkflowHandoffTerminalScanResult:
    terminal_compensated: int
    terminal_compensation_errors: int
    terminal_events_published: int
    terminal_event_errors: int
    snapshots_deleted: int
    snapshots_missing: int
    snapshot_gc_errors: int
    cancellations_deleted: int


class WorkflowHandoffTerminalService:
    """Eventually reconcile failed handoffs and collect terminal snapshots.

    Database state is the source of truth. Terminal events are delivered
    at-least-once because Redis publication and the durable published marker
    cannot share a transaction; all current consumers treat the finish event as
    an idempotent stream terminator.
    """

    def __init__(
        self,
        *,
        repository: WorkflowRunHandoffRepository,
        storage: WorkflowHandoffSnapshotStorage,
        publisher: WorkflowHandoffTerminalPublisher | None = None,
    ) -> None:
        self._repository = repository
        self._storage = storage
        self._publisher = publisher or self._publish_to_run_topic

    def scan(
        self,
        *,
        now: datetime,
        limit: int,
        retry_delay: timedelta,
    ) -> WorkflowHandoffTerminalScanResult:
        terminal_compensated = 0
        terminal_compensation_errors = 0
        terminal_events_published = 0
        terminal_event_errors = 0
        snapshots_deleted = 0
        snapshots_missing = 0
        snapshot_gc_errors = 0

        for handoff in self._repository.list_failed_pending_terminal_compensation(limit=limit):
            try:
                if self._repository.compensate_failed_terminal(
                    handoff_id=handoff.id,
                    generation=handoff.generation,
                    compensated_at=now,
                ):
                    terminal_compensated += 1
            except Exception as exc:
                terminal_compensation_errors += 1
                self._record_terminal_failure(handoff.id, handoff.generation, exc)

        for event in self._repository.list_pending_terminal_events(limit=limit):
            try:
                self._publish_terminal_event(event)
                if self._repository.mark_terminal_event_published(
                    handoff_id=event.handoff_id,
                    generation=event.generation,
                    published_at=now,
                ):
                    terminal_events_published += 1
            except Exception as exc:
                terminal_event_errors += 1
                self._record_terminal_failure(event.handoff_id, event.generation, exc)

        for record in self._repository.list_snapshot_gc_candidates(now=now, limit=limit):
            try:
                outcome = self._repository.delete_snapshot_if_unreferenced(
                    snapshot_object_key=record.snapshot_object_key,
                    deleted_at=now,
                    delete_object=self._delete_snapshot_object,
                )
            except Exception as exc:
                snapshot_gc_errors += 1
                self._repository.record_snapshot_gc_failure(
                    snapshot_object_key=record.snapshot_object_key,
                    error=self._error_text(exc),
                    retry_at=now + retry_delay,
                )
                continue
            if outcome == WorkflowHandoffSnapshotDeleteOutcome.DELETED:
                snapshots_deleted += 1
            elif outcome == WorkflowHandoffSnapshotDeleteOutcome.MISSING:
                snapshots_missing += 1

        cancellations_deleted = self._repository.cleanup_expired_cancellations(now=now, limit=limit)
        return WorkflowHandoffTerminalScanResult(
            terminal_compensated=terminal_compensated,
            terminal_compensation_errors=terminal_compensation_errors,
            terminal_events_published=terminal_events_published,
            terminal_event_errors=terminal_event_errors,
            snapshots_deleted=snapshots_deleted,
            snapshots_missing=snapshots_missing,
            snapshot_gc_errors=snapshot_gc_errors,
            cancellations_deleted=cancellations_deleted,
        )

    def reconcile_resumed_failure(
        self,
        *,
        handoff_id: str,
        generation: int,
        scope: WorkflowHandoffTerminalScope,
        error: str,
        failed_at: datetime,
        message_answer_delta: str = "",
        message_answer_replacement: str | None = None,
    ) -> bool:
        """Commit a post-ACK terminal outbox before publishing its events."""
        event = self._repository.reconcile_resumed_terminal_failure(
            handoff_id=handoff_id,
            generation=generation,
            scope=scope,
            error=error,
            failed_at=failed_at,
            message_answer_delta=message_answer_delta,
            message_answer_replacement=message_answer_replacement,
        )
        if event is None:
            return False

        try:
            self._publish_terminal_event(event)
            if not self._repository.mark_terminal_event_published(
                handoff_id=event.handoff_id,
                generation=event.generation,
                published_at=failed_at,
            ):
                raise RuntimeError(f"Failed to persist workflow handoff terminal publication: {event.handoff_id}")
        except Exception as exc:
            self._record_terminal_failure(event.handoff_id, event.generation, exc)
            raise
        return True

    def _record_terminal_failure(self, handoff_id: str, generation: int, exc: Exception) -> None:
        self._repository.record_terminal_processing_failure(
            handoff_id=handoff_id,
            generation=generation,
            error=self._error_text(exc),
        )

    def _delete_snapshot_object(self, snapshot_object_key: str) -> bool:
        if not self._storage.exists(snapshot_object_key):
            # PREPARING intent is durable before upload; worker loss can leave
            # an intentional outbox row for an object that never existed.
            return False
        try:
            self._storage.delete(snapshot_object_key)
        except FileNotFoundError:
            return False
        return True

    def _publish_terminal_event(self, event: WorkflowHandoffTerminalEvent) -> None:
        app_mode = self._app_mode_for_route(event.resume_route)
        if event.resume_route == WorkflowHandoffResumeRoute.ADVANCED_CHAT and event.message_id is not None:
            message_replace = MessageReplaceStreamResponse(
                task_id=event.task_id,
                answer=event.message_answer or "",
                reason="workflow_handoff_terminal",
            )
            body = json.dumps(message_replace.model_dump(mode="json", fallback=str), ensure_ascii=False).encode()
            self._publisher(app_mode, event.workflow_run_id, body)
            message_end = MessageEndStreamResponse(
                task_id=event.task_id,
                id=event.message_id,
                files=list(event.message_files),
                metadata=dict(event.message_metadata or {}),
            )
            body = json.dumps(message_end.model_dump(mode="json", fallback=str), ensure_ascii=False).encode()
            self._publisher(app_mode, event.workflow_run_id, body)

        created_at = to_timestamp(event.created_at)
        assert created_at is not None
        payload = WorkflowFinishStreamResponse(
            task_id=event.task_id,
            workflow_run_id=event.workflow_run_id,
            data=WorkflowFinishStreamResponse.Data(
                id=event.workflow_run_id,
                workflow_id=event.workflow_id,
                status=event.status,
                outputs=event.outputs,
                error=event.error,
                elapsed_time=event.elapsed_time,
                total_tokens=event.total_tokens,
                total_steps=event.total_steps,
                created_by={},
                created_at=created_at,
                finished_at=to_timestamp(event.finished_at),
                exceptions_count=event.exceptions_count,
                files=[],
                handoff_duration=event.handoff_duration,
            ),
        )
        body = json.dumps(payload.model_dump(mode="json", fallback=str), ensure_ascii=False).encode()
        self._publisher(app_mode, event.workflow_run_id, body)

    @staticmethod
    def _publish_to_run_topic(app_mode: AppMode, workflow_run_id: str, body: bytes) -> None:
        MessageGenerator.get_response_topic(app_mode, workflow_run_id).publish(body)

    @staticmethod
    def _app_mode_for_route(route: WorkflowHandoffResumeRoute) -> AppMode:
        if route == WorkflowHandoffResumeRoute.ADVANCED_CHAT:
            return AppMode.ADVANCED_CHAT
        if route == WorkflowHandoffResumeRoute.RAG_PIPELINE:
            return AppMode.RAG_PIPELINE
        return AppMode.WORKFLOW

    @staticmethod
    def _error_text(exc: Exception) -> str:
        return f"{type(exc).__name__}: {exc}"[:4000]


__all__ = [
    "WorkflowHandoffSnapshotStorage",
    "WorkflowHandoffTerminalPublisher",
    "WorkflowHandoffTerminalScanResult",
    "WorkflowHandoffTerminalService",
]
