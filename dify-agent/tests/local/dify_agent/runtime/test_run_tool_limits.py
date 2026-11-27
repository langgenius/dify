"""Native runs own counters; production Redis event writes only persist sealed summaries.

FunctionModel drives the real native toolset/runner. MockTransport is only the
remote core-tools HTTP boundary, and fakeredis executes the normal store's Lua.
Cancellation uses a private real Redis server; these tests do not claim real
provider or deployment coverage.
"""

import asyncio
import hashlib
import pathlib
import shutil
import subprocess
import tempfile

import httpx
import pytest
from fakeredis.aioredis import FakeRedis
from redis.asyncio import Redis
from redis.exceptions import ConnectionError as RedisConnectionError
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.models.function import DeltaToolCall, FunctionModel

from dify_agent.layers.dify_plugin import llm_layer
from dify_agent.protocol.schemas import (
    CancelRunRequest,
    PydanticAIStreamRunEvent,
    RunCancelledEvent,
    RunFailedEvent,
    RunLayerSpec,
    RunSucceededEvent,
)
from dify_agent.protocol.tool_call_limits import unconfirmed_reservation
from dify_agent.runtime.context import Deps, Services
from dify_agent.runtime.event_sink import InMemoryRunEventSink
from dify_agent.runtime.run_scheduler import RunScheduler
from dify_agent.runtime.runner import AgentRunRunner
from dify_agent.runtime.tool_call_limits import ToolCallLimitRunUnavailable
from dify_agent.storage.redis_keys import run_record_key
from dify_agent.storage.redis_run_store import RedisRunStore
from tests.local.dify_agent.runtime.test_runner import request


@pytest.fixture
async def cancellation_redis():
    """Use real blocking XREAD cancellation: fakeredis leaves that lock held.

    An optional private Unix-socket Redis process owns no shared port or data.
    Environments without redis-server skip only these native cancellation tests.
    """
    executable = shutil.which("redis-server")
    if executable is None:
        pytest.skip("native cancellation storage tests require redis-server")
    with tempfile.TemporaryDirectory(prefix="agent-limits-", dir="/tmp") as directory:
        address = str(pathlib.Path(directory) / "redis.sock")
        process = subprocess.Popen(
            [executable, "--port", "0", "--unixsocket", address, "--save", "", "--appendonly", "no"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            async with Redis(unix_socket_path=address) as client:
                async with asyncio.timeout(3):
                    ready = False
                    while not ready:
                        try:
                            await client.ping()
                            ready = True
                        except RedisConnectionError:
                            await asyncio.sleep(0.01)
                yield client
        finally:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)


def limited_tools(limit: int = 1) -> RunLayerSpec:
    return RunLayerSpec(
        name="core_tools",
        config={
            "tools": [
                {
                    "provider_type": "builtin",
                    "provider_id": "search",
                    "tool_name": "search",
                    "max_calls_per_run": limit,
                    "parameters_json_schema": {
                        "type": "object",
                        "properties": {"query": {"type": "string"}},
                        "required": ["query"],
                    },
                }
            ],
        },
    )


def native_model(*, fail_after_tool: bool = False, calls: int = 2) -> FunctionModel:
    turns = 0

    async def stream(messages, info):
        nonlocal turns
        turns += 1
        if turns == 1:
            yield {
                i: DeltaToolCall(name="search", json_args='{"query":"example"}', tool_call_id=f"call-{i}")
                for i in range(calls)
            }
        elif fail_after_tool:
            raise RuntimeError("model stopped after tool dispatch")
        else:
            yield "done"

    return FunctionModel(stream_function=stream)


@pytest.mark.anyio
@pytest.mark.parametrize("outcome", ["succeeded", "failed", "timeout"])
async def test_native_terminal_snapshot_charges_dispatch_without_live_redis_quota(monkeypatch, outcome):
    dispatched = []

    async def transport(incoming):
        dispatched.append(incoming)
        if outcome == "timeout":
            await asyncio.Event().wait()
        return httpx.Response(200, json={"observation": "result", "messages": [], "metadata": {}})

    monkeypatch.setattr(
        llm_layer.Capability, "build_model", lambda self, deps: native_model(fail_after_tool=outcome == "failed")
    )
    async with FakeRedis() as redis, httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        store = RedisRunStore(redis)
        record = await store.create_run()
        runner = AgentRunRunner(
            sink=store,
            request=request(limited_tools()),
            run_id=record.run_id,
            services=Services(client, client),
            run_timeout_seconds=0.02 if outcome == "timeout" else 5,
        )
        if outcome == "succeeded":
            await runner.run()
        else:
            with pytest.raises(UsageLimitExceeded if outcome == "timeout" else RuntimeError):
                await runner.run()
        events = (await store.get_events(record.run_id)).events
        terminal = events[-1]
        assert isinstance(terminal, RunSucceededEvent if outcome == "succeeded" else RunFailedEvent)
        assert len(dispatched) == 1
        assert len(terminal.tool_call_limits) == 1
        summary = next(iter(terminal.tool_call_limits.values()))
        assert summary.used == summary.limit == 1
        assert len(summary.call_ids) == 1
        assert terminal.tool_call_limits == runner.terminal_tool_call_limits
        raw_record = await redis.get(run_record_key(store.prefix, record.run_id))
        assert raw_record is not None and b"tool_call_limits" not in raw_record
        assert len(await redis.keys("*")) == 2  # normal run record and event stream
        if outcome == "timeout":
            missing = unconfirmed_reservation("call-0", terminal.tool_call_limits) or unconfirmed_reservation(
                "call-1", terminal.tool_call_limits
            )
            assert missing is not None and missing.used == 1 and missing.execution_status == "unconfirmed"
        before = terminal.model_dump_json()
        runner.terminal_tool_call_limits.clear()
        assert terminal.model_dump_json() == before


@pytest.mark.anyio
async def test_new_native_runs_with_shared_services_and_restored_history_have_fresh_counters(monkeypatch):
    dispatched = []

    def transport(incoming):
        dispatched.append(incoming)
        return httpx.Response(200, json={"observation": "result", "messages": [], "metadata": {}})

    monkeypatch.setattr(llm_layer.Capability, "build_model", lambda self, deps: native_model())
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        services = Services(client, client)
        snapshot = None
        for run_id in ("first", "second"):
            sink = InMemoryRunEventSink()
            runner = AgentRunRunner(
                sink=sink, request=request(limited_tools(), snapshot=snapshot), run_id=run_id, services=services
            )
            await runner.run()
            snapshot = runner.terminal_session_snapshot
            assert snapshot is not None
            terminal = sink.events[run_id][-1]
            assert isinstance(terminal, RunSucceededEvent)
            assert next(iter(terminal.tool_call_limits.values())).used == 1
            assert "tool_call_limits" not in snapshot.model_dump_json()
        assert len(dispatched) == 2


@pytest.mark.anyio
@pytest.mark.parametrize("stop", ["cancel", "shutdown", "observer_failure", "timeout"])
async def test_owner_closes_admission_before_cancel_cleanup_and_persists_unconfirmed_attempt(
    monkeypatch, stop, cancellation_redis
):
    dispatched = asyncio.Event()
    cleanup_started = asyncio.Event()
    finish_cleanup = asyncio.Event()
    deps_by_run: dict[str, Deps] = {}
    cleanup_denied = []

    def build_model(self, deps):
        deps_by_run[deps.run_id] = deps
        return native_model(calls=1)

    async def transport(incoming):
        dispatched.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            deps = next(iter(deps_by_run.values()))
            with pytest.raises(ToolCallLimitRunUnavailable):
                await deps.tool_call_limit_store.reserve(
                    run_id=deps.run_id, tool_identity="cleanup", tool_call_id="late", limit=3
                )
            cleanup_denied.append(True)
            cleanup_started.set()
            await finish_cleanup.wait()
            # Simulate a provider result arriving during cancellation cleanup.
            return httpx.Response(200, json={"observation": "late result", "messages": [], "metadata": {}})

    monkeypatch.setattr(llm_layer.Capability, "build_model", build_model)
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        redis = cancellation_redis
        store = RedisRunStore(redis)
        scheduler = RunScheduler(
            store=store,
            services=Services(client, client),
            shutdown_grace_seconds=0,
            run_timeout_seconds=0.03 if stop == "timeout" else 5,
        )
        incoming = request(limited_tools(3)).model_copy(update={"idempotency_key": "same-request"})
        record = await scheduler.create_run(incoming)
        supervisor = scheduler.active_tasks[record.run_id]
        await asyncio.wait_for(dispatched.wait(), 2)
        replay = await scheduler.create_run(incoming)
        assert replay.run_id == record.run_id and len(deps_by_run) == 1
        if stop == "observer_failure":
            async with asyncio.timeout(2):
                observers = []
                while not observers:
                    observers = [entry for entry in await redis.client_list() if entry["cmd"] == "xread"]
                    if not observers:
                        await asyncio.sleep(0.01)
            assert await redis.client_unblock(int(observers[0]["id"]), error=True)
            shutdown = None
        elif stop == "timeout":
            shutdown = None
        elif stop == "cancel":
            await scheduler.cancel_run(record.run_id, CancelRunRequest(reason="user_stop"))
            shutdown = None
        else:
            shutdown = asyncio.create_task(scheduler.shutdown())
        await asyncio.wait_for(cleanup_started.wait(), 2)
        assert (await store.get_run(record.run_id)).status == "running"
        finish_cleanup.set()
        await asyncio.wait_for(asyncio.gather(supervisor, return_exceptions=True), 2)
        if shutdown is not None:
            await asyncio.wait_for(shutdown, 2)
        events = (await store.get_events(record.run_id)).events
        terminal = events[-1]
        assert isinstance(terminal, RunCancelledEvent if stop == "cancel" else RunFailedEvent)
        assert cleanup_denied == [True]
        assert (
            len(
                [event for event in events if isinstance(event, (RunSucceededEvent, RunFailedEvent, RunCancelledEvent))]
            )
            == 1
        )
        summary = next(iter(terminal.tool_call_limits.values()))
        assert summary.used == 1 and summary.limit == 3
        assert summary.call_ids == {hashlib.sha256(b"call-0").hexdigest(): 1}
        assert not any(
            isinstance(event, PydanticAIStreamRunEvent) and event.data.event_kind == "function_tool_result"
            for event in events
        )
        assert not scheduler.active_tasks
        replay = await scheduler.create_run(incoming) if stop != "shutdown" else await store.get_run(record.run_id)
        assert replay.run_id == record.run_id and len(deps_by_run) == 1
        raw_record = await redis.get(run_record_key(store.prefix, record.run_id))
        assert raw_record is not None and b"tool_call_limits" not in raw_record
