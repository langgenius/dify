"""Real-Redis contracts for terminal finalization and cancellation observation."""

import asyncio
from collections.abc import Iterator
import shutil
import socket
import subprocess
import time
from uuid import uuid4

import httpx
import pytest
from redis.asyncio import Redis

from agenton.compositor import CompositorSessionSnapshot
from dify_agent.protocol.schemas import (
    CancelRunRequest,
    CreateRunRequest,
    RunCancelledEvent,
    RunCancelledEventData,
    RunComposition,
    RunSucceededEvent,
    RunSucceededEventData,
)
from dify_agent.runtime.event_sink import TerminalRunEvent, terminal_event_status_and_error
from dify_agent.runtime.run_scheduler import RunScheduler
from dify_agent.storage.redis_keys import run_events_key, run_record_key
from dify_agent.storage.redis_run_store import RedisRunStore


pytestmark = pytest.mark.integration


@pytest.fixture
def redis_url() -> Iterator[str]:
    """Start an isolated Redis when the binary is available locally."""
    redis_server = shutil.which("redis-server")
    if redis_server is None:
        pytest.skip("redis-server is required for run terminal integration tests")

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    process = subprocess.Popen(  # noqa: S603
        [
            redis_server,
            "--bind",
            "127.0.0.1",
            "--port",
            str(port),
            "--save",
            "",
            "--appendonly",
            "no",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )
    try:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if process.poll() is not None:
                pytest.fail(f"redis-server exited during startup with code {process.returncode}")
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                    break
            except OSError:
                time.sleep(0.05)
        else:
            pytest.fail("redis-server did not accept connections within 5 seconds")
        yield f"redis://127.0.0.1:{port}/0"
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def test_two_redis_clients_commit_exactly_one_matching_terminal(redis_url: str) -> None:
    async def scenario() -> None:
        first_client = Redis.from_url(redis_url)
        second_client = Redis.from_url(redis_url)
        prefix = f"terminal-finalization-{uuid4().hex}"
        retention_seconds = 60
        first_store = RedisRunStore(first_client, prefix=prefix, run_retention_seconds=retention_seconds)
        second_store = RedisRunStore(second_client, prefix=prefix, run_retention_seconds=retention_seconds)
        try:
            record = await first_store.create_run()
            terminal_events: tuple[TerminalRunEvent, TerminalRunEvent] = (
                RunSucceededEvent(
                    run_id=record.run_id,
                    data=RunSucceededEventData(
                        output="done",
                        session_snapshot=CompositorSessionSnapshot(layers=[]),
                    ),
                ),
                RunCancelledEvent(
                    run_id=record.run_id,
                    data=RunCancelledEventData(
                        reason="concurrent_cancel",
                        message="cancel accepted",
                    ),
                ),
            )

            results = await asyncio.gather(
                first_store.finalize_run(terminal_events[0]),
                second_store.finalize_run(terminal_events[1]),
            )

            assert sum(result.applied for result in results) == 1
            winner_index = next(index for index, result in enumerate(results) if result.applied)
            winner_event = terminal_events[winner_index]
            winner_result = results[winner_index]
            expected_status, expected_error = terminal_event_status_and_error(winner_event)

            persisted = await first_store.get_run(record.run_id)
            page = await second_store.get_events(record.run_id)
            assert persisted.status == expected_status
            assert persisted.error == expected_error
            assert persisted.updated_at == winner_event.created_at
            assert len(page.events) == 1
            assert page.events[0].type == winner_event.type
            assert page.events[0].created_at == winner_event.created_at
            assert page.events[0].id == winner_result.event_id

            record_ttl = await first_client.ttl(run_record_key(prefix, record.run_id))
            events_ttl = await second_client.ttl(run_events_key(prefix, record.run_id))
            assert 0 < record_ttl <= retention_seconds
            assert 0 < events_ttl <= retention_seconds
        finally:
            await first_client.aclose()
            await second_client.aclose()

    asyncio.run(scenario())


def test_non_owner_scheduler_cancellation_stops_owner_runner(redis_url: str) -> None:
    class BlockingRunner:
        def __init__(self, *, started: asyncio.Event, stopped: asyncio.Event) -> None:
            self.started = started
            self.stopped = stopped

        async def run(self) -> None:
            self.started.set()
            try:
                await asyncio.Event().wait()
            finally:
                self.stopped.set()

    async def scenario() -> None:
        owner_client = Redis.from_url(redis_url)
        remote_client = Redis.from_url(redis_url)
        prefix = f"route-independent-cancellation-{uuid4().hex}"
        owner_store = RedisRunStore(owner_client, prefix=prefix, run_retention_seconds=60)
        remote_store = RedisRunStore(remote_client, prefix=prefix, run_retention_seconds=60)
        runner_started = asyncio.Event()
        runner_stopped = asyncio.Event()
        async with httpx.AsyncClient() as http_client:
            owner_scheduler = RunScheduler(
                store=owner_store,
                plugin_daemon_http_client=http_client,
                dify_api_http_client=http_client,
                runner_factory=lambda _record, _request: BlockingRunner(
                    started=runner_started,
                    stopped=runner_stopped,
                ),
            )
            remote_scheduler = RunScheduler(
                store=remote_store,
                plugin_daemon_http_client=http_client,
                dify_api_http_client=http_client,
            )
            try:
                record = await owner_scheduler.create_run(CreateRunRequest(composition=RunComposition(layers=[])))
                owner_task = owner_scheduler.active_tasks[record.run_id]
                await asyncio.wait_for(runner_started.wait(), timeout=1)

                response = await remote_scheduler.cancel_run(
                    record.run_id,
                    CancelRunRequest(reason="remote_cancel"),
                )

                assert response.status == "cancelled"
                assert remote_scheduler.active_tasks == {}
                await asyncio.wait_for(runner_stopped.wait(), timeout=1)
                await asyncio.wait_for(owner_task, timeout=1)
                persisted = await owner_store.get_run(record.run_id)
                events = await remote_store.get_events(record.run_id)
                assert persisted.status == "cancelled"
                assert [event.type for event in events.events] == ["run_cancelled"]
            finally:
                await owner_scheduler.shutdown()
                await remote_scheduler.shutdown()
                await owner_client.aclose()
                await remote_client.aclose()

    asyncio.run(scenario())
