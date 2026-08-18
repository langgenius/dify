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
    RunComposition,
    RunFailedEvent,
    RunFailedEventData,
    RunFailureType,
    RunStartedEvent,
    RunSucceededEvent,
    RunSucceededEventData,
    utc_now,
)
from dify_agent.runtime.cancellation import RunCancellationIntent
from dify_agent.runtime.run_scheduler import RunScheduler
from dify_agent.storage.redis_keys import run_cancel_intent_key, run_events_key, run_record_key
from dify_agent.storage.redis_run_store import RedisRunStore


pytestmark = pytest.mark.integration


def _success_or_failure_event(kind: str, run_id: str) -> RunSucceededEvent | RunFailedEvent:
    if kind == "succeeded":
        return RunSucceededEvent(
            run_id=run_id,
            data=RunSucceededEventData(
                output="done",
                session_snapshot=CompositorSessionSnapshot(layers=[]),
            ),
        )
    return RunFailedEvent(run_id=run_id, data=RunFailedEventData(error="model failed"))


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


def test_success_and_cancel_intent_commit_exactly_one_matching_terminal(redis_url: str) -> None:
    async def scenario() -> None:
        first_client = Redis.from_url(redis_url)
        second_client = Redis.from_url(redis_url)
        prefix = f"terminal-finalization-{uuid4().hex}"
        retention_seconds = 60
        first_store = RedisRunStore(first_client, prefix=prefix, run_retention_seconds=retention_seconds)
        second_store = RedisRunStore(second_client, prefix=prefix, run_retention_seconds=retention_seconds)
        try:
            record = await first_store.create_run()
            success_event = RunSucceededEvent(
                run_id=record.run_id,
                data=RunSucceededEventData(
                    output="done",
                    session_snapshot=CompositorSessionSnapshot(layers=[]),
                ),
            )

            success_result, cancellation_status = await asyncio.gather(
                first_store.finalize_run(success_event),
                second_store.request_cancellation(
                    record.run_id,
                    CancelRunRequest(reason="concurrent_cancel", message="cancel accepted"),
                ),
            )

            if success_result.applied:
                assert cancellation_status == "succeeded"
                winner_result = success_result
                expected_status = "succeeded"
                expected_event_type = "run_succeeded"
            else:
                assert success_result.status == "running"
                assert cancellation_status == "running"
                intent = await first_store.get_cancellation_intent(record.run_id)
                assert intent is not None
                winner_result = await first_store.finalize_cancellation(record.run_id, intent)
                assert winner_result.applied is True
                expected_status = "cancelled"
                expected_event_type = "run_cancelled"

            persisted = await first_store.get_run(record.run_id)
            page = await second_store.get_events(record.run_id)
            assert persisted.status == expected_status
            assert len(page.events) == 1
            assert page.events[0].type == expected_event_type
            assert page.events[0].id == winner_result.event_id

            record_ttl = await first_client.ttl(run_record_key(prefix, record.run_id))
            events_ttl = await second_client.ttl(run_events_key(prefix, record.run_id))
            assert 0 < record_ttl <= retention_seconds
            assert 0 < events_ttl <= retention_seconds
        finally:
            await first_client.aclose()
            await second_client.aclose()

    asyncio.run(scenario())


@pytest.mark.parametrize("terminal_status", ["succeeded", "failed"])
def test_terminal_first_rejects_late_cancellation(redis_url: str, terminal_status: str) -> None:
    async def scenario() -> None:
        client = Redis.from_url(redis_url)
        prefix = f"terminal-first-{terminal_status}-{uuid4().hex}"
        store = RedisRunStore(client, prefix=prefix, run_retention_seconds=60)
        try:
            record = await store.create_run()
            result = await store.finalize_run(_success_or_failure_event(terminal_status, record.run_id))

            cancellation_status = await store.request_cancellation(
                record.run_id,
                CancelRunRequest(reason="late_cancel"),
            )

            assert result.applied is True
            assert cancellation_status == terminal_status
            assert await store.get_cancellation_intent(record.run_id) is None
            events = await store.get_events(record.run_id)
            assert [event.type for event in events.events] == [f"run_{terminal_status}"]
        finally:
            await client.aclose()

    asyncio.run(scenario())


def test_cancellation_intent_lifecycle_and_terminal_exclusion(redis_url: str) -> None:
    async def scenario() -> None:
        client = Redis.from_url(redis_url)
        prefix = f"cancel-intent-lifecycle-{uuid4().hex}"
        retention_seconds = 60
        store = RedisRunStore(client, prefix=prefix, run_retention_seconds=retention_seconds)
        try:
            record = await store.create_run()
            _ = await store.append_event(RunStartedEvent(run_id=record.run_id))
            record_key = run_record_key(prefix, record.run_id)
            events_key = run_events_key(prefix, record.run_id)
            intent_key = run_cancel_intent_key(prefix, record.run_id)
            _ = await client.expire(record_key, 1)
            _ = await client.expire(events_key, 1)

            first_status = await store.request_cancellation(
                record.run_id,
                CancelRunRequest(reason="first", message="first message"),
            )
            duplicate_status = await store.request_cancellation(
                record.run_id,
                CancelRunRequest(reason="second", message="second message"),
            )
            intent = await store.get_cancellation_intent(record.run_id)

            assert first_status == duplicate_status == "running"
            assert intent is not None
            assert (intent.reason, intent.message) == ("first", "first message")
            for key in (record_key, events_key, intent_key):
                assert 0 < await client.ttl(key) <= retention_seconds

            success = await store.finalize_run(_success_or_failure_event("succeeded", record.run_id))
            failure = await store.finalize_run(_success_or_failure_event("failed", record.run_id))
            assert (success.applied, success.status) == (False, "running")
            assert (failure.applied, failure.status) == (False, "running")
            assert [event.type for event in (await store.get_events(record.run_id)).events] == ["run_started"]

            first_finalization = await store.finalize_cancellation(
                record.run_id,
                intent,
                session_snapshot=CompositorSessionSnapshot(layers=[]),
            )
            repeated_finalization = await store.finalize_cancellation(record.run_id, intent)
            post_terminal_status = await store.request_cancellation(
                record.run_id,
                CancelRunRequest(reason="after_finalization"),
            )
            events = await store.get_events(record.run_id)

            assert first_finalization.applied is True
            assert repeated_finalization.applied is False
            assert repeated_finalization.status == "cancelled"
            assert post_terminal_status == "cancelled"
            assert [event.type for event in events.events].count("run_cancelled") == 1
            assert await client.exists(intent_key) == 0
            for key in (record_key, events_key):
                assert 0 < await client.ttl(key) <= retention_seconds
        finally:
            await client.aclose()

    asyncio.run(scenario())


def test_cancellation_finalization_without_intent_is_unapplied(redis_url: str) -> None:
    async def scenario() -> None:
        client = Redis.from_url(redis_url)
        store = RedisRunStore(client, prefix=f"cancel-without-intent-{uuid4().hex}", run_retention_seconds=60)
        try:
            record = await store.create_run()
            result = await store.finalize_cancellation(
                record.run_id,
                RunCancellationIntent(reason="not-accepted", requested_at=utc_now()),
            )

            assert result.applied is False
            assert result.status == "running"
            assert (await store.get_events(record.run_id)).events == []
            assert (await store.get_run(record.run_id)).status == "running"
        finally:
            await client.aclose()

    asyncio.run(scenario())


def test_classified_failure_persists_matching_record_and_event_error_type(redis_url: str) -> None:
    async def scenario() -> None:
        client = Redis.from_url(redis_url)
        store = RedisRunStore(client, prefix=f"classified-failure-{uuid4().hex}", run_retention_seconds=60)
        try:
            record = await store.create_run()
            event = RunFailedEvent(
                run_id=record.run_id,
                data=RunFailedEventData(
                    error="run limit reached",
                    error_type=RunFailureType.AGENT_RUN_LIMIT_EXCEEDED,
                ),
            )

            result = await store.finalize_run(event)
            persisted = await store.get_run(record.run_id)
            page = await store.get_events(record.run_id)

            assert result.applied is True
            assert persisted.error_type is RunFailureType.AGENT_RUN_LIMIT_EXCEEDED
            assert len(page.events) == 1
            persisted_event = page.events[0]
            assert isinstance(persisted_event, RunFailedEvent)
            assert persisted_event.data.error_type is RunFailureType.AGENT_RUN_LIMIT_EXCEEDED
        finally:
            await client.aclose()

    asyncio.run(scenario())


def test_non_owner_scheduler_cancellation_stops_owner_runner(redis_url: str) -> None:
    class BlockingRunner:
        def __init__(self, *, started: asyncio.Event, stopped: asyncio.Event) -> None:
            self.started = started
            self.stopped = stopped

        @property
        def terminal_session_snapshot(self) -> None:
            return None

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
