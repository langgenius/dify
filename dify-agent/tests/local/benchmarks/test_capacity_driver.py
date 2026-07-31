import asyncio
from dataclasses import replace
from typing import cast
from unittest.mock import AsyncMock

import httpx
import pytest

from benchmarks.capacity_driver import (
    CapacityDriverSettings,
    _active_window_seconds_from_events,
    _active_windows_from_events,
    _fetch_e2b_pause_events,
    _invalid_reasons,
    _managed_binding_pool,
    build_capacity_run_request,
    summarize_outcomes,
    validate_ledger,
)
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


def test_binding_pool_cleans_every_successful_allocation_after_partial_failure() -> None:
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
                ):
                    raise AssertionError("partial allocation unexpectedly succeeded")
            except RuntimeError:
                pass

    asyncio.run(exercise())

    assert sorted(destroyed) == ["binding-1", "binding-3"]


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
        minimum_successful_runs=100,
        maximum_duration_seconds=180,
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
