import asyncio
from collections import defaultdict
from collections.abc import Mapping

import httpx
import pytest

from agenton.compositor import CompositorSessionSnapshot, LayerSessionSnapshot
from agenton.layers import ExitIntent, LifecycleState
from agenton_collections.layers.plain import PromptLayerConfig
from dify_agent.layers.output import DIFY_OUTPUT_LAYER_TYPE_ID, DifyOutputLayerConfig
from dify_agent.protocol import DIFY_AGENT_OUTPUT_LAYER_ID
from dify_agent.protocol.schemas import (
    CreateRunRequest,
    LayerExitSignals,
    RunComposition,
    RunEvent,
    RunLayerSpec,
    RunStatus,
)
from dify_agent.runtime.run_scheduler import (
    RunRequestValidationError,
    RunScheduler,
    SchedulerStoppingError,
    validate_run_request,
)
from dify_agent.server.schemas import RunRecord


def _request(
    user: str | list[str] = "hello",
    *,
    output_config: Mapping[str, object] | DifyOutputLayerConfig | None = None,
) -> CreateRunRequest:
    layers = [RunLayerSpec(name="prompt", type="plain.prompt", config=PromptLayerConfig(user=user))]
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

    def __init__(self) -> None:
        self.records = {}
        self.events = defaultdict(list)
        self.statuses = {}
        self.errors = {}

    async def create_run(self) -> RunRecord:
        run_id = f"run-{len(self.records) + 1}"
        record = RunRecord(run_id=run_id, status="running")
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

    async def create_run(self) -> RunRecord:
        _ = self.create_started.set()
        await self.release_create.wait()
        return await super().create_run()


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
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(
                store=store,
                plugin_daemon_http_client=client,
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


def test_create_run_rejects_blank_prompt_before_persisting() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=store, plugin_daemon_http_client=client)

            with pytest.raises(ValueError, match="run.user_prompts must not be empty"):
                await scheduler.create_run(_request(["", "   "]))

        assert store.records == {}

    asyncio.run(scenario())


def test_create_run_rejects_invalid_output_schema_before_persisting() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=store, plugin_daemon_http_client=client)

            with pytest.raises(ValueError, match=r"Recursive \$defs refs are not supported"):
                await scheduler.create_run(
                    _request(
                        output_config={
                            "name": "incident_summary",
                            "json_schema": _recursive_output_schema(),
                        }
                    )
                )

        assert store.records == {}

    asyncio.run(scenario())


def test_create_run_rejects_remote_ref_output_schema_before_persisting() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=store, plugin_daemon_http_client=client)

            with pytest.raises(ValueError, match=r"Remote \$ref values are not supported"):
                await scheduler.create_run(
                    _request(
                        output_config={
                            "name": "incident_summary",
                            "json_schema": {
                                "type": "object",
                                "properties": {
                                    "title": {"$ref": "https://example.com/schema.json"},
                                },
                            },
                        }
                    )
                )

        assert store.records == {}

    asyncio.run(scenario())


def test_create_run_rejects_non_object_output_schema_before_persisting() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=store, plugin_daemon_http_client=client)

            with pytest.raises(ValueError, match="Schema must declare an object output"):
                await scheduler.create_run(
                    _request(
                        output_config={
                            "name": "incident_actions",
                            "json_schema": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                        }
                    )
                )

        assert store.records == {}

    asyncio.run(scenario())


def test_create_run_rejects_non_defs_local_ref_in_direct_object_schema_before_persisting() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=store, plugin_daemon_http_client=client)

            with pytest.raises(ValueError, match=r"Only local refs under '#/\$defs/' are supported"):
                await scheduler.create_run(
                    _request(
                        output_config={
                            "name": "incident_summary",
                            "json_schema": {
                                "type": "object",
                                "properties": {
                                    "items": {"$ref": "#/definitions/itemArray"},
                                },
                                "required": ["items"],
                                "definitions": {
                                    "itemArray": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    },
                                },
                            },
                        }
                    )
                )

        assert store.records == {}

    asyncio.run(scenario())


def test_create_run_rejects_misnamed_output_layer_before_persisting() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=store, plugin_daemon_http_client=client)

            request = CreateRunRequest(
                composition=RunComposition(
                    layers=[
                        RunLayerSpec(name="prompt", type="plain.prompt", config=PromptLayerConfig(user="hello")),
                        RunLayerSpec(
                            name="structured-output",
                            type=DIFY_OUTPUT_LAYER_TYPE_ID,
                            config=DifyOutputLayerConfig(
                                json_schema={
                                    "type": "object",
                                    "properties": {"title": {"type": "string"}},
                                    "required": ["title"],
                                    "additionalProperties": False,
                                }
                            ),
                        ),
                    ]
                )
            )

            with pytest.raises(ValueError, match="must use reserved layer name 'output'"):
                await scheduler.create_run(request)

        assert store.records == {}

    asyncio.run(scenario())


def test_create_run_rejects_multiple_output_layers_before_persisting() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=store, plugin_daemon_http_client=client)

            request = CreateRunRequest(
                composition=RunComposition(
                    layers=[
                        RunLayerSpec(name="prompt", type="plain.prompt", config=PromptLayerConfig(user="hello")),
                        RunLayerSpec(
                            name=DIFY_AGENT_OUTPUT_LAYER_ID,
                            type=DIFY_OUTPUT_LAYER_TYPE_ID,
                            config=DifyOutputLayerConfig(
                                json_schema={
                                    "type": "object",
                                    "properties": {"title": {"type": "string"}},
                                    "required": ["title"],
                                    "additionalProperties": False,
                                }
                            ),
                        ),
                        RunLayerSpec(
                            name="secondary-output",
                            type=DIFY_OUTPUT_LAYER_TYPE_ID,
                            config=DifyOutputLayerConfig(
                                json_schema={
                                    "type": "object",
                                    "properties": {"summary": {"type": "string"}},
                                    "required": ["summary"],
                                    "additionalProperties": False,
                                }
                            ),
                        ),
                    ]
                )
            )

            with pytest.raises(ValueError, match="Only one 'dify.output' layer is supported"):
                await scheduler.create_run(request)

        assert store.records == {}

    asyncio.run(scenario())


def test_create_run_rejects_reserved_output_name_with_wrong_layer_type_before_persisting() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=store, plugin_daemon_http_client=client)

            request = CreateRunRequest(
                composition=RunComposition(
                    layers=[
                        RunLayerSpec(name="prompt", type="plain.prompt", config=PromptLayerConfig(user="hello")),
                        RunLayerSpec(
                            name=DIFY_AGENT_OUTPUT_LAYER_ID, type="plain.prompt", config=PromptLayerConfig(user="hi")
                        ),
                    ]
                )
            )

            with pytest.raises(ValueError, match=r"Layer 'output' must be DifyOutputLayer, got PromptLayer"):
                await scheduler.create_run(request)

        assert store.records == {}

    asyncio.run(scenario())


def test_validate_run_request_honors_explicit_empty_layer_providers() -> None:
    async def scenario() -> None:
        with pytest.raises(RunRequestValidationError, match="plain.prompt"):
            await validate_run_request(_request(), layer_providers=())

    asyncio.run(scenario())


def test_validate_run_request_rejects_misnamed_output_layer_before_provider_checks() -> None:
    async def scenario() -> None:
        request = CreateRunRequest(
            composition=RunComposition(
                layers=[
                    RunLayerSpec(name="prompt", type="plain.prompt", config=PromptLayerConfig(user="hello")),
                    RunLayerSpec(
                        name="structured-output",
                        type=DIFY_OUTPUT_LAYER_TYPE_ID,
                        config=DifyOutputLayerConfig(
                            json_schema={
                                "type": "object",
                                "properties": {"title": {"type": "string"}},
                                "required": ["title"],
                                "additionalProperties": False,
                            }
                        ),
                    ),
                ]
            )
        )

        with pytest.raises(RunRequestValidationError, match="must use reserved layer name 'output'"):
            await validate_run_request(request, layer_providers=())

    asyncio.run(scenario())


def test_create_run_rejects_unknown_layer_exit_signal_before_persisting() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=store, plugin_daemon_http_client=client)
            request = _request()
            request.on_exit = LayerExitSignals(layers={"missing": ExitIntent.DELETE})

            with pytest.raises(ValueError, match="missing"):
                await scheduler.create_run(request)

        assert store.records == {}

    asyncio.run(scenario())


def test_create_run_honors_explicit_empty_layer_providers_before_persisting() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=store, plugin_daemon_http_client=client, layer_providers=())

            with pytest.raises(RunRequestValidationError, match="plain.prompt"):
                await scheduler.create_run(_request())

        assert store.records == {}

    asyncio.run(scenario())


def test_create_run_rejects_closed_session_snapshot_before_persisting() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=store, plugin_daemon_http_client=client)
            request = _request()
            request.session_snapshot = CompositorSessionSnapshot(
                layers=[
                    LayerSessionSnapshot(
                        name="prompt",
                        lifecycle_state=LifecycleState.CLOSED,
                        runtime_state={},
                    )
                ]
            )

            with pytest.raises(ValueError, match="CLOSED snapshots cannot be entered"):
                _ = await scheduler.create_run(request)

        assert store.records == {}

    asyncio.run(scenario())


def test_create_run_rejects_after_shutdown_starts() -> None:
    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=FakeStore(), plugin_daemon_http_client=client)
            await scheduler.shutdown()

            with pytest.raises(SchedulerStoppingError):
                await scheduler.create_run(_request())

    asyncio.run(scenario())


def test_create_run_rejects_invalid_request_after_shutdown_without_persisting() -> None:
    async def scenario() -> None:
        store = FakeStore()
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=store, plugin_daemon_http_client=client)
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
