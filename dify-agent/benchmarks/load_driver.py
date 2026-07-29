"""Async black-box driver for one clean Docker Compose benchmark block.

Only create-run and SSE consumption occur inside the resource measurement
window. Redis introspection, event replay, and fake-ledger validation run after
the window so correctness checks do not inflate the runtime metrics being
compared.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
import json
import os
from pathlib import Path
import time
from typing import cast
from uuid import uuid4

import httpx
from redis.asyncio import Redis

from benchmarks.comparison import quantile
from benchmarks.scenario import BenchmarkScenario, load_scenario_manifest
from benchmarks.schemas import (
    BlockResult,
    FailureKind,
    FakeDependencyLedger,
    RedisSnapshot,
    RunOutcomeSummary,
    RunSample,
    TargetKind,
    TerminalStatus,
)


_TERMINAL_EVENT_TYPES = {"run_succeeded", "run_failed", "run_cancelled"}
_INTROSPECTION_COMMANDS = {"flushdb", "info", "memory", "ping", "scan"}


@dataclass(slots=True, frozen=True)
class DriverSettings:
    """Environment-backed settings supplied by the Compose orchestrator."""

    agent_url: str
    fake_deps_url: str
    redis_url: str
    redis_prefix: str
    results_dir: Path
    target: TargetKind
    target_id: str
    scenario_id: str
    block_id: str
    pair_index: int
    warmup_runs: int | None
    trial_runs: int | None
    warmup_seconds: float | None
    duration_seconds: float | None

    @classmethod
    def from_environment(cls) -> "DriverSettings":
        """Parse the explicit benchmark environment without reading Dify secrets."""
        target = os.environ.get("BENCH_TARGET", "candidate")
        if target not in {"baseline", "candidate"}:
            raise ValueError("BENCH_TARGET must be baseline or candidate")
        return cls(
            agent_url=os.environ.get("BENCH_AGENT_URL", "http://agent:5050").rstrip("/"),
            fake_deps_url=os.environ.get("BENCH_FAKE_DEPS_URL", "http://fake-deps:5002").rstrip("/"),
            redis_url=os.environ.get("BENCH_REDIS_URL", "redis://redis:6379/0"),
            redis_prefix=os.environ.get("DIFY_AGENT_REDIS_PREFIX", "dify-agent-bench"),
            results_dir=Path(os.environ.get("BENCH_RESULTS_DIR", "/results")),
            target=cast(TargetKind, target),
            target_id=_required_environment("BENCH_TARGET_ID"),
            scenario_id=_required_environment("BENCH_SCENARIO_ID"),
            block_id=_required_environment("BENCH_BLOCK_ID"),
            pair_index=int(_required_environment("BENCH_PAIR_INDEX")),
            warmup_runs=_optional_int_environment("BENCH_WARMUP_RUNS"),
            trial_runs=_optional_int_environment("BENCH_TRIAL_RUNS"),
            warmup_seconds=_optional_float_environment("BENCH_WARMUP_SECONDS"),
            duration_seconds=_optional_float_environment("BENCH_DURATION_SECONDS"),
        )


@dataclass(slots=True)
class RunObservation:
    """One measured sample plus SSE ids needed for post-window replay validation."""

    sample: RunSample
    sse_event_ids: list[str]


@dataclass(slots=True)
class ActiveRunTracker:
    """Track admitted runs that have not reached a client-observed terminal state."""

    active_runs: int = 0
    max_active_runs: int = 0

    def admitted(self) -> None:
        self.active_runs += 1
        self.max_active_runs = max(self.max_active_runs, self.active_runs)

    def finished(self) -> None:
        self.active_runs -= 1


async def run_block(settings: DriverSettings) -> BlockResult:
    """Execute warmup, measurement, and post-window correctness validation."""
    scenario = load_scenario_manifest().get(settings.scenario_id)
    scenario = _apply_scenario_overrides(scenario, settings)
    settings.results_dir.mkdir(parents=True, exist_ok=True)

    timeout = httpx.Timeout(connect=10, read=120, write=30, pool=10)
    limits = httpx.Limits(max_connections=max(20, scenario.concurrency * 4), max_keepalive_connections=20)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    async with (
        httpx.AsyncClient(base_url=settings.agent_url, timeout=timeout, limits=limits) as agent_client,
        httpx.AsyncClient(base_url=settings.fake_deps_url, timeout=timeout, limits=limits) as fake_client,
    ):
        await _reset_dependencies(redis, fake_client)
        await _run_warmup(
            scenario=scenario,
            settings=settings,
            agent_client=agent_client,
        )
        await _reset_dependencies(redis, fake_client)
        redis_before = await capture_redis_snapshot(redis)

        measurement_started_at_ns = time.time_ns()
        started_perf_ns = time.perf_counter_ns()
        observations, max_active_runs = await _run_measurement(
            scenario=scenario,
            settings=settings,
            agent_client=agent_client,
        )
        elapsed_seconds = (time.perf_counter_ns() - started_perf_ns) / 1_000_000_000
        measurement_ended_at_ns = time.time_ns()
        redis_after = await capture_redis_snapshot(redis)

        await _validate_observations(
            observations=observations,
            scenario=scenario,
            agent_client=agent_client,
            fake_client=fake_client,
        )
        redis_after.storage_bytes = await calculate_storage_bytes(redis, prefix=settings.redis_prefix)
        await redis.aclose()

    samples = [observation.sample for observation in observations]
    outcomes = summarize_run_outcomes(
        samples=samples,
        elapsed_seconds=elapsed_seconds,
        max_active_runs=max_active_runs,
    )
    invalid_reasons = _block_invalid_reasons(
        samples=samples,
        redis_before=redis_before,
        redis_after=redis_after,
    )
    result = BlockResult(
        target=settings.target,
        target_id=settings.target_id,
        scenario_id=scenario.id,
        scenario_version=scenario.version,
        block_id=settings.block_id,
        pair_index=settings.pair_index,
        measurement_started_at_ns=measurement_started_at_ns,
        measurement_ended_at_ns=measurement_ended_at_ns,
        outcomes=outcomes,
        redis_before=redis_before,
        redis_after=redis_after,
        samples=samples,
        valid=not invalid_reasons,
        invalid_reasons=invalid_reasons,
    )
    if outcomes.successful_runs:
        command_deltas = redis_command_call_deltas(redis_before, redis_after)
        result.resources.redis_command_calls_per_successful_run = {
            name: calls / outcomes.successful_runs
            for name, calls in sorted(command_deltas.items())
        }
        result.resources.redis_commands_per_successful_run = (
            sum(command_deltas.values()) / outcomes.successful_runs
        )
        redis_network_bytes = max(
            0,
            redis_after.total_net_input_bytes - redis_before.total_net_input_bytes,
        ) + max(
            0,
            redis_after.total_net_output_bytes - redis_before.total_net_output_bytes,
        )
        result.resources.redis_network_bytes_per_successful_run = (
            redis_network_bytes / outcomes.successful_runs
        )
        result.resources.redis_storage_bytes_per_successful_run = (
            redis_after.storage_bytes / outcomes.successful_runs
        )
    fake_response_times = [
        elapsed_ms
        for sample in samples
        for elapsed_ms in [*sample.fake_model_start_elapsed_ms, *sample.fake_tool_elapsed_ms]
    ]
    if fake_response_times:
        result.resources.fake_response_p99_ms = quantile(fake_response_times, 0.99)
        expected_response_ms = max(
            scenario.model_delay_ms,
            scenario.tool_delay_ms if scenario.tool_rounds else 0,
        )
        fake_response_limit_ms = max(50, expected_response_ms * 3)
        if result.resources.fake_response_p99_ms > fake_response_limit_ms:
            result.invalid_reasons.append(
                "fake dependency response p99 "
                f"{result.resources.fake_response_p99_ms:.1f} ms exceeded "
                f"the environment limit {fake_response_limit_ms:.1f} ms"
            )
            result.valid = False
    _write_block_artifacts(settings.results_dir, result)
    return result


async def _run_warmup(
    *,
    scenario: BenchmarkScenario,
    settings: DriverSettings,
    agent_client: httpx.AsyncClient,
) -> None:
    if scenario.trial_runs is not None:
        warmup_runs = settings.warmup_runs if settings.warmup_runs is not None else scenario.warmup_runs or 0
        _ = await _run_fixed_count(
            count=warmup_runs,
            scenario=scenario,
            settings=settings,
            agent_client=agent_client,
        )
        return
    warmup_seconds = settings.warmup_seconds
    if warmup_seconds is None:
        warmup_seconds = scenario.warmup_seconds or 0
    _ = await _run_for_duration(
        duration_seconds=warmup_seconds,
        scenario=scenario,
        settings=settings,
        agent_client=agent_client,
    )


async def _run_measurement(
    *,
    scenario: BenchmarkScenario,
    settings: DriverSettings,
    agent_client: httpx.AsyncClient,
) -> tuple[list[RunObservation], int]:
    tracker = ActiveRunTracker()
    if scenario.trial_runs is not None:
        trial_runs = settings.trial_runs if settings.trial_runs is not None else scenario.trial_runs
        observations = await _run_fixed_count(
            count=trial_runs,
            scenario=scenario,
            settings=settings,
            agent_client=agent_client,
            tracker=tracker,
        )
    else:
        duration_seconds = settings.duration_seconds
        if duration_seconds is None:
            duration_seconds = cast(float, scenario.duration_seconds)
        observations = await _run_for_duration(
            duration_seconds=duration_seconds,
            scenario=scenario,
            settings=settings,
            agent_client=agent_client,
            tracker=tracker,
        )
    return observations, tracker.max_active_runs


async def _run_fixed_count(
    *,
    count: int,
    scenario: BenchmarkScenario,
    settings: DriverSettings,
    agent_client: httpx.AsyncClient,
    tracker: ActiveRunTracker | None = None,
) -> list[RunObservation]:
    semaphore = asyncio.Semaphore(scenario.concurrency)

    async def guarded_run(index: int) -> RunObservation:
        async with semaphore:
            return await _run_once(
                sequence=index,
                scenario=scenario,
                settings=settings,
                agent_client=agent_client,
                tracker=tracker,
            )

    return list(await asyncio.gather(*(guarded_run(index) for index in range(count))))


async def _run_for_duration(
    *,
    duration_seconds: float,
    scenario: BenchmarkScenario,
    settings: DriverSettings,
    agent_client: httpx.AsyncClient,
    tracker: ActiveRunTracker | None = None,
) -> list[RunObservation]:
    if duration_seconds <= 0:
        return []
    deadline = time.perf_counter() + duration_seconds
    observations: list[RunObservation] = []
    observation_lock = asyncio.Lock()

    async def worker(worker_index: int) -> None:
        sequence = worker_index
        while time.perf_counter() < deadline:
            observation = await _run_once(
                sequence=sequence,
                scenario=scenario,
                settings=settings,
                agent_client=agent_client,
                tracker=tracker,
            )
            async with observation_lock:
                observations.append(observation)
            sequence += scenario.concurrency

    await asyncio.gather(*(worker(index) for index in range(scenario.concurrency)))
    return observations


async def _run_once(
    *,
    sequence: int,
    scenario: BenchmarkScenario,
    settings: DriverSettings,
    agent_client: httpx.AsyncClient,
    tracker: ActiveRunTracker | None = None,
) -> RunObservation:
    benchmark_run_id = f"{settings.block_id}-{sequence}-{uuid4().hex}"
    started_ns = time.perf_counter_ns()
    sample = RunSample(
        target=settings.target,
        scenario_id=scenario.id,
        block_id=settings.block_id,
        pair_index=settings.pair_index,
        benchmark_run_id=benchmark_run_id,
        terminal_status="not_terminal",
    )
    sse_event_ids: list[str] = []
    try:
        response = await agent_client.post(
            "/runs",
            json=build_create_run_request(scenario=scenario, benchmark_run_id=benchmark_run_id),
        )
        sample.create_run_http_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
        response.raise_for_status()
        response_data = response.json()
        run_id = response_data["run_id"]
        if not isinstance(run_id, str):
            raise TypeError("create-run response did not contain a string run_id")
        sample.run_id = run_id
        sample.admitted = True
        if tracker is not None:
            tracker.admitted()

        first_event_ns: int | None = None
        terminal_type: str | None = None
        async with agent_client.stream("GET", f"/runs/{run_id}/events/sse") as stream_response:
            stream_response.raise_for_status()
            async for event in iter_sse_data(stream_response):
                received_ns = time.perf_counter_ns()
                if first_event_ns is None:
                    first_event_ns = received_ns
                event_id = event.get("id")
                event_type = event.get("type")
                if isinstance(event_id, str):
                    sse_event_ids.append(event_id)
                sample.event_count += 1
                if isinstance(event_type, str) and event_type in _TERMINAL_EVENT_TYPES:
                    terminal_type = event_type
                    break
        if first_event_ns is None or terminal_type is None:
            raise RuntimeError("SSE stream ended without first and terminal events")
        sample.time_to_first_event_ms = (first_event_ns - started_ns) / 1_000_000
        sample.terminal_e2e_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
        sample.runtime_overhead_ms = sample.terminal_e2e_ms - scenario.dependency_budget_ms
        terminal_status: TerminalStatus
        if terminal_type == "run_succeeded":
            terminal_status = "succeeded"
        elif terminal_type == "run_failed":
            terminal_status = "failed"
            sample.failure_kind = "terminal_failed"
        else:
            terminal_status = "cancelled"
            sample.failure_kind = "cancelled"
        sample.terminal_status = terminal_status
    except Exception as exc:
        failure_kind: FailureKind = "stream_error" if sample.admitted else "admission_error"
        sample.failure_kind = failure_kind
        sample.error = f"{type(exc).__name__}: {exc}"
    finally:
        if sample.admitted and tracker is not None:
            tracker.finished()
    return RunObservation(sample=sample, sse_event_ids=sse_event_ids)


async def iter_sse_data(response: httpx.Response) -> AsyncIterator[dict[str, object]]:
    """Yield decoded JSON data fields from the server's single-line SSE frames."""
    async for line in response.aiter_lines():
        if not line.startswith("data: "):
            continue
        payload = json.loads(line.removeprefix("data: "))
        if not isinstance(payload, dict):
            raise TypeError("SSE data payload must be a JSON object")
        yield payload


def build_create_run_request(*, scenario: BenchmarkScenario, benchmark_run_id: str) -> dict[str, object]:
    """Build the stable public DTO shape consumed by baseline and candidate."""
    credentials = {
        "benchmark_run_id": benchmark_run_id,
        "scenario_id": scenario.id,
        "scenario_version": scenario.version,
    }
    layers: list[dict[str, object]] = [
        {
            "name": "prompt",
            "type": "plain.prompt",
            "config": {"prefix": "benchmark system", "user": "benchmark request"},
        },
        {
            "name": "execution_context",
            "type": "dify.execution_context",
            "config": {
                "tenant_id": "benchmark-tenant",
                "user_id": "benchmark-user",
                "user_from": "account",
                "agent_mode": "workflow_run",
                "invoke_from": "service-api",
            },
        },
        {
            "name": "llm",
            "type": "dify.plugin.llm",
            "deps": {"execution_context": "execution_context"},
            "config": {
                "plugin_id": "benchmark/model",
                "model_provider": "benchmark",
                "model": "benchmark-model",
                "credentials": credentials,
            },
        },
    ]
    if scenario.tool_rounds:
        layers.append(
            {
                "name": "tools",
                "type": "dify.plugin.tools",
                "deps": {"execution_context": "execution_context"},
                "config": {
                    "tools": [
                        {
                            "plugin_id": "benchmark/tool",
                            "provider": "benchmark",
                            "tool_name": "benchmark_tool",
                            "credential_type": "api-key",
                            "credentials": credentials,
                            "parameters": [
                                {
                                    "name": "query",
                                    "type": "string",
                                    "form": "llm",
                                    "required": True,
                                    "llm_description": "Deterministic benchmark query",
                                }
                            ],
                            "parameters_json_schema": {
                                "type": "object",
                                "properties": {"query": {"type": "string"}},
                                "required": ["query"],
                                "additionalProperties": False,
                            },
                        }
                    ]
                },
            }
        )
    return {
        "composition": {"schema_version": 1, "layers": layers},
        "metadata": {
            "benchmark_run_id": benchmark_run_id,
            "scenario_id": scenario.id,
            "scenario_version": scenario.version,
        },
    }


async def _validate_observations(
    *,
    observations: list[RunObservation],
    scenario: BenchmarkScenario,
    agent_client: httpx.AsyncClient,
    fake_client: httpx.AsyncClient,
) -> None:
    semaphore = asyncio.Semaphore(max(1, min(scenario.concurrency, 10)))

    async def validate(observation: RunObservation) -> None:
        async with semaphore:
            sample = observation.sample
            if sample.run_id is None:
                return
            try:
                replay_ids = await _read_all_event_ids(agent_client, sample.run_id)
                sample.event_replay_valid = replay_ids == observation.sse_event_ids
                ledger_response = await fake_client.get(f"/__bench/ledgers/{sample.benchmark_run_id}")
                ledger_response.raise_for_status()
                ledger = FakeDependencyLedger.model_validate(ledger_response.json())
                sample.fake_model_start_elapsed_ms = ledger.model_start_elapsed_ms
                sample.fake_tool_elapsed_ms = ledger.tool_elapsed_ms
                sample.ledger_valid = validate_ledger(ledger=ledger, scenario=scenario)
                if not sample.event_replay_valid or not sample.ledger_valid:
                    sample.failure_kind = "validation_error"
            except Exception as exc:
                sample.failure_kind = "validation_error"
                sample.error = f"{type(exc).__name__}: {exc}"

    await asyncio.gather(*(validate(observation) for observation in observations))


async def _read_all_event_ids(agent_client: httpx.AsyncClient, run_id: str) -> list[str]:
    cursor = "0-0"
    event_ids: list[str] = []
    while True:
        response = await agent_client.get(
            f"/runs/{run_id}/events",
            params={"after": cursor, "limit": 500},
        )
        response.raise_for_status()
        payload = response.json()
        events = payload["events"]
        if not isinstance(events, list):
            raise TypeError("event replay response must contain a list")
        if not events:
            return event_ids
        for event in events:
            if not isinstance(event, dict) or not isinstance(event.get("id"), str):
                raise TypeError("event replay returned an invalid event id")
            event_ids.append(event["id"])
        next_cursor = payload.get("next_cursor")
        if not isinstance(next_cursor, str) or next_cursor == cursor:
            raise RuntimeError("event replay cursor did not advance")
        cursor = next_cursor


def validate_ledger(*, ledger: FakeDependencyLedger, scenario: BenchmarkScenario) -> bool:
    """Check every deterministic dependency count used to calculate overhead."""
    return (
        ledger.scenario_id == scenario.id
        and ledger.scenario_version == scenario.version
        and ledger.model_calls == scenario.model_rounds
        and len(ledger.model_start_elapsed_ms) == scenario.model_rounds
        and ledger.tool_calls == scenario.tool_rounds
        and ledger.text_chunks == scenario.text_chunks
        and ledger.model_stream_items == scenario.expected_model_stream_items
        and ledger.tool_response_bytes == scenario.tool_rounds * scenario.tool_response_bytes
        and ledger.dependency_budget_ms == scenario.dependency_budget_ms
    )


async def _reset_dependencies(redis: Redis, fake_client: httpx.AsyncClient) -> None:
    await redis.flushdb()
    response = await fake_client.post("/__bench/reset")
    response.raise_for_status()


async def capture_redis_snapshot(redis: Redis) -> RedisSnapshot:
    """Capture counters without including storage introspection in the timed delta."""
    stats = cast(dict[str, object], await redis.info(section="stats"))
    command_stats = cast(dict[str, object], await redis.info(section="commandstats"))
    command_calls: dict[str, int] = {}
    for name, value in command_stats.items():
        if isinstance(value, dict):
            calls = value.get("calls")
            if isinstance(calls, int):
                command_calls[name.removeprefix("cmdstat_")] = calls
    return RedisSnapshot(
        total_net_input_bytes=_counter_value(stats.get("total_net_input_bytes")),
        total_net_output_bytes=_counter_value(stats.get("total_net_output_bytes")),
        evicted_keys=_counter_value(stats.get("evicted_keys")),
        rejected_connections=_counter_value(stats.get("rejected_connections")),
        command_calls=command_calls,
    )


async def calculate_storage_bytes(redis: Redis, *, prefix: str) -> int:
    """Sum memory used by benchmark-owned record and event keys."""
    storage_bytes = 0
    async for key in redis.scan_iter(match=f"{prefix}:*"):
        usage = await redis.memory_usage(key)
        if isinstance(usage, int):
            storage_bytes += usage
    return storage_bytes


def redis_command_call_deltas(before: RedisSnapshot, after: RedisSnapshot) -> dict[str, int]:
    """Return per-command workload deltas excluding harness introspection."""
    command_names = set(before.command_calls) | set(after.command_calls)
    return {
        name: max(0, after.command_calls.get(name, 0) - before.command_calls.get(name, 0))
        for name in command_names
        if name not in _INTROSPECTION_COMMANDS
        and after.command_calls.get(name, 0) - before.command_calls.get(name, 0) > 0
    }


def summarize_run_outcomes(
    *,
    samples: list[RunSample],
    elapsed_seconds: float,
    max_active_runs: int,
) -> RunOutcomeSummary:
    """Derive lifecycle counts without treating admission or success as terminal."""
    attempted_runs = len(samples)
    admitted_runs = sum(sample.admitted for sample in samples)
    terminal_runs = sum(
        sample.terminal_status in {"succeeded", "failed", "cancelled"}
        for sample in samples
    )
    successful_runs = sum(sample.terminal_status == "succeeded" for sample in samples)
    successful_event_count = sum(
        sample.event_count
        for sample in samples
        if sample.terminal_status == "succeeded"
    )
    return RunOutcomeSummary(
        attempted_runs=attempted_runs,
        admitted_runs=admitted_runs,
        terminal_runs=terminal_runs,
        successful_runs=successful_runs,
        admission_rate=admitted_runs / attempted_runs if attempted_runs else 0,
        terminal_rate=terminal_runs / admitted_runs if admitted_runs else 0,
        success_rate=successful_runs / terminal_runs if terminal_runs else 0,
        terminal_runs_per_second=terminal_runs / elapsed_seconds if elapsed_seconds else 0,
        successful_runs_per_second=successful_runs / elapsed_seconds if elapsed_seconds else 0,
        events_per_successful_run=successful_event_count / successful_runs if successful_runs else 0,
        max_active_runs=max_active_runs,
    )


def _block_invalid_reasons(
    *,
    samples: list[RunSample],
    redis_before: RedisSnapshot,
    redis_after: RedisSnapshot,
) -> list[str]:
    reasons: list[str] = []
    if not samples:
        reasons.append("measurement produced no runs")
    if any(sample.terminal_status != "succeeded" for sample in samples):
        reasons.append("one or more runs did not succeed")
    if any(not sample.ledger_valid for sample in samples):
        reasons.append("one or more fake dependency ledgers were invalid")
    if any(not sample.event_replay_valid for sample in samples):
        reasons.append("one or more SSE event sequences differed from Redis replay")
    if redis_after.evicted_keys > redis_before.evicted_keys:
        reasons.append("Redis evicted benchmark keys")
    if redis_after.rejected_connections > redis_before.rejected_connections:
        reasons.append("Redis rejected benchmark connections")
    return reasons


def _apply_scenario_overrides(
    scenario: BenchmarkScenario,
    settings: DriverSettings,
) -> BenchmarkScenario:
    updates: dict[str, int | float | None] = {}
    fixed_override = settings.trial_runs is not None or settings.warmup_runs is not None
    timed_override = settings.duration_seconds is not None or settings.warmup_seconds is not None
    if fixed_override and timed_override:
        raise ValueError("benchmark overrides cannot mix fixed-run and timed execution")
    if settings.trial_runs is not None:
        updates["trial_runs"] = settings.trial_runs
        updates["duration_seconds"] = None
    if settings.duration_seconds is not None:
        updates["duration_seconds"] = settings.duration_seconds
        updates["trial_runs"] = None
    if settings.warmup_runs is not None:
        updates["warmup_runs"] = settings.warmup_runs
        updates["warmup_seconds"] = None
    if settings.warmup_seconds is not None:
        updates["warmup_seconds"] = settings.warmup_seconds
        updates["warmup_runs"] = None
    return BenchmarkScenario.model_validate(scenario.model_dump() | updates)


def _write_block_artifacts(results_dir: Path, result: BlockResult) -> None:
    (results_dir / "block-result.json").write_text(result.model_dump_json(indent=2))
    with (results_dir / "samples.jsonl").open("w") as samples_file:
        for sample in result.samples:
            samples_file.write(sample.model_dump_json())
            samples_file.write("\n")
    (results_dir / "redis-before.json").write_text(result.redis_before.model_dump_json(indent=2))
    (results_dir / "redis-after.json").write_text(result.redis_after.model_dump_json(indent=2))


def _required_environment(name: str) -> str:
    value = os.environ.get(name)
    if value is None or not value:
        raise ValueError(f"{name} is required")
    return value


def _optional_int_environment(name: str) -> int | None:
    value = os.environ.get(name)
    if value is None or value == "":
        return None
    return int(value)


def _optional_float_environment(name: str) -> float | None:
    value = os.environ.get(name)
    if value is None or value == "":
        return None
    return float(value)


def _counter_value(value: object) -> int:
    if isinstance(value, int | float | str):
        return int(value)
    return 0


async def main() -> int:
    """CLI entrypoint used by the load-driver Compose service."""
    result = await run_block(DriverSettings.from_environment())
    return 0 if result.valid else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))


__all__ = [
    "DriverSettings",
    "build_create_run_request",
    "capture_redis_snapshot",
    "iter_sse_data",
    "redis_command_call_deltas",
    "run_block",
    "summarize_run_outcomes",
    "validate_ledger",
]
