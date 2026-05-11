import asyncio
from collections import defaultdict
from typing import cast

import pytest
from pydantic import JsonValue

from agenton.compositor import CompositorConfig, LayerNodeConfig
from dify_agent.runtime.run_scheduler import RunScheduler, SchedulerStoppingError
from dify_agent.server.schemas import CreateRunRequest, RunEvent, RunRecord, RunStatus


def _request(user: str | list[str] = "hello") -> CreateRunRequest:
    return CreateRunRequest(
        compositor=CompositorConfig(
            layers=[LayerNodeConfig(name="prompt", type="plain.prompt", config=cast(JsonValue, {"user": user}))]
        )
    )


class FakeStore:
    records: dict[str, RunRecord]
    events: dict[str, list[RunEvent]]
    statuses: dict[str, RunStatus]
    errors: dict[str, str | None]

    def __init__(self) -> None:
        self.records = {}
        self.events = defaultdict(list)
        self.statuses = {}
        self.errors = {}

    async def create_run(self, request: CreateRunRequest) -> RunRecord:
        run_id = f"run-{len(self.records) + 1}"
        record = RunRecord(run_id=run_id, status="running", request=request)
        self.records[run_id] = record
        self.statuses[run_id] = "running"
        return record

    async def append_event(self, event: RunEvent) -> str:
        event_id = str(len(self.events[event.run_id]) + 1)
        self.events[event.run_id].append(event.model_copy(update={"id": event_id}))
        return event_id

    async def update_status(self, run_id: str, status: RunStatus, error: str | None = None) -> None:
        self.statuses[run_id] = status
        self.errors[run_id] = error


class SlowCreateStore(FakeStore):
    create_started: asyncio.Event
    release_create: asyncio.Event

    def __init__(self, *, create_started: asyncio.Event, release_create: asyncio.Event) -> None:
        super().__init__()
        self.create_started = create_started
        self.release_create = release_create

    async def create_run(self, request: CreateRunRequest) -> RunRecord:
        _ = self.create_started.set()
        await self.release_create.wait()
        return await super().create_run(request)


class ControlledRunner:
    started: asyncio.Event
    release: asyncio.Event

    def __init__(self, *, started: asyncio.Event, release: asyncio.Event) -> None:
        self.started = started
        self.release = release

    async def run(self) -> None:
        _ = self.started.set()
        await self.release.wait()


def test_create_run_starts_background_task_and_returns_running() -> None:
    async def scenario() -> None:
        store = FakeStore()
        started = asyncio.Event()
        release = asyncio.Event()
        scheduler = RunScheduler(
            store=store,
            runner_factory=lambda _record: ControlledRunner(started=started, release=release),
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
        scheduler = RunScheduler(
            store=store,
            shutdown_grace_seconds=0,
            runner_factory=lambda _record: ControlledRunner(started=started, release=asyncio.Event()),
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


def test_create_run_rejects_blank_prompt_before_persisting() -> None:
    async def scenario() -> None:
        store = FakeStore()
        scheduler = RunScheduler(store=store)

        with pytest.raises(ValueError, match="compositor.user_prompts must not be empty"):
            await scheduler.create_run(_request(["", "   "]))

        assert store.records == {}

    asyncio.run(scenario())


def test_create_run_rejects_after_shutdown_starts() -> None:
    async def scenario() -> None:
        scheduler = RunScheduler(store=FakeStore())
        await scheduler.shutdown()

        with pytest.raises(SchedulerStoppingError):
            await scheduler.create_run(_request())

    asyncio.run(scenario())


def test_shutdown_waits_for_in_flight_create_to_register_before_cancelling() -> None:
    async def scenario() -> None:
        create_started = asyncio.Event()
        release_create = asyncio.Event()
        runner_started = asyncio.Event()
        store = SlowCreateStore(create_started=create_started, release_create=release_create)
        scheduler = RunScheduler(
            store=store,
            shutdown_grace_seconds=0,
            runner_factory=lambda _record: ControlledRunner(started=runner_started, release=asyncio.Event()),
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
