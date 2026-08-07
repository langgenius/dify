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
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID, DIFY_AGENT_OUTPUT_LAYER_ID
from dify_agent.protocol.schemas import (
    CancelRunRequest,
    CreateRunRequest,
    RunComposition,
    RunEvent,
    RunLayerSpec,
    RunStatus,
)
from dify_agent.runtime.event_sink import (
    NonTerminalRunEvent,
    RunFinalizationResult,
    TerminalRunEvent,
    emit_run_failed,
    emit_run_succeeded,
    terminal_event_status_and_error,
)
from dify_agent.runtime.run_scheduler import RunCancellationConflictError, RunScheduler, SchedulerStoppingError
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
                credentials={"api_key": "secret"},
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
    terminal_changes: dict[str, asyncio.Event]

    def __init__(self) -> None:
        self.records = {}
        self.events = defaultdict(list)
        self.statuses = {}
        self.errors = {}
        self.terminal_changes = {}

    async def create_run(self) -> RunRecord:
        run_id = f"run-{len(self.records) + 1}"
        record = RunRecord(run_id=run_id, status="running")
        self.records[run_id] = record
        self.statuses[run_id] = "running"
        self.terminal_changes[run_id] = asyncio.Event()
        return record

    async def append_event(self, event: NonTerminalRunEvent) -> str:
        event_id = str(len(self.events[event.run_id]) + 1)
        self.events[event.run_id].append(event.model_copy(update={"id": event_id}))
        return event_id

    async def get_run(self, run_id: str) -> RunRecord:
        return self.records[run_id].model_copy(
            update={"status": self.statuses[run_id], "error": self.errors.get(run_id)},
        )

    async def finalize_run(self, event: TerminalRunEvent) -> RunFinalizationResult:
        current_status = self.statuses[event.run_id]
        if current_status != "running":
            return RunFinalizationResult(applied=False, status=current_status)

        status, error = terminal_event_status_and_error(event)
        event_id = str(len(self.events[event.run_id]) + 1)
        self.events[event.run_id].append(event.model_copy(update={"id": event_id}))
        self.statuses[event.run_id] = status
        self.errors[event.run_id] = error
        self.terminal_changes[event.run_id].set()
        return RunFinalizationResult(applied=True, status=status, event_id=event_id)

    async def wait_for_cancellation(self, run_id: str) -> bool:
        while self.statuses[run_id] == "running":
            await self.terminal_changes[run_id].wait()
        return self.statuses[run_id] == "cancelled"


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

    async def wait_for_cancellation(self, run_id: str) -> bool:
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

    async def wait_for_cancellation(self, run_id: str) -> bool:
        del run_id
        try:
            await self.fail_observer.wait()
            raise RuntimeError("redis read failed")
        finally:
            self.observer_finished.set()


class ControlledRunner:
    started: asyncio.Event
    release: asyncio.Event
    finished: asyncio.Event | None

    def __init__(
        self,
        *,
        started: asyncio.Event,
        release: asyncio.Event,
        finished: asyncio.Event | None = None,
    ) -> None:
        self.started = started
        self.release = release
        self.finished = finished

    async def run(self) -> None:
        _ = self.started.set()
        try:
            await self.release.wait()
        finally:
            if self.finished is not None:
                self.finished.set()


class SwallowOneCancellationRunner:
    started: asyncio.Event
    first_cancellation: asyncio.Event

    def __init__(self, *, started: asyncio.Event, first_cancellation: asyncio.Event) -> None:
        self.started = started
        self.first_cancellation = first_cancellation

    async def run(self) -> None:
        _ = self.started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            _ = self.first_cancellation.set()
            await asyncio.Event().wait()


class SuccessThenWaitRunner:
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


class IgnoreCancellationThenSucceedRunner:
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
            assert result.status == "cancelled"
        finally:
            self.finished.set()


class ReleaseThenSucceedRunner:
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


class CompetingFailureRunner:
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


class FinalizeSuccessOnCancellationRunner:
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
            assert store.statuses[record.run_id] == "cancelled"
            assert store.errors[record.run_id] == "outer workflow stopped"
            assert [event.type for event in store.events[record.run_id]] == ["run_cancelled"]
            await asyncio.wait_for(owner_task, timeout=1)
            assert runner_finished.is_set()
            assert store.observer_finished.is_set()
            await asyncio.sleep(0)
            assert owner_scheduler.active_tasks == {}

            repeated = await remote_scheduler.cancel_run(record.run_id, CancelRunRequest(reason="duplicate"))
            assert repeated.status == "cancelled"
            assert [event.type for event in store.events[record.run_id]] == ["run_cancelled"]

    asyncio.run(scenario())


def test_owner_observer_reinjects_cancellation_consumed_by_runner() -> None:
    async def scenario() -> None:
        store = FakeStore()
        started = asyncio.Event()
        first_cancellation = asyncio.Event()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                runner_factory=lambda _record, _request: SwallowOneCancellationRunner(
                    started=started,
                    first_cancellation=first_cancellation,
                ),
            )
            record = await scheduler.create_run(_request())
            supervisor_task = scheduler.active_tasks[record.run_id]
            await asyncio.wait_for(started.wait(), timeout=1)

            response = await asyncio.wait_for(
                scheduler.cancel_run(record.run_id, CancelRunRequest(reason="workflow_aborted")),
                timeout=1,
            )

            assert response.status == "cancelled"
            assert store.statuses[record.run_id] == "cancelled"
            assert [event.type for event in store.events[record.run_id]] == ["run_cancelled"]
            await asyncio.wait_for(first_cancellation.wait(), timeout=1)
            await asyncio.wait_for(supervisor_task, timeout=1)
            await asyncio.sleep(0)
            assert scheduler.active_tasks == {}

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
            assert store.statuses[record.run_id] == "cancelled"
            assert [event.type for event in store.events[record.run_id]] == ["run_cancelled"]
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
