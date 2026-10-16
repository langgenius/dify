"""Initial Dify generation's private per-launch host association.

These identities grant no queue, persistence, log or activation qualification.
Marked resume remains refused by the existing checkpoint provenance gate.
"""

from __future__ import annotations

from collections.abc import Generator, Iterator, Mapping
from threading import Lock, Thread, current_thread
from typing import TYPE_CHECKING, Any

from services.dify_builder.native_testing.context_binding import NativeContextUnavailable

if TYPE_CHECKING:
    from core.app.apps.base_app_queue_manager import AppQueueManager
    from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
    from core.repositories.factory import WorkflowExecutionRepository, WorkflowNodeExecutionRepository

    from graphon.filters import ResponseStreamFilter
    from services.dify_builder.native_testing.contracts import NativeTestContextRef
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch
    from services.dify_builder.native_testing.runtime_bridge import NativeRuntimeBridge


def validate_native_host(
    *,
    required: bool,
    ref: NativeTestContextRef | None,
    runtime: NativeRuntimeBridge | None,
    host: NativeHostLaunch | None,
) -> None:
    """Check trusted Dify-owned identity before any initial generation work.

    The bridge's existing private Dify associations are read for exact identity;
    no Graphon private fields or caller-supplied qualification flags are used.
    """
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch
    from services.dify_builder.native_testing.runtime_bridge import NativeRuntimeBridge

    if not required:
        if host is not None:
            raise NativeContextUnavailable("native_host_identity_mismatch")
        return
    if ref is None:
        raise NativeContextUnavailable("native_context_missing")
    if type(host) is not NativeHostLaunch:
        raise NativeContextUnavailable("native_host_unavailable")
    if type(runtime) is not NativeRuntimeBridge:
        raise NativeContextUnavailable("native_runtime_unavailable")
    if (
        ref != host.lifetime.ref
        or runtime._boundary_owner is not host.boundary_owner
        or runtime._control_sink is not host.control_sink
        or runtime.resolve(ref) != host.lifetime.context
    ):
        raise NativeContextUnavailable("native_host_identity_mismatch")


def preflight_native_observation(*, host: NativeHostLaunch, entity: WorkflowAppGenerateEntity, workflow: Any) -> None:
    """Refuse unqualified side paths before creating an application worker."""
    guard = host.native_observation
    with host.observation_scope():
        additional = entity.app_config.additional_features
        features = workflow.features_dict
        if (
            entity.files
            or entity.trace_manager is not None
            or entity.single_iteration_run
            or entity.single_loop_run
            or entity.builder_execution is not None
            or entity.app_config.sensitive_word_avoidance
            or any(
                entity.extras.get(key) is not None
                for key in ("trace_session_id", "external_trace_id", "parent_trace_context")
            )
            or features.get("text_to_speech", {}).get("enabled")
            or (
                additional is not None
                and (
                    additional.file_upload is not None
                    or additional.text_to_speech is not None
                    or additional.speech_to_text
                    or additional.trace_config is not None
                )
            )
        ):
            guard.fail()


def bind_native_generation(
    *,
    host: NativeHostLaunch,
    entity: WorkflowAppGenerateEntity,
    queue: AppQueueManager,
    response_filter: ResponseStreamFilter,
    workflow_repository: WorkflowExecutionRepository,
    node_repository: WorkflowNodeExecutionRepository,
) -> None:
    """Narrow repository ports before the launch's exact-instance qualification."""
    from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
    from core.repositories.sqlalchemy_workflow_node_execution_repository import (
        SQLAlchemyWorkflowNodeExecutionRepository,
    )

    if not isinstance(workflow_repository, SQLAlchemyWorkflowExecutionRepository) or not isinstance(
        node_repository, SQLAlchemyWorkflowNodeExecutionRepository
    ):
        raise NativeContextUnavailable("native_host_repository_unqualified")
    guard = host.native_observation
    context = host.lifetime.context
    workflow_repository.bind_native_observation(context=context, guard=guard)
    node_repository.bind_native_observation(context=context, guard=guard)
    host.bind_generation(
        entity=entity,
        queue=queue,
        response_filter=response_filter,
        workflow_repository=workflow_repository,
        node_repository=node_repository,
    )


class HostOwnedNativeGeneratorStream:
    """Single-reader SSE conversion with host-owned close/release timing.

    ``close`` only signals the host. The actual stream reader must invoke
    ``finish_reader`` in its finally after next() has returned; that method
    rejects a different thread or an in-flight read. It closes the existing
    conversion/source and grants no physical cleanup or capacity proof.
    """

    def __init__(self, *, source: Generator[Mapping[str, Any] | str], host: NativeHostLaunch) -> None:
        from services.dify_builder.native_testing.native_execution import NativeGeneratorStream

        self._host = host
        self._stream = NativeGeneratorStream(source)
        self._lock = Lock()
        self._reader: Thread | None = None
        self._reading = False
        self._close_requested = False
        self._finish_attempted = False
        self._finished = False

    def __iter__(self) -> Iterator[str]:
        return self

    def __next__(self) -> str:
        with self._lock:
            if self._reader is not None and self._reader is not current_thread():
                raise NativeContextUnavailable("native_stream_reader_mismatch")
            if self._reading:
                raise NativeContextUnavailable("native_stream_read_in_progress")
            if self._finish_attempted and not self._finished:
                raise NativeContextUnavailable("native_stream_close_failed") from None
            if self._finished or self._close_requested:
                raise StopIteration
            self._reader = current_thread()
            self._reading = True
        try:
            return next(self._stream)
        except StopIteration:
            self._host.request_close(reason="exhausted")
            raise
        except BaseException:
            self._host.request_close(reason="failed")
            raise
        finally:
            with self._lock:
                self._reading = False

    def close(self) -> None:
        with self._lock:
            self._close_requested = True
        self._host.request_close(reason="consumer_closed")

    def finish_reader(self) -> None:
        """Acknowledge successful owned close once; never retry a failed attempt."""
        with self._lock:
            if self._reading or (self._reader is not None and self._reader is not current_thread()):
                raise NativeContextUnavailable("native_stream_reader_mismatch")
            if self._finished:
                return
            if self._finish_attempted:
                raise NativeContextUnavailable("native_stream_close_failed") from None
            self._finish_attempted = True
        self._stream.close()
        with self._lock:
            self._finished = True
