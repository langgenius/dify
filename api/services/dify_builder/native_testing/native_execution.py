"""Trusted orchestration around the existing native generator/persistence owners.

The driver is mandatory. Production composition remains gated until the real
Graphon control and every effect adapter qualify; an absent driver never falls
back to an ordinary generator or synthesizes a successful Run.
"""

from __future__ import annotations

from collections.abc import Callable, Generator, Iterator, Mapping
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from sqlalchemy.orm import Session, sessionmaker

from runtime_contracts.builder.native.contracts import JsonValue, NativeTestContextRef
from runtime_contracts.builder.native.runtime_contracts import (
    NativeStatePort,
    NativeWorkflowOutcome,
    ResolvedNativeTestContext,
)
from services.dify_builder.native_testing.context_binding import NativeContextUnavailable, resolve_native_context
from services.dify_builder.native_testing.runtime_bridge import NativeRuntimeBridge

if TYPE_CHECKING:
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch


@runtime_checkable
class _ClosableNativeSource(Protocol):
    def close(self) -> None: ...


class NativeWorkflowOwner(Protocol):
    """Adapter to WorkflowAppGenerator; owns native stream and persistence semantics."""

    def run(
        self, *, context: ResolvedNativeTestContext, on_event: Callable[[Mapping[str, JsonValue]], None]
    ) -> NativeWorkflowOutcome: ...

    def resume(self, *, context: ResolvedNativeTestContext, generation: int) -> NativeWorkflowOutcome: ...


class NativeWorkflowExecutionService:
    def __init__(self, *, state: NativeStatePort, native_owner: NativeWorkflowOwner):
        if native_owner is None:
            raise NativeContextUnavailable("native_runtime_unavailable")
        self._state = state
        self._native_owner = native_owner

    def _load(self, ref: NativeTestContextRef) -> ResolvedNativeTestContext:
        context = resolve_native_context(required=True, ref=ref, state=self._state)
        assert context is not None
        if not context.native_run_id or not context.root_native_run_id:
            raise NativeContextUnavailable("native_run_identity_missing")
        return context

    @staticmethod
    def _outcome(context: ResolvedNativeTestContext, outcome: NativeWorkflowOutcome) -> NativeWorkflowOutcome:
        if outcome.ref != context.ref or outcome.native_run_id != context.native_run_id:
            raise NativeContextUnavailable("native_run_identity_mismatch")
        return NativeWorkflowOutcome.model_validate(outcome.model_dump(mode="json"))

    def run(
        self, *, ref: NativeTestContextRef, on_event: Callable[[Mapping[str, JsonValue]], None]
    ) -> NativeWorkflowOutcome:
        context = self._load(ref)
        return self._outcome(context, self._native_owner.run(context=context, on_event=on_event))

    def resume_worker(self, *, ref: NativeTestContextRef, generation: int) -> NativeWorkflowOutcome:
        context = self._load(ref)
        if type(generation) is not int or generation != context.generation:
            raise NativeContextUnavailable("native_generation_conflict")
        return self._outcome(context, self._native_owner.resume(context=context, generation=generation))


def dispatch_native_worker(*, ref: NativeTestContextRef | None, generation: int | None) -> NativeWorkflowOutcome:
    """Composition gate until NW3's released control/worker owner is installed.

    No ordinary worker, metadata/config lookup or payload logger runs here.
    NW3 replaces this gate with the qualified service factory, reconstructing
    the actor from the request's persisted owner chain, never task actor flags.
    """
    if ref is None:
        raise NativeContextUnavailable("native_context_missing")
    raise NativeContextUnavailable("native_runtime_unavailable")


class ClosableNativeEventStream(Protocol):
    """Existing rate-limited SSE strings, closed on exhaustion/error/caller exit."""

    def __iter__(self) -> Iterator[str]: ...
    def __next__(self) -> str: ...
    def close(self) -> None: ...


class NativeStreamOwner(Protocol):
    """NW3 consumes actual SSE and the durable native control result.

    Waiting must commit its complete typed EffectIntent in the protected node
    journal before acknowledgement. C04's PendingIntentPort then resolves the
    exact owner/generation/checkpoint/intent; a stub consumer supplies no such
    approval authority. Missing intents in older checkpoints fail closed.
    """

    def consume(
        self,
        *,
        context: ResolvedNativeTestContext,
        stream: ClosableNativeEventStream,
        on_event: Callable[[Mapping[str, JsonValue]], None],
    ) -> NativeWorkflowOutcome: ...

    def resume(self, *, context: ResolvedNativeTestContext, generation: int) -> NativeWorkflowOutcome: ...


class DifyNativeWorkflowOwner:
    """Use the existing generator, worker, native repositories and stream pipeline.

    No execution engine or synthetic Run is created here. Production composition
    must supply the qualified runtime bridge and NW3's committed-control reader.
    """

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        runtime: NativeRuntimeBridge,
        stream_owner: NativeStreamOwner,
        native_host: NativeHostLaunch,
    ):
        from services.dify_builder.native_testing.host_execution import NativeHostLaunch

        if runtime is None or stream_owner is None:
            raise NativeContextUnavailable("native_runtime_unavailable")
        if type(native_host) is not NativeHostLaunch:
            raise NativeContextUnavailable("native_host_unavailable")
        self._sessions = session_factory
        self._runtime = runtime
        self._stream_owner = stream_owner
        self._native_host = native_host

    def _validate_host(self, context: ResolvedNativeTestContext) -> None:
        from services.dify_builder.native_testing.generation_wiring import validate_native_host

        validate_native_host(required=True, ref=context.ref, runtime=self._runtime, host=self._native_host)
        if context != self._native_host.lifetime.context:
            raise NativeContextUnavailable("native_context_mismatch")

    def run(
        self, *, context: ResolvedNativeTestContext, on_event: Callable[[Mapping[str, JsonValue]], None]
    ) -> NativeWorkflowOutcome:
        from sqlalchemy import select

        from models.account import Account
        from models.model import App
        from models.workflow import Workflow
        from services.app_generate_service import AppGenerateService
        from services.dify_builder.native_testing.repository import native_workflow_revision

        self._validate_host(context)
        current = self._runtime.resolve(context.ref)
        if current != context:
            raise NativeContextUnavailable("native_context_mismatch")
        with self._sessions() as session:
            app = session.scalar(select(App).where(App.id == current.app_id, App.tenant_id == current.tenant_id))
            workflow = session.scalar(
                select(Workflow).where(
                    Workflow.id == current.workflow_id,
                    Workflow.app_id == current.app_id,
                    Workflow.tenant_id == current.tenant_id,
                )
            )
            account = session.get(Account, current.actor_id)
            if app is None or workflow is None or account is None:
                raise NativeContextUnavailable("native_context_mismatch")
            if native_workflow_revision(workflow) != current.graph_revision or workflow.graph_dict != current.graph:
                raise NativeContextUnavailable("native_revision_drift")
            session.expunge_all()
        stream = AppGenerateService.generate_admitted_native(
            app_model=app,
            workflow=workflow,
            user=account,
            ref=current.ref,
            runtime=self._runtime,
            native_host=self._native_host,
        )
        return self._consume(context=current, stream=stream, on_event=on_event)

    def resume_claimed(self, *, context: ResolvedNativeTestContext) -> NativeWorkflowOutcome:
        from sqlalchemy import select

        from models.account import Account
        from models.model import App
        from models.workflow import Workflow
        from services.app_generate_service import AppGenerateService
        from services.dify_builder.native_testing.repository import native_workflow_revision

        self._validate_host(context)
        bindings = self._native_host.resume_bindings
        self._native_host.require_resume_bindings(
            entity=bindings.entity, runtime_state=bindings.runtime_state, response_filter=bindings.response_filter
        )
        with self._sessions() as session:
            app = session.scalar(select(App).where(App.id == context.app_id, App.tenant_id == context.tenant_id))
            workflow = session.scalar(
                select(Workflow).where(
                    Workflow.id == context.workflow_id,
                    Workflow.app_id == context.app_id,
                    Workflow.tenant_id == context.tenant_id,
                )
            )
            account = session.get(Account, context.actor_id)
            if app is None or workflow is None or account is None:
                raise NativeContextUnavailable("native_context_mismatch")
            if native_workflow_revision(workflow) != context.graph_revision or workflow.graph_dict != context.graph:
                raise NativeContextUnavailable("native_revision_drift")
            session.expunge_all()
        stream = AppGenerateService.resume_admitted_native(
            app_model=app,
            workflow=workflow,
            user=account,
            runtime=self._runtime,
            native_host=self._native_host,
            sessions=self._sessions,
        )
        return self._consume(context=context, stream=stream)

    def _consume(self, *, context, stream, on_event=lambda event: None):
        try:
            return self._stream_owner.consume(context=context, stream=stream, on_event=on_event)
        finally:
            # The actual coordinator has already closed the source before its
            # exact lifetime is consumed. Never signal that retired host again.
            if not self._native_host.lifetime._consumed:
                stream.close()

    def resume(self, *, context: ResolvedNativeTestContext, generation: int) -> NativeWorkflowOutcome:
        self._validate_host(context)
        return self._stream_owner.resume(context=context, generation=generation)


class NativeGeneratorStream:
    """Close both native source and its existing SSE conversion on every exit.

    BaseAppGenerator's conversion does not propagate close to its source. This
    per-launch adapter adds that ownership without changing ordinary streams.
    A close attempt is separate from its acknowledgement: failure is sticky,
    never retried or presented to a later owner as successful inert cleanup.
    """

    def __init__(self, source: Generator[Mapping[str, Any] | str]):
        from services.workflow_runtime.workflow_generator import WorkflowAppGenerator

        self._source = source
        events = WorkflowAppGenerator.convert_to_event_stream(source)
        if not isinstance(events, Generator):
            source.close()
            raise NativeContextUnavailable("native_stream_unavailable")
        self._events = events
        self._close_attempted = False
        self._closed = False

    def __iter__(self) -> Iterator[str]:
        return self

    def __next__(self) -> str:
        if self._closed:
            raise StopIteration
        if self._close_attempted:
            raise NativeContextUnavailable("native_stream_close_failed") from None
        try:
            return next(self._events)
        except BaseException:
            self.close()
            raise

    def close(self) -> None:
        if self._closed:
            return
        if self._close_attempted:
            raise NativeContextUnavailable("native_stream_close_failed") from None
        self._close_attempted = True
        try:
            self._events.close()
        finally:
            if isinstance(self._source, _ClosableNativeSource):
                self._source.close()
        self._closed = True
