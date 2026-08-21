import asyncio
from collections import defaultdict
from collections.abc import Mapping

import httpx
import pytest

from agenton.compositor import CompositorSessionSnapshot, LayerSessionSnapshot
from agenton.layers import LifecycleState
from agenton_collections.layers.plain import PromptLayerConfig
from dify_agent.layers.dify_plugin import DifyPluginLLMLayerConfig
from dify_agent.layers.execution_context import DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID, DifyExecutionContextLayerConfig
from dify_agent.layers.output import DIFY_OUTPUT_LAYER_TYPE_ID, DifyOutputLayerConfig
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID, DIFY_AGENT_OUTPUT_LAYER_ID, RunFailureType
from dify_agent.protocol.schemas import (
    AgentRunUsage,
    CancelRunRequest,
    CreateRunRequest,
    RunCancelledEvent,
    RunCancelledEventData,
    RunComposition,
    RunEvent,
    RunFailedEvent,
    RunLayerSpec,
    RunStatus,
    utc_now,
)
from dify_agent.runtime.cancellation import RunCancellationIntent
from dify_agent.runtime.event_sink import (
    NonTerminalRunEvent,
    RunFinalizationResult,
    TerminalRunEvent,
    emit_run_failed,
    emit_run_succeeded,
    terminal_event_status_fields,
)
from dify_agent.runtime.run_scheduler import RunCancellationConflictError, RunScheduler, SchedulerStoppingError
from dify_agent.runtime.runner import AgentRunRunner
from dify_agent.server.schemas import RunRecord


def _request(
    user: str | list[str] = "hello",
    *,
    output_config: Mapping[str, object] | DifyOutputLayerConfig | None = None,
) -> CreateRunRequest:
    layers = [
        RunLayerSpec(name="prompt", type="plain.prompt", config=PromptLayerConfig(user=user)),
        RunLayerSpec(
            name="execution_context",
            type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
            config=DifyExecutionContextLayerConfig(
                tenant_id="tenant-1",
                user_from="account",
                agent_mode="workflow_run",
                invoke_from="service-api",
            ),
        ),
        RunLayerSpec(
            name=DIFY_AGENT_MODEL_LAYER_ID,
            type="dify.plugin.llm",
            deps={"execution_context": "execution_context"},
            config=DifyPluginLLMLayerConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="demo-model",
            ),
        ),
    ]
    if output_config is not None:
        layers.append(
            RunLayerSpec(
                name=DIFY_AGENT_OUTPUT_LAYER_ID,
                type=DIFY_OUTPUT_LAYER_TYPE_ID,
                config=output_config,
            )
        )

    return CreateRunRequest(composition=RunComposition(layers=layers))


def _recursive_output_schema() -> dict[str, object]:
    return {
        "type": "object",
        "properties": {"node": {"$ref": "#/$defs/node"}},
        "$defs": {
            "node": {
                "type": "object",
                "properties": {"child": {"$ref": "#/$defs/node"}},
                "additionalProperties": False,
            }
        },
        "additionalProperties": False,
    }


class FakeStore:
    records: dict[str, RunRecord]
    events: dict[str, list[RunEvent]]
    statuses: dict[str, RunStatus]
    errors: dict[str, str | None]
    error_types: dict[str, RunFailureType | None]
    cancellation_changes: dict[str, asyncio.Event]
    cancellation_intents: dict[str, RunCancellationIntent]

    def __init__(self) -> None:
        self.records = {}
        self.events = defaultdict(list)
        self.statuses = {}
        self.errors = {}
        self.error_types = {}
        self.cancellation_changes = {}
        self.cancellation_intents = {}

    async def create_run(self) -> RunRecord:
        run_id = f"run-{len(self.records) + 1}"
        record = RunRecord(run_id=run_id, status="running")
        self.records[run_id] = record
        self.statuses[run_id] = "running"
        self.cancellation_changes[run_id] = asyncio.Event()
        return record

    async def append_event(self, event: NonTerminalRunEvent) -> str:
        event_id = str(len(self.events[event.run_id]) + 1)
        self.events[event.run_id].append(event.model_copy(update={"id": event_id}))
        return event_id

    async def get_run(self, run_id: str) -> RunRecord:
        return self.records[run_id].model_copy(
            update={
                "status": self.statuses[run_id],
                "error": self.errors.get(run_id),
                "error_type": self.error_types.get(run_id),
            },
        )

    async def finalize_run(self, event: TerminalRunEvent) -> RunFinalizationResult:
        current_status = self.statuses[event.run_id]
        if current_status != "running":
            return RunFinalizationResult(applied=False, status=current_status)
        if event.run_id in self.cancellation_intents:
            return RunFinalizationResult(applied=False, status="running")

        status, error, error_type = terminal_event_status_fields(event)
        event_id = str(len(self.events[event.run_id]) + 1)
        self.events[event.run_id].append(event.model_copy(update={"id": event_id}))
        self.statuses[event.run_id] = status
        self.errors[event.run_id] = error
        self.error_types[event.run_id] = error_type
        return RunFinalizationResult(applied=True, status=status, event_id=event_id)

    async def request_cancellation(self, run_id: str, request: CancelRunRequest) -> RunStatus:
        status = self.statuses[run_id]
        if status != "running":
            return status
        if run_id not in self.cancellation_intents:
            self.cancellation_intents[run_id] = RunCancellationIntent(
                reason=request.reason,
                message=request.message,
                requested_at=utc_now(),
            )
            self.cancellation_changes[run_id].set()
        return "running"

    async def get_cancellation_intent(self, run_id: str) -> RunCancellationIntent | None:
        return self.cancellation_intents.get(run_id)

    async def wait_for_cancellation(self, run_id: str) -> RunCancellationIntent:
        await self.cancellation_changes[run_id].wait()
        return self.cancellation_intents[run_id]

    async def finalize_cancellation(
        self,
        run_id: str,
        intent: RunCancellationIntent,
        *,
        session_snapshot: CompositorSessionSnapshot | None = None,
        usage: AgentRunUsage | None = None,
    ) -> RunFinalizationResult:
        current_status = self.statuses[run_id]
        if current_status != "running":
            return RunFinalizationResult(applied=False, status=current_status)
        if run_id not in self.cancellation_intents:
            return RunFinalizationResult(applied=False, status="running")
        event = RunCancelledEvent(
            run_id=run_id,
            data=RunCancelledEventData(
                reason=intent.reason,
                message=intent.message,
                session_snapshot=session_snapshot,
                usage=usage,
            ),
        )
        event_id = str(len(self.events[run_id]) + 1)
        self.events[run_id].append(event.model_copy(update={"id": event_id}))
        self.statuses[run_id] = "cancelled"
        self.errors[run_id] = intent.message or intent.reason
        self.error_types[run_id] = None
        del self.cancellation_intents[run_id]
        return RunFinalizationResult(applied=True, status="cancelled", event_id=event_id)


class SlowCreateStore(FakeStore):
    create_started: asyncio.Event
    release_create: asyncio.Event

    def __init__(self, *, create_started: asyncio.Event, release_create: asyncio.Event) -> None:
        super().__init__()
        self.create_started = create_started
        self.release_create = release_create

    async def create_run(self) -> RunRecord:
        _ = self.create_started.set()
        await self.release_create.wait()
        return await super().create_run()


class TrackingStore(FakeStore):
    observer_started: asyncio.Event
    observer_finished: asyncio.Event
    release_observer: asyncio.Event

    def __init__(self, *, pause_observer: bool = False) -> None:
        super().__init__()
        self.observer_started = asyncio.Event()
        self.observer_finished = asyncio.Event()
        self.release_observer = asyncio.Event()
        if not pause_observer:
            self.release_observer.set()

    async def wait_for_cancellation(self, run_id: str) -> RunCancellationIntent:
        self.observer_started.set()
        try:
            await self.release_observer.wait()
            return await super().wait_for_cancellation(run_id)
        finally:
            self.observer_finished.set()


class FailingObserverStore(FakeStore):
    fail_observer: asyncio.Event
    observer_finished: asyncio.Event

    def __init__(self, *, fail_observer: asyncio.Event) -> None:
        super().__init__()
        self.fail_observer = fail_observer
        self.observer_finished = asyncio.Event()

    async def wait_for_cancellation(self, run_id: str) -> RunCancellationIntent:
        del run_id
        try:
            await self.fail_observer.wait()
            raise RuntimeError("redis read failed")
        finally:
            self.observer_finished.set()


class CancellationDuringShutdownFailureStore(FakeStore):
    async def finalize_run(self, event: TerminalRunEvent) -> RunFinalizationResult:
        if isinstance(event, RunFailedEvent) and event.data.reason == "shutdown":
            _ = await self.request_cancellation(
                event.run_id,
                CancelRunRequest(reason="concurrent_shutdown_cancel"),
            )
        return await super().finalize_run(event)


class SnapshotlessRunner:
    @property
    def terminal_session_snapshot(self) -> CompositorSessionSnapshot | None:
        return None

    @property
    def terminal_usage(self) -> AgentRunUsage | None:
        return None


class ControlledRunner:
    started: asyncio.Event
    release: asyncio.Event
    finished: asyncio.Event | None
    _terminal_session_snapshot: CompositorSessionSnapshot
    _terminal_usage: AgentRunUsage | None

    def __init__(
        self,
        *,
        started: asyncio.Event,
        release: asyncio.Event,
        finished: asyncio.Event | None = None,
        usage: AgentRunUsage | None = None,
    ) -> None:
        self.started = started
        self.release = release
        self.finished = finished
        self._terminal_session_snapshot = CompositorSessionSnapshot(layers=[])
        self._terminal_usage = usage

    @property
    def terminal_session_snapshot(self) -> CompositorSessionSnapshot:
        return self._terminal_session_snapshot

    @property
    def terminal_usage(self) -> AgentRunUsage | None:
        return self._terminal_usage

    async def run(self) -> None:
        _ = self.started.set()
        try:
            await self.release.wait()
        finally:
            if self.finished is not None:
                self.finished.set()


class PreEnterBlockingRunner(SnapshotlessRunner):
    def __init__(self, *, started: asyncio.Event) -> None:
        self.started = started

    async def run(self) -> None:
        self.started.set()
        await asyncio.Event().wait()


class SuccessThenWaitRunner(SnapshotlessRunner):
    def __init__(
        self,
        *,
        store: FakeStore,
        run_id: str,
        finalized: asyncio.Event,
        release: asyncio.Event,
    ) -> None:
        self.store = store
        self.run_id = run_id
        self.finalized = finalized
        self.release = release

    async def run(self) -> None:
        result = await emit_run_succeeded(
            self.store,
            run_id=self.run_id,
            output="done",
            session_snapshot=CompositorSessionSnapshot(layers=[]),
        )
        assert result.applied is True
        self.finalized.set()
        await self.release.wait()


class IgnoreCancellationThenSucceedRunner(SnapshotlessRunner):
    def __init__(
        self,
        *,
        store: FakeStore,
        run_id: str,
        started: asyncio.Event,
        release: asyncio.Event,
        finished: asyncio.Event,
    ) -> None:
        self.store = store
        self.run_id = run_id
        self.started = started
        self.release = release
        self.finished = finished

    async def run(self) -> None:
        try:
            self.started.set()
            while not self.release.is_set():
                try:
                    await self.release.wait()
                except asyncio.CancelledError:
                    continue
            result = await emit_run_succeeded(
                self.store,
                run_id=self.run_id,
                output="late success",
                session_snapshot=CompositorSessionSnapshot(layers=[]),
            )
            assert result.applied is False
            assert result.status == "running"
        finally:
            self.finished.set()


class ReleaseThenSucceedRunner(SnapshotlessRunner):
    def __init__(
        self,
        *,
        store: FakeStore,
        run_id: str,
        started: asyncio.Event,
        release: asyncio.Event,
        finished: asyncio.Event,
    ) -> None:
        self.store = store
        self.run_id = run_id
        self.started = started
        self.release = release
        self.finished = finished

    async def run(self) -> None:
        self.started.set()
        try:
            await self.release.wait()
            result = await emit_run_succeeded(
                self.store,
                run_id=self.run_id,
                output="done",
                session_snapshot=CompositorSessionSnapshot(layers=[]),
            )
            assert result.applied is True
        finally:
            self.finished.set()


class CompetingFailureRunner(SnapshotlessRunner):
    def __init__(
        self,
        *,
        store: FakeStore,
        run_id: str,
        started: asyncio.Event,
        release: asyncio.Event,
        failure_attempted: asyncio.Event,
    ) -> None:
        self.store = store
        self.run_id = run_id
        self.started = started
        self.release = release
        self.failure_attempted = failure_attempted

    async def run(self) -> None:
        self.started.set()
        try:
            await self.release.wait()
        except asyncio.CancelledError:
            pass
        _ = await emit_run_failed(self.store, run_id=self.run_id, error="runner failed", reason="model_error")
        self.failure_attempted.set()


class FinalizeSuccessOnCancellationRunner(SnapshotlessRunner):
    def __init__(self, *, store: FakeStore, run_id: str, started: asyncio.Event) -> None:
        self.store = store
        self.run_id = run_id
        self.started = started

    async def run(self) -> None:
        self.started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            result = await emit_run_succeeded(
                self.store,
                run_id=self.run_id,
                output="completed during shutdown",
                session_snapshot=CompositorSessionSnapshot(layers=[]),
            )
            assert result.applied is True


def test_default_runner_factory_passes_run_timeout_to_runner() -> None:
    async def scenario() -> None:
        store = FakeStore()
        record = await store.create_run()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                run_timeout_seconds=17,
            )

            runner = scheduler._default_runner_factory(record, _request(), is_cancelled=lambda: False)

        assert isinstance(runner, AgentRunRunner)
        assert runner.run_timeout_seconds == 17

    asyncio.run(scenario())


def test_create_run_starts_background_task_and_returns_running() -> None:
    async def scenario() -> None:
        store = FakeStore()
        started = asyncio.Event()
        release = asyncio.Event()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                runner_factory=lambda _record, _request: ControlledRunner(started=started, release=release),
            )

            record = await scheduler.create_run(_request())
            await asyncio.wait_for(started.wait(), timeout=1)

            assert record.status == "running"
            assert list(scheduler.active_tasks) == [record.run_id]
            _ = release.set()
            await asyncio.wait_for(scheduler.active_tasks[record.run_id], timeout=1)
            await asyncio.sleep(0)
            assert scheduler.active_tasks == {}

    asyncio.run(scenario())


def test_shutdown_marks_unfinished_runs_failed_and_appends_event() -> None:
    async def scenario() -> None:
        store = FakeStore()
        started = asyncio.Event()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                shutdown_grace_seconds=0,
                runner_factory=lambda _record, _request: ControlledRunner(started=started, release=asyncio.Event()),
            )
            record = await scheduler.create_run(_request())
            await asyncio.wait_for(started.wait(), timeout=1)

            await scheduler.shutdown()

            assert scheduler.stopping is True
            assert scheduler.active_tasks == {}
            assert store.statuses[record.run_id] == "failed"
            assert store.errors[record.run_id] == "run cancelled during server shutdown"
            assert [event.type for event in store.events[record.run_id]] == ["run_failed"]

    asyncio.run(scenario())


def test_shutdown_failure_finalization_yields_to_concurrent_cancellation_intent() -> None:
    async def scenario() -> None:
        store = CancellationDuringShutdownFailureStore()
        started = asyncio.Event()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                shutdown_grace_seconds=0,
                runner_factory=lambda _record, _request: ControlledRunner(
                    started=started,
                    release=asyncio.Event(),
                ),
            )
            record = await scheduler.create_run(_request())
            await asyncio.wait_for(started.wait(), timeout=1)

            await scheduler.shutdown()

            assert store.statuses[record.run_id] == "cancelled"
            assert record.run_id not in store.cancellation_intents
            assert [event.type for event in store.events[record.run_id]] == ["run_cancelled"]
            terminal = store.events[record.run_id][0]
            assert isinstance(terminal, RunCancelledEvent)
            assert terminal.data.reason == "concurrent_shutdown_cancel"
            assert terminal.data.session_snapshot == CompositorSessionSnapshot(layers=[])

    asyncio.run(scenario())


def test_cancellation_observer_failure_stops_runner_and_finalizes_failed() -> None:
    async def scenario() -> None:
        fail_observer = asyncio.Event()
        store = FailingObserverStore(fail_observer=fail_observer)
        runner_started = asyncio.Event()
        runner_finished = asyncio.Event()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                runner_factory=lambda _record, _request: ControlledRunner(
                    started=runner_started,
                    release=asyncio.Event(),
                    finished=runner_finished,
                ),
            )
            record = await scheduler.create_run(_request())
            supervisor_task = scheduler.active_tasks[record.run_id]
            await asyncio.wait_for(runner_started.wait(), timeout=1)

            fail_observer.set()
            await asyncio.wait_for(supervisor_task, timeout=1)

            assert store.statuses[record.run_id] == "failed"
            assert store.errors[record.run_id] == "run cancellation observer failed: redis read failed"
            assert [event.type for event in store.events[record.run_id]] == ["run_failed"]
            assert runner_finished.is_set()
            assert store.observer_finished.is_set()
            await asyncio.sleep(0)
            assert scheduler.active_tasks == {}

    asyncio.run(scenario())


def test_cancellation_observer_failure_finalizes_concurrent_intent_after_runner_exit() -> None:
    async def scenario() -> None:
        fail_observer = asyncio.Event()
        store = FailingObserverStore(fail_observer=fail_observer)
        runner_started = asyncio.Event()
        runner_finished = asyncio.Event()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                runner_factory=lambda _record, _request: ControlledRunner(
                    started=runner_started,
                    release=asyncio.Event(),
                    finished=runner_finished,
                ),
            )
            record = await scheduler.create_run(_request())
            supervisor_task = scheduler.active_tasks[record.run_id]
            await asyncio.wait_for(runner_started.wait(), timeout=1)

            response = await scheduler.cancel_run(
                record.run_id,
                CancelRunRequest(reason="workflow_aborted", message="outer workflow stopped"),
            )
            fail_observer.set()
            await asyncio.wait_for(supervisor_task, timeout=1)

            assert response.status == "cancelled"
            assert runner_finished.is_set()
            assert store.statuses[record.run_id] == "cancelled"
            assert record.run_id not in store.cancellation_intents
            assert [event.type for event in store.events[record.run_id]] == ["run_cancelled"]
            terminal = store.events[record.run_id][0]
            assert isinstance(terminal, RunCancelledEvent)
            assert terminal.data.session_snapshot == CompositorSessionSnapshot(layers=[])

    asyncio.run(scenario())


def test_non_owner_cancel_run_stops_owner_task_and_persists_cancelled_terminal() -> None:
    async def scenario() -> None:
        store = TrackingStore()
        started = asyncio.Event()
        runner_finished = asyncio.Event()
        async with httpx.AsyncClient() as client:
            owner_scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                runner_factory=lambda _record, _request: ControlledRunner(
                    started=started,
                    release=asyncio.Event(),
                    finished=runner_finished,
                    usage=AgentRunUsage(prompt_tokens=13, completion_tokens=8),
                ),
            )
            remote_scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
            )
            record = await owner_scheduler.create_run(_request())
            owner_task = owner_scheduler.active_tasks[record.run_id]
            await asyncio.wait_for(started.wait(), timeout=1)
            await asyncio.wait_for(store.observer_started.wait(), timeout=1)

            response = await remote_scheduler.cancel_run(
                record.run_id,
                CancelRunRequest(reason="workflow_aborted", message="outer workflow stopped"),
            )

            assert response.status == "cancelled"
            assert remote_scheduler.active_tasks == {}
            await asyncio.wait_for(owner_task, timeout=1)
            assert store.statuses[record.run_id] == "cancelled"
            assert store.errors[record.run_id] == "outer workflow stopped"
            assert [event.type for event in store.events[record.run_id]] == ["run_cancelled"]
            terminal = store.events[record.run_id][0]
            assert isinstance(terminal, RunCancelledEvent)
            assert terminal.data.session_snapshot == CompositorSessionSnapshot(layers=[])
            assert terminal.data.usage is not None
            assert terminal.data.usage.prompt_tokens == 13
            assert terminal.data.usage.completion_tokens == 8
            assert terminal.data.usage.total_tokens == 21
            assert runner_finished.is_set()
            assert store.observer_finished.is_set()
            await asyncio.sleep(0)
            assert owner_scheduler.active_tasks == {}

            repeated = await remote_scheduler.cancel_run(record.run_id, CancelRunRequest(reason="duplicate"))
            assert repeated.status == "cancelled"
            assert [event.type for event in store.events[record.run_id]] == ["run_cancelled"]

    asyncio.run(scenario())


def test_pre_enter_cancellation_does_not_copy_input_session_snapshot() -> None:
    async def scenario() -> None:
        store = FakeStore()
        started = asyncio.Event()
        request = _request()
        request.session_snapshot = CompositorSessionSnapshot(
            layers=[
                LayerSessionSnapshot(
                    name="prior",
                    lifecycle_state=LifecycleState.SUSPENDED,
                    runtime_state={"value": "prior"},
                )
            ]
        )
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                runner_factory=lambda _record, _request: PreEnterBlockingRunner(started=started),
            )
            record = await scheduler.create_run(request)
            supervisor = scheduler.active_tasks[record.run_id]
            await asyncio.wait_for(started.wait(), timeout=1)

            _ = await scheduler.cancel_run(record.run_id, CancelRunRequest(reason="pre_enter_cancel"))
            await asyncio.wait_for(supervisor, timeout=1)

            terminal = store.events[record.run_id][0]
            assert isinstance(terminal, RunCancelledEvent)
            assert request.session_snapshot is not None
            assert terminal.data.session_snapshot is None

    asyncio.run(scenario())


def test_cancel_run_does_not_override_successful_terminal() -> None:
    async def scenario() -> None:
        store = FakeStore()
        finalized = asyncio.Event()
        release = asyncio.Event()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                runner_factory=lambda record, _request: SuccessThenWaitRunner(
                    store=store,
                    run_id=record.run_id,
                    finalized=finalized,
                    release=release,
                ),
            )
            record = await scheduler.create_run(_request())
            await asyncio.wait_for(finalized.wait(), timeout=1)
            task = scheduler.active_tasks[record.run_id]

            with pytest.raises(RunCancellationConflictError, match="already finished with status 'succeeded'"):
                await scheduler.cancel_run(record.run_id, CancelRunRequest(reason="late_cancel"))

            assert task.done() is False
            assert store.statuses[record.run_id] == "succeeded"
            assert [event.type for event in store.events[record.run_id]] == ["run_succeeded"]
            release.set()
            await asyncio.wait_for(task, timeout=1)

    asyncio.run(scenario())


def test_cancelled_terminal_survives_shutdown_while_runner_cleanup_is_pending() -> None:
    async def scenario() -> None:
        store = TrackingStore()
        started = asyncio.Event()
        release = asyncio.Event()
        runner_finished = asyncio.Event()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                shutdown_grace_seconds=0,
                runner_factory=lambda record, _request: IgnoreCancellationThenSucceedRunner(
                    store=store,
                    run_id=record.run_id,
                    started=started,
                    release=release,
                    finished=runner_finished,
                ),
            )
            record = await scheduler.create_run(_request())
            supervisor_task = scheduler.active_tasks[record.run_id]
            await asyncio.wait_for(started.wait(), timeout=1)
            await asyncio.wait_for(store.observer_started.wait(), timeout=1)

            response = await scheduler.cancel_run(record.run_id, CancelRunRequest(reason="workflow_aborted"))

            assert response.status == "cancelled"
            assert store.statuses[record.run_id] == "running"
            assert store.events[record.run_id] == []
            assert record.run_id in store.cancellation_intents
            await asyncio.wait_for(store.observer_finished.wait(), timeout=1)
            assert supervisor_task.done() is False
            shutdown_task = asyncio.create_task(scheduler.shutdown())
            await asyncio.sleep(0)
            assert shutdown_task.done() is False
            release.set()
            await asyncio.wait_for(shutdown_task, timeout=1)

            assert supervisor_task.done()
            assert runner_finished.is_set()
            assert store.observer_finished.is_set()
            assert scheduler.active_tasks == {}
            assert store.statuses[record.run_id] == "cancelled"
            assert [event.type for event in store.events[record.run_id]] == ["run_cancelled"]

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("winner", "expected_event_type"),
    [
        pytest.param("failed", "run_failed", id="failure-first"),
        pytest.param("cancelled", "run_cancelled", id="cancellation-first"),
    ],
)
def test_failure_and_cancellation_keep_the_first_terminal(
    winner: RunStatus,
    expected_event_type: str,
) -> None:
    async def scenario() -> None:
        store = FakeStore()
        runner_started = asyncio.Event()
        release_runner = asyncio.Event()
        failure_attempted = asyncio.Event()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                runner_factory=lambda record, _request: CompetingFailureRunner(
                    store=store,
                    run_id=record.run_id,
                    started=runner_started,
                    release=release_runner,
                    failure_attempted=failure_attempted,
                ),
            )
            record = await scheduler.create_run(_request())
            supervisor_task = scheduler.active_tasks[record.run_id]
            await asyncio.wait_for(runner_started.wait(), timeout=1)

            if winner == "failed":
                release_runner.set()
                await asyncio.wait_for(failure_attempted.wait(), timeout=1)
                with pytest.raises(RunCancellationConflictError, match="already finished with status 'failed'"):
                    await scheduler.cancel_run(record.run_id, CancelRunRequest(reason="late_cancel"))
            else:
                response = await scheduler.cancel_run(
                    record.run_id,
                    CancelRunRequest(reason="cancel_before_failure"),
                )
                assert response.run_id == record.run_id
                assert response.status == "cancelled"
                release_runner.set()

            await asyncio.wait_for(failure_attempted.wait(), timeout=1)
            await asyncio.wait_for(supervisor_task, timeout=1)

            assert store.statuses[record.run_id] == winner
            assert [event.type for event in store.events[record.run_id]] == [expected_event_type]

    asyncio.run(scenario())


def test_shutdown_grace_allows_runner_first_completion_and_reaps_children() -> None:
    async def scenario() -> None:
        store = TrackingStore(pause_observer=True)
        runner_started = asyncio.Event()
        release_runner = asyncio.Event()
        runner_finished = asyncio.Event()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                shutdown_grace_seconds=1,
                runner_factory=lambda record, _request: ReleaseThenSucceedRunner(
                    store=store,
                    run_id=record.run_id,
                    started=runner_started,
                    release=release_runner,
                    finished=runner_finished,
                ),
            )
            record = await scheduler.create_run(_request())
            supervisor_task = scheduler.active_tasks[record.run_id]
            await asyncio.wait_for(runner_started.wait(), timeout=1)
            await asyncio.wait_for(store.observer_started.wait(), timeout=1)

            shutdown_task = asyncio.create_task(scheduler.shutdown())
            await asyncio.sleep(0)
            assert shutdown_task.done() is False
            release_runner.set()
            await asyncio.wait_for(shutdown_task, timeout=1)

            assert supervisor_task.done()
            assert runner_finished.is_set()
            assert store.observer_finished.is_set()
            assert scheduler.active_tasks == {}
            assert store.statuses[record.run_id] == "succeeded"
            assert [event.type for event in store.events[record.run_id]] == ["run_succeeded"]

    asyncio.run(scenario())


def test_shutdown_does_not_append_failed_after_success_wins() -> None:
    async def scenario() -> None:
        store = FakeStore()
        started = asyncio.Event()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                shutdown_grace_seconds=0,
                runner_factory=lambda record, _request: FinalizeSuccessOnCancellationRunner(
                    store=store,
                    run_id=record.run_id,
                    started=started,
                ),
            )
            record = await scheduler.create_run(_request())
            await asyncio.wait_for(started.wait(), timeout=1)

            await scheduler.shutdown()

            assert store.statuses[record.run_id] == "succeeded"
            assert [event.type for event in store.events[record.run_id]] == ["run_succeeded"]

    asyncio.run(scenario())


def test_cancel_run_rejects_finished_run() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=store, plugin_daemon_http_client=client, dify_api_http_client=client)
            record = await store.create_run()
            store.statuses[record.run_id] = "succeeded"

            with pytest.raises(RunCancellationConflictError, match="already finished"):
                await scheduler.cancel_run(record.run_id, CancelRunRequest())

    asyncio.run(scenario())


def test_create_run_accepts_blank_prompt_and_runner_fails_asynchronously() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=store, plugin_daemon_http_client=client, dify_api_http_client=client)

            record = await scheduler.create_run(_request(["", "   "]))
            await asyncio.wait_for(scheduler.active_tasks[record.run_id], timeout=1)

        assert store.records == {record.run_id: record}
        assert [event.type for event in store.events[record.run_id]] == ["run_started", "run_failed"]
        assert store.statuses[record.run_id] == "failed"
        assert store.errors[record.run_id] == "run.user_prompts must not be empty"

    asyncio.run(scenario())


def test_create_run_accepts_invalid_output_schema_and_runner_fails_asynchronously() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=store, plugin_daemon_http_client=client, dify_api_http_client=client)

            record = await scheduler.create_run(
                _request(
                    output_config={
                        "json_schema": _recursive_output_schema(),
                    }
                )
            )
            await asyncio.wait_for(scheduler.active_tasks[record.run_id], timeout=1)

        assert store.records == {record.run_id: record}
        assert [event.type for event in store.events[record.run_id]] == ["run_started", "run_failed"]
        assert store.statuses[record.run_id] == "failed"
        assert "Recursive $defs refs are not supported" in (store.errors[record.run_id] or "")

    asyncio.run(scenario())


def test_create_run_honors_explicit_empty_layer_providers_by_failing_after_persisting() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                layer_providers=(),
            )

            record = await scheduler.create_run(_request())
            await asyncio.wait_for(scheduler.active_tasks[record.run_id], timeout=1)

        assert store.records == {record.run_id: record}
        assert [event.type for event in store.events[record.run_id]] == ["run_started", "run_failed"]
        assert store.statuses[record.run_id] == "failed"
        assert "plain.prompt" in (store.errors[record.run_id] or "")

    asyncio.run(scenario())


def test_create_run_accepts_closed_session_snapshot_and_runner_fails_asynchronously() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=store, plugin_daemon_http_client=client, dify_api_http_client=client)
            request = _request()
            request.session_snapshot = CompositorSessionSnapshot(
                layers=[
                    LayerSessionSnapshot(
                        name="prompt",
                        lifecycle_state=LifecycleState.CLOSED,
                        runtime_state={},
                    ),
                    LayerSessionSnapshot(
                        name="execution_context",
                        lifecycle_state=LifecycleState.SUSPENDED,
                        runtime_state={},
                    ),
                    LayerSessionSnapshot(
                        name=DIFY_AGENT_MODEL_LAYER_ID,
                        lifecycle_state=LifecycleState.SUSPENDED,
                        runtime_state={},
                    ),
                ]
            )

            record = await scheduler.create_run(request)
            await asyncio.wait_for(scheduler.active_tasks[record.run_id], timeout=1)

        assert store.records == {record.run_id: record}
        assert [event.type for event in store.events[record.run_id]] == ["run_started", "run_failed"]
        assert store.statuses[record.run_id] == "failed"
        assert "CLOSED snapshots cannot be entered" in (store.errors[record.run_id] or "")

    asyncio.run(scenario())


def test_create_run_rejects_after_shutdown_starts() -> None:
    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=FakeStore(), plugin_daemon_http_client=client, dify_api_http_client=client)
            await scheduler.shutdown()

            with pytest.raises(SchedulerStoppingError):
                await scheduler.create_run(_request())

    asyncio.run(scenario())


def test_create_run_rejects_invalid_request_after_shutdown_without_persisting() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=store, plugin_daemon_http_client=client, dify_api_http_client=client)
            await scheduler.shutdown()

            with pytest.raises(SchedulerStoppingError):
                _ = await scheduler.create_run(_request(["", "   "]))

        assert store.records == {}

    asyncio.run(scenario())


def test_shutdown_waits_for_in_flight_create_to_register_before_cancelling() -> None:
    async def scenario() -> None:
        create_started = asyncio.Event()
        release_create = asyncio.Event()
        runner_started = asyncio.Event()
        store = SlowCreateStore(create_started=create_started, release_create=release_create)
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                shutdown_grace_seconds=0,
                runner_factory=lambda _record, _request: ControlledRunner(
                    started=runner_started, release=asyncio.Event()
                ),
            )

            create_task = asyncio.create_task(scheduler.create_run(_request()))
            await asyncio.wait_for(create_started.wait(), timeout=1)
            shutdown_task = asyncio.create_task(scheduler.shutdown())
            await asyncio.sleep(0)

            assert shutdown_task.done() is False
            assert scheduler.stopping is False

            _ = release_create.set()
            record = await asyncio.wait_for(create_task, timeout=1)
            await asyncio.wait_for(shutdown_task, timeout=1)

            assert scheduler.stopping is True
            assert scheduler.active_tasks == {}
            assert store.statuses[record.run_id] == "failed"
            assert [event.type for event in store.events[record.run_id]] == ["run_failed"]

            with pytest.raises(SchedulerStoppingError):
                await scheduler.create_run(_request())

    asyncio.run(scenario())
