import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import replace
import json
from pathlib import Path
from typing import cast
from unittest.mock import AsyncMock

import httpx
import pytest

from benchmarks.capacity_driver import (
    BindingCleanupError,
    CapacityDriverSettings,
    _active_window_seconds_from_events,
    _active_windows_from_events,
    _cancel_and_drain_run,
    _execute_load_phase,
    _fetch_e2b_pause_events,
    _invalid_reasons,
    _load_phase_integrity_errors,
    _managed_binding_pool,
    _record_skipped_load_phase,
    _read_active_run_checkpoint,
    build_capacity_run_request,
    run_block,
    summarize_outcomes,
    validate_ledger,
)
from benchmarks.capacity_protocol import CapacityObservation
from benchmarks.load_phase import CompositeRequestStats, LoadPhaseResult, PhaseKind, WorkerContext
from benchmarks.scenario import load_scenario_manifest
from benchmarks.schemas import FakeDependencyLedger, RedisSnapshot, RunSample


def test_basic_request_has_no_runtime_or_shell_layer() -> None:
    request = build_capacity_run_request(
        scenario=load_scenario_manifest().get("basic"),
        benchmark_run_id="run",
        binding_ref=None,
        session_snapshot=None,
        suspend=False,
    )

    composition = cast(dict[str, object], request["composition"])
    layers = cast(list[dict[str, object]], composition["layers"])
    assert [layer["name"] for layer in layers] == ["prompt", "execution_context", "llm"]


def test_file_request_uses_one_worker_binding() -> None:
    request = build_capacity_run_request(
        scenario=load_scenario_manifest().get("file"),
        benchmark_run_id="run",
        binding_ref="sandbox-1",
        session_snapshot=None,
        suspend=False,
    )

    composition = cast(dict[str, object], request["composition"])
    layers = cast(list[dict[str, object]], composition["layers"])
    runtime = next(layer for layer in layers if layer["name"] == "runtime")
    assert cast(dict[str, object], runtime["config"])["backend_binding_ref"] == "sandbox-1"


def test_binding_pool_cleans_every_successful_allocation_after_partial_failure(tmp_path: Path) -> None:
    created = 0
    destroyed: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal created
        if request.url.path == "/execution-bindings":
            created += 1
            if created == 2:
                return httpx.Response(500)
            return httpx.Response(
                200,
                json={"binding_ref": f"binding-{created}", "workspace_ref": f"workspace-{created}"},
            )
        payload = __import__("json").loads(request.content)
        destroyed.append(payload["binding_ref"])
        return httpx.Response(200, json={})

    async def exercise() -> None:
        async with httpx.AsyncClient(
            base_url="http://agent",
            transport=httpx.MockTransport(handler),
        ) as client:
            try:
                async with _managed_binding_pool(
                    client,
                    block_id="block",
                    binding_pool_size=3,
                    allocation_journal=tmp_path / "allocations.jsonl",
                ):
                    raise AssertionError("partial allocation unexpectedly succeeded")
            except RuntimeError:
                pass

    asyncio.run(exercise())

    assert sorted(destroyed) == ["binding-1", "binding-3"]
    events = [json.loads(line) for line in (tmp_path / "allocations.jsonl").read_text().splitlines()]
    assert [(event["binding_ref"], event["state"]) for event in events] == [
        ("binding-1", "allocated"),
        ("binding-3", "allocated"),
        ("binding-1", "destroyed"),
        ("binding-3", "destroyed"),
    ]


def test_binding_pool_falls_back_to_direct_e2b_kill_when_agent_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fallback = AsyncMock()
    monkeypatch.setattr("benchmarks.capacity_driver._kill_e2b_sandbox", fallback)

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/execution-bindings":
            return httpx.Response(
                200,
                json={"binding_ref": "sandbox-1", "workspace_ref": "workspace-1"},
            )
        raise httpx.ConnectError("agent unavailable", request=request)

    async def exercise() -> None:
        async with httpx.AsyncClient(
            base_url="http://agent",
            transport=httpx.MockTransport(handler),
        ) as client:
            async with _managed_binding_pool(
                client,
                block_id="block",
                binding_pool_size=1,
                fallback_e2b_api_key="secret",
            ):
                pass

    asyncio.run(exercise())

    fallback.assert_awaited_once_with("sandbox-1", api_key="secret")


def test_e2b_key_is_hidden_from_settings_repr() -> None:
    settings = CapacityDriverSettings(
        mode="local-e2b",
        agent_url="http://agent",
        runtime_url="http://runtime",
        fake_deps_url="http://fake",
        redis_url="redis://redis",
        redis_prefix="prefix",
        results_dir=__import__("pathlib").Path("/tmp"),
        scenario_id="shell",
        block_id="block",
        concurrency=1,
        warmup_seconds=15,
        measurement_seconds=60,
        e2b_api_key="top-secret",
    )

    assert "top-secret" not in repr(settings)
    assert "top-secret" not in repr(replace(settings))


def test_active_window_uses_vendor_execution_time() -> None:
    value = _active_window_seconds_from_events(
        [
            {
                "type": "sandbox.lifecycle.paused",
                "timestamp": "2026-01-01T00:00:01Z",
                "event_data": {"execution": {"execution_time": 1250}},
            }
        ],
        started_at_ns=1767225600 * 1_000_000_000,
        ended_at_ns=1767225602 * 1_000_000_000,
    )

    assert value == 1.25


def test_reused_binding_matches_each_pause_event_once() -> None:
    values = _active_windows_from_events(
        [
            {
                "type": "sandbox.lifecycle.paused",
                "timestamp": "2026-01-01T00:00:01Z",
                "event_data": {"execution": {"execution_time": 100}},
            },
            {
                "type": "sandbox.lifecycle.paused",
                "timestamp": "2026-01-01T00:00:02Z",
                "event_data": {"execution": {"execution_time": 200}},
            },
        ],
        windows=[
            (1767225600 * 1_000_000_000, 1767225601 * 1_000_000_000),
            (1767225601 * 1_000_000_000, 1767225602 * 1_000_000_000),
        ],
    )

    assert values == [0.1, 0.2]


def test_e2b_pause_events_use_supported_pagination() -> None:
    offsets: list[int] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        offset = int(request.url.params["offset"])
        offsets.append(offset)
        count = 100 if offset == 0 else 50
        return httpx.Response(200, json=[{"id": offset + index} for index in range(count)])

    async def exercise() -> list[object]:
        async with httpx.AsyncClient(
            base_url="https://api.e2b.app",
            transport=httpx.MockTransport(handler),
        ) as client:
            return await _fetch_e2b_pause_events(
                client,
                "sandbox",
                timeout_seconds=1,
                retry_delay_seconds=0,
            )

    events = asyncio.run(exercise())

    assert len(events) == 150
    assert offsets == [0, 100]


def test_file_ledger_validates_payload_and_stub_calls() -> None:
    scenario = load_scenario_manifest().get("file")
    ledger = FakeDependencyLedger(
        benchmark_run_id="run",
        scenario_id="file",
        scenario_version=1,
        model_calls=2,
        tool_calls=1,
        text_chunks=1,
        model_stream_items=2,
        model_start_elapsed_ms=[10, 10],
        stub_calls={
            "file_upload_request": 1,
            "signed_upload": 1,
            "file_download_request": 2,
            "signed_download": 1,
        },
        stub_elapsed_ms=[1, 1, 1, 1, 1],
        payload_bytes=2 * 16 * 1024 * 1024,
        payload_sha256=["a", "b"],
    )

    assert validate_ledger(ledger=ledger, scenario=scenario)


def test_timeout_is_counted_as_capacity_evidence() -> None:
    sample = RunSample(
        mode="local-runtime",
        scenario_id="shell",
        block_id="block",
        benchmark_run_id="run",
        worker_index=0,
        error="ReadTimeout: timed out",
    )

    outcome = summarize_outcomes(samples=[sample], elapsed_seconds=1, max_active=0)

    assert outcome.timeout_runs == 1


def test_terminal_failure_reason_includes_compact_runtime_error() -> None:
    sample = RunSample(
        mode="local-runtime",
        scenario_id="shell",
        block_id="block",
        benchmark_run_id="run",
        worker_index=0,
        admitted=True,
        terminal_status="failed",
        failure_kind="terminal_failed",
        error="BindingAcquireError:\n tmux socket disappeared",
    )

    reasons = _invalid_reasons(
        samples=[sample],
        redis_before=RedisSnapshot(),
        redis_after=RedisSnapshot(),
        jobs_empty=True,
        require_e2b_active_windows=False,
    )

    assert reasons == [
        "one or more Runs reached an unexpected terminal status: BindingAcquireError: tmux socket disappeared"
    ]


def test_load_phase_timeout_preserves_logs_partial_observations_and_stats(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    class TimedOutProcess:
        returncode: int | None = None
        communicate_calls = 0

        async def communicate(self) -> tuple[bytes, bytes]:
            self.communicate_calls += 1
            if self.communicate_calls == 1:
                raise TimeoutError
            return b"partial stdout\n", b"partial stderr\n"

        def terminate(self) -> None:
            self.returncode = -15

        def kill(self) -> None:
            self.returncode = -9

    process = TimedOutProcess()

    subprocess_kwargs: dict[str, object] = {}

    async def create_subprocess(*_args: object, **kwargs: object) -> TimedOutProcess:
        subprocess_kwargs.update(kwargs)
        (private_dir / "measurement-active-runs.jsonl").write_text(
            '{"run_id":"run-active","state":"admitted"}\n'
        )
        return process

    recover = AsyncMock(return_value=(1, []))
    monkeypatch.setattr("benchmarks.capacity_driver.asyncio.create_subprocess_exec", create_subprocess)
    monkeypatch.setattr("benchmarks.capacity_driver._cancel_and_drain_active_runs", recover)
    settings = CapacityDriverSettings(
        mode="local-runtime",
        agent_url="http://agent",
        runtime_url="http://runtime",
        fake_deps_url="http://fake",
        redis_url="redis://unused",
        redis_prefix="prefix",
        results_dir=tmp_path,
        scenario_id="basic",
        block_id="block",
        concurrency=1,
        warmup_seconds=15,
        measurement_seconds=60,
    )
    private_dir = tmp_path / "private"
    private_dir.mkdir()
    expected = CapacityObservation(
        sample=RunSample(
            mode="local-runtime",
            scenario_id="basic",
            block_id="block",
            benchmark_run_id="run-1",
            worker_index=0,
            admitted=True,
            terminal_status="succeeded",
        ),
        started_at_ns=1,
        ended_at_ns=2,
    )
    (private_dir / "measurement-observations.jsonl").write_text(expected.model_dump_json() + "\n")

    phase, observations = asyncio.run(
        _execute_load_phase(
            settings=settings,
            contexts=[WorkerContext(worker_index=0)],
            phase="measurement",
            private_dir=private_dir,
            duration_seconds=1,
            stats_path=tmp_path / "locust-measurement-stats.json",
        )
    )

    assert phase.timed_out
    assert phase.observation_count == 1
    assert any("subprocess exceeded" in error for error in phase.fatal_errors)
    assert observations == [expected]
    log = (tmp_path / "locust-measurement.log").read_text()
    assert "partial stdout" in log
    assert "partial stderr" in log
    assert "subprocess exceeded" in log
    assert "terminal-drained 1" in log
    assert subprocess_kwargs["cwd"] == Path(__file__).resolve().parents[3]
    recover.assert_awaited_once_with(agent_url="http://agent", run_ids=["run-active"])
    stats = json.loads((tmp_path / "locust-measurement-stats.json").read_text())
    assert stats["incomplete"] is True
    assert stats["phase"] == "measurement"


def test_load_phase_integrity_requires_matching_composite_stats() -> None:
    succeeded = CapacityObservation(
        sample=RunSample(
            mode="local-runtime",
            scenario_id="basic",
            block_id="block",
            benchmark_run_id="success",
            worker_index=0,
            admitted=True,
            terminal_status="succeeded",
        ),
        started_at_ns=1,
        ended_at_ns=2,
    )
    failed = CapacityObservation(
        sample=RunSample(
            mode="local-runtime",
            scenario_id="basic",
            block_id="block",
            benchmark_run_id="failure",
            worker_index=1,
            admitted=True,
            terminal_status="failed",
            failure_kind="terminal_failed",
        ),
        started_at_ns=1,
        ended_at_ns=2,
    )
    missing = LoadPhaseResult(
        phase="measurement",
        started_at_ns=1,
        ended_at_ns=2,
        elapsed_seconds=1,
        drain_seconds=0,
        requested_users=2,
        spawned_users=2,
        observed_max_active=2,
        observation_count=2,
        locust_version="2.44.4",
    )

    assert _load_phase_integrity_errors(
        result=missing,
        observations=[succeeded, failed],
        label="measurement",
        scenario_id="basic",
    ) == ["Locust measurement phase did not report AGENT_RUN/basic stats"]

    corrupt = missing.model_copy(
        update={
            "observation_count": 3,
            "composite_request": CompositeRequestStats(
                request_count=1,
                failure_count=0,
                total_response_time_ms=10,
                min_response_time_ms=10,
                max_response_time_ms=10,
                average_response_time_ms=10,
            ),
        }
    )

    assert _load_phase_integrity_errors(
        result=corrupt,
        observations=[succeeded, failed],
        label="measurement",
        scenario_id="basic",
    ) == [
        "phase reported 3 observations but wrote 2",
        "Locust measurement reported 1 composite requests for 2 observations",
        "Locust measurement reported 0 composite failures for 1 unsuccessful observations",
    ]


def test_interrupted_run_is_cancelled_and_drained_to_terminal() -> None:
    statuses = iter(["running", "cancelled"])
    cancel_calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal cancel_calls
        if request.method == "GET":
            return httpx.Response(200, json={"status": next(statuses)})
        cancel_calls += 1
        return httpx.Response(200, json={"status": "cancelled"})

    async def exercise() -> str | None:
        async with httpx.AsyncClient(
            base_url="http://agent",
            transport=httpx.MockTransport(handler),
        ) as client:
            return await _cancel_and_drain_run(client, "run-1", timeout_seconds=1)

    assert asyncio.run(exercise()) is None
    assert cancel_calls == 1


def test_active_run_checkpoint_is_validated_and_deduplicated(tmp_path: Path) -> None:
    checkpoint = tmp_path / "active-runs.jsonl"
    checkpoint.write_text(
        "\n".join(
            [
                '{"run_id":"run-2","state":"admitted"}',
                '{"run_id":"run-1","state":"admitted"}',
                '{"run_id":"run-2","state":"terminal"}',
                '{"run_id":"run-2","state":"admitted"}',
            ]
        )
        + "\n"
    )

    run_ids, errors = _read_active_run_checkpoint(checkpoint)

    assert run_ids == ["run-1", "run-2"]
    assert errors == []


def test_active_run_checkpoint_preserves_valid_events_before_a_corrupt_line(tmp_path: Path) -> None:
    checkpoint = tmp_path / "active-runs.jsonl"
    checkpoint.write_text('{"run_id":"run-1","state":"admitted"}\n{"run_id":')

    run_ids, errors = _read_active_run_checkpoint(checkpoint)

    assert run_ids == ["run-1"]
    assert len(errors) == 1
    assert "journal line 2" in errors[0]


def test_skipped_measurement_writes_forensic_artifacts(tmp_path: Path) -> None:
    settings = CapacityDriverSettings(
        mode="local-runtime",
        agent_url="http://agent",
        runtime_url="http://runtime",
        fake_deps_url="http://fake",
        redis_url="redis://unused",
        redis_prefix="prefix",
        results_dir=tmp_path,
        scenario_id="basic",
        block_id="block",
        concurrency=10,
        warmup_seconds=15,
        measurement_seconds=60,
    )

    phase = _record_skipped_load_phase(
        settings=settings,
        phase="measurement",
        requested_users=10,
        stats_path=tmp_path / "locust-measurement-stats.json",
        reason="measurement skipped because warmup failed",
    )

    assert phase.requested_users == 10
    assert phase.spawned_users == 0
    assert phase.fatal_errors == ["measurement skipped because warmup failed"]
    assert "warmup failed" in (tmp_path / "locust-measurement.log").read_text()
    stats = json.loads((tmp_path / "locust-measurement-stats.json").read_text())
    assert stats["incomplete"] is True


def test_warmup_engine_failure_still_writes_invalid_block_artifacts(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    class FakeRedis:
        async def aclose(self) -> None:
            return

    class FakeHttpClient:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            return

        async def __aenter__(self) -> "FakeHttpClient":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return

    fake_redis = FakeRedis()

    def redis_from_url(*_args: object, **_kwargs: object) -> FakeRedis:
        return fake_redis

    @asynccontextmanager
    async def managed_pool(*_args: object, **_kwargs: object) -> AsyncIterator[list[tuple[None, None]]]:
        yield []

    async def reset(*_args: object, **_kwargs: object) -> None:
        return

    async def capture(*_args: object, **_kwargs: object) -> RedisSnapshot:
        return RedisSnapshot()

    async def storage(*_args: object, **_kwargs: object) -> int:
        return 0

    async def validate(*_args: object, **_kwargs: object) -> None:
        return

    async def execute(**kwargs: object) -> tuple[LoadPhaseResult, list[CapacityObservation]]:
        phase = cast(PhaseKind, kwargs["phase"])
        assert phase == "warmup"
        phase_result = _record_skipped_load_phase(
            settings=cast(CapacityDriverSettings, kwargs["settings"]),
            phase=phase,
            requested_users=1,
            stats_path=cast(Path, kwargs["stats_path"]),
            reason="synthetic child failure",
        )
        return phase_result, []

    monkeypatch.setattr("benchmarks.capacity_driver.Redis.from_url", redis_from_url)
    monkeypatch.setattr("benchmarks.capacity_driver.httpx.AsyncClient", FakeHttpClient)
    monkeypatch.setattr("benchmarks.capacity_driver._managed_binding_pool", managed_pool)
    monkeypatch.setattr("benchmarks.capacity_driver._reset", reset)
    monkeypatch.setattr("benchmarks.capacity_driver.capture_redis_snapshot", capture)
    monkeypatch.setattr("benchmarks.capacity_driver.calculate_storage_bytes", storage)
    monkeypatch.setattr("benchmarks.capacity_driver._validate_observations", validate)
    monkeypatch.setattr("benchmarks.capacity_driver._execute_load_phase", execute)
    settings = CapacityDriverSettings(
        mode="local-e2b",
        agent_url="http://agent",
        runtime_url="http://runtime",
        fake_deps_url="http://fake",
        redis_url="redis://unused",
        redis_prefix="prefix",
        results_dir=tmp_path,
        scenario_id="basic",
        block_id="block",
        concurrency=1,
        warmup_seconds=15,
        measurement_seconds=60,
        e2b_api_key="secret",
    )

    result = asyncio.run(run_block(settings))

    assert not result.valid
    assert "Locust load engine: warmup: synthetic child failure" in result.invalid_reasons
    assert "Locust load engine: measurement skipped because setup or warmup failed" in result.invalid_reasons
    assert (tmp_path / "block-result.json").exists()
    assert (tmp_path / "samples.jsonl").exists()
    assert (tmp_path / "redis-before.json").exists()
    assert (tmp_path / "redis-after.json").exists()
    load_engine = json.loads((tmp_path / "load-engine.json").read_text())
    assert load_engine["phases"]["warmup"]["fatal_errors"] == ["synthetic child failure"]
    assert load_engine["phases"]["measurement"]["fatal_errors"] == [
        "measurement skipped because setup or warmup failed"
    ]


def test_binding_cleanup_failure_still_writes_invalid_block_artifacts(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    class FakeRedis:
        async def aclose(self) -> None:
            return

    class FakeHttpClient:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            return

        async def __aenter__(self) -> "FakeHttpClient":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return

    @asynccontextmanager
    async def failing_pool(*_args: object, **_kwargs: object) -> AsyncIterator[list[tuple[None, None]]]:
        yield []
        raise BindingCleanupError("synthetic cleanup failure")

    async def reset(*_args: object, **_kwargs: object) -> None:
        return

    async def capture(*_args: object, **_kwargs: object) -> RedisSnapshot:
        return RedisSnapshot()

    async def storage(*_args: object, **_kwargs: object) -> int:
        return 0

    async def validate(*_args: object, **_kwargs: object) -> None:
        return

    async def execute(**kwargs: object) -> tuple[LoadPhaseResult, list[CapacityObservation]]:
        phase = cast(PhaseKind, kwargs["phase"])
        sample = RunSample(
            mode="local-e2b",
            scenario_id="basic",
            block_id="block",
            benchmark_run_id=f"{phase}-run",
            worker_index=0,
            run_id=f"{phase}-run-id",
            admitted=True,
            terminal_status="succeeded",
            ledger_valid=True,
            event_replay_valid=True,
        )
        observation = CapacityObservation(sample=sample, started_at_ns=1, ended_at_ns=2)
        result = LoadPhaseResult(
            phase=phase,
            started_at_ns=1,
            ended_at_ns=2,
            elapsed_seconds=1,
            drain_seconds=0,
            requested_users=1,
            spawned_users=1,
            observed_max_active=1,
            observation_count=1,
            locust_version="2.44.4",
            composite_request=CompositeRequestStats(
                request_count=1,
                failure_count=0,
                total_response_time_ms=1,
                min_response_time_ms=1,
                max_response_time_ms=1,
                average_response_time_ms=1,
            ),
        )
        cast(Path, kwargs["stats_path"]).write_text("{}")
        return result, [observation]

    monkeypatch.setattr("benchmarks.capacity_driver.Redis.from_url", lambda *_args, **_kwargs: FakeRedis())
    monkeypatch.setattr("benchmarks.capacity_driver.httpx.AsyncClient", FakeHttpClient)
    monkeypatch.setattr("benchmarks.capacity_driver._managed_binding_pool", failing_pool)
    monkeypatch.setattr("benchmarks.capacity_driver._reset", reset)
    monkeypatch.setattr("benchmarks.capacity_driver.capture_redis_snapshot", capture)
    monkeypatch.setattr("benchmarks.capacity_driver.calculate_storage_bytes", storage)
    monkeypatch.setattr("benchmarks.capacity_driver._validate_observations", validate)
    monkeypatch.setattr("benchmarks.capacity_driver._execute_load_phase", execute)
    settings = CapacityDriverSettings(
        mode="local-e2b",
        agent_url="http://agent",
        runtime_url="http://runtime",
        fake_deps_url="http://fake",
        redis_url="redis://unused",
        redis_prefix="prefix",
        results_dir=tmp_path,
        scenario_id="basic",
        block_id="block",
        concurrency=1,
        warmup_seconds=15,
        measurement_seconds=60,
        e2b_api_key="secret",
    )

    result = asyncio.run(run_block(settings))

    assert not result.valid
    assert result.cleanup["bindings_destroyed"] is False
    assert any("BindingCleanupError: synthetic cleanup failure" in reason for reason in result.invalid_reasons)
    assert "one or more E2B bindings were not destroyed by the driver" in result.invalid_reasons
    assert (tmp_path / "block-result.json").exists()
    assert (tmp_path / "samples.jsonl").exists()
    assert (tmp_path / "load-engine.json").exists()
    assert (tmp_path / "redis-before.json").exists()
    assert (tmp_path / "redis-after.json").exists()
