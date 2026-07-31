"""Unified driver for local Runtime and real E2B capacity points."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import time
from typing import cast
from uuid import uuid4

import httpx
from redis.asyncio import Redis

from benchmarks.scenario import BenchmarkMode, CapacityScenario, load_scenario_manifest
from benchmarks.schemas import (
    BlockResult,
    FailureKind,
    FakeDependencyLedger,
    RedisSnapshot,
    RunOutcomeSummary,
    RunSample,
    TerminalStatus,
)


_TERMINAL_EVENT_TYPES = {"run_succeeded", "run_failed", "run_cancelled"}


@dataclass(slots=True, frozen=True)
class CapacityDriverSettings:
    """One fully resolved scenario/concurrency block."""

    mode: BenchmarkMode
    agent_url: str
    runtime_url: str
    fake_deps_url: str
    redis_url: str
    redis_prefix: str
    results_dir: Path
    scenario_id: str
    block_id: str
    concurrency: int
    warmup_seconds: float
    measurement_seconds: float
    minimum_successful_runs: int
    maximum_duration_seconds: float
    e2b_api_key: str | None = field(default=None, repr=False)

    @classmethod
    def from_environment(cls) -> "CapacityDriverSettings":
        mode = _required_environment("BENCH_MODE")
        if mode not in {"local-runtime", "local-e2b"}:
            raise ValueError("BENCH_MODE must be local-runtime or local-e2b")
        return cls(
            mode=cast(BenchmarkMode, mode),
            agent_url=os.environ.get("BENCH_AGENT_URL", "http://agent:5050").rstrip("/"),
            runtime_url=os.environ.get("BENCH_RUNTIME_URL", "http://runtime:5004").rstrip("/"),
            fake_deps_url=os.environ.get("BENCH_FAKE_DEPS_URL", "http://fake-deps:5002").rstrip("/"),
            redis_url=os.environ.get("BENCH_REDIS_URL", "redis://redis:6379/0"),
            redis_prefix=os.environ.get("DIFY_AGENT_REDIS_PREFIX", "dify-agent-bench"),
            results_dir=Path(os.environ.get("BENCH_RESULTS_DIR", "/results")),
            scenario_id=_required_environment("BENCH_SCENARIO_ID"),
            block_id=_required_environment("BENCH_BLOCK_ID"),
            concurrency=int(_required_environment("BENCH_CONCURRENCY")),
            warmup_seconds=float(_required_environment("BENCH_WARMUP_SECONDS")),
            measurement_seconds=float(_required_environment("BENCH_MEASUREMENT_SECONDS")),
            minimum_successful_runs=int(_required_environment("BENCH_MIN_SUCCESSFUL_RUNS")),
            maximum_duration_seconds=float(_required_environment("BENCH_MAX_DURATION_SECONDS")),
            e2b_api_key=os.environ.get("BENCH_E2B_API_KEY") or None,
        )


@dataclass(slots=True)
class CapacityObservation:
    sample: RunSample
    sse_event_ids: list[str]
    session_snapshot: dict[str, object] | None
    binding_ref: str | None
    started_at_ns: int
    ended_at_ns: int


@dataclass(slots=True)
class ActiveRunTracker:
    active: int = 0
    peak: int = 0

    def admitted(self) -> None:
        self.active += 1
        self.peak = max(self.peak, self.active)

    def finished(self) -> None:
        self.active -= 1


async def run_block(settings: CapacityDriverSettings) -> BlockResult:
    """Run warmup, measurement, validation, and cleanup for one matrix point."""
    if settings.concurrency < 1:
        raise ValueError("BENCH_CONCURRENCY must be positive")
    scenario = load_scenario_manifest().get(settings.scenario_id)
    external_runtime = settings.mode == "local-e2b"
    if external_runtime and not settings.e2b_api_key:
        raise ValueError("BENCH_E2B_API_KEY is required for local-e2b")
    settings.results_dir.mkdir(parents=True, exist_ok=True)
    timeout = httpx.Timeout(connect=10, read=180, write=180, pool=10)
    limits = httpx.Limits(max_connections=max(30, settings.concurrency * 5), max_keepalive_connections=30)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    binding_pool_size = 0 if scenario.workload == "basic" else settings.concurrency
    redis_before = RedisSnapshot()
    redis_after = RedisSnapshot()
    observations: list[CapacityObservation] = []
    jobs_empty = True
    elapsed_seconds = 0.000001
    measurement_started_at_ns = time.time_ns()
    measurement_ended_at_ns = measurement_started_at_ns + 1
    tracker = ActiveRunTracker()
    try:
        async with (
            httpx.AsyncClient(base_url=settings.agent_url, timeout=timeout, limits=limits) as agent_client,
            httpx.AsyncClient(base_url=settings.runtime_url, timeout=timeout, limits=limits) as runtime_client,
            httpx.AsyncClient(base_url=settings.fake_deps_url, timeout=timeout, limits=limits) as fake_client,
            _managed_binding_pool(
                agent_client,
                block_id=settings.block_id,
                binding_pool_size=binding_pool_size,
                creation_retry_attempts=3 if external_runtime else 0,
                fallback_e2b_api_key=settings.e2b_api_key if external_runtime else None,
            ) as allocations,
        ):
            binding_refs = [allocation[0] for allocation in allocations] or [None] * settings.concurrency

            async def prepare_resume(binding_ref: str | None) -> dict[str, object] | None:
                return await _prepare_resume_snapshot(
                    scenario=scenario,
                    settings=settings,
                    agent_client=agent_client,
                    fake_client=fake_client,
                    binding_ref=binding_ref,
                )

            session_snapshots = await _prepare_resume_snapshot_pool(
                scenario=scenario,
                binding_refs=binding_refs,
                prepare=prepare_resume,
                prime_first=not external_runtime,
            )
            await _reset(redis, fake_client)
            warmup = await _run_timed(
                duration_seconds=settings.warmup_seconds,
                maximum_duration_seconds=settings.warmup_seconds,
                minimum_successful_runs=None,
                scenario=scenario,
                settings=settings,
                agent_client=agent_client,
                fake_client=fake_client,
                binding_refs=binding_refs,
                session_snapshots=session_snapshots,
                tracker=None,
            )
            if warmup and not any(item.sample.terminal_status == "succeeded" for item in warmup):
                raise RuntimeError("warmup produced no successful Runs")
            if not external_runtime and not await _delete_all_runtime_jobs(runtime_client):
                raise RuntimeError("failed to clean warmup Runtime jobs")

            await _reset(redis, fake_client)
            redis_before = await capture_redis_snapshot(redis)
            measurement_started_at_ns = time.time_ns()
            started_perf_ns = time.perf_counter_ns()
            observations = await _run_timed(
                duration_seconds=settings.measurement_seconds,
                maximum_duration_seconds=settings.maximum_duration_seconds,
                minimum_successful_runs=settings.minimum_successful_runs,
                scenario=scenario,
                settings=settings,
                agent_client=agent_client,
                fake_client=fake_client,
                binding_refs=binding_refs,
                session_snapshots=session_snapshots,
                tracker=tracker,
            )
            elapsed_seconds = (time.perf_counter_ns() - started_perf_ns) / 1_000_000_000
            measurement_ended_at_ns = time.time_ns()
            if external_runtime and scenario.workload != "basic":
                assert settings.e2b_api_key is not None
                await _attach_e2b_active_windows(observations, api_key=settings.e2b_api_key)
            redis_after = await capture_redis_snapshot(redis)
            await _validate_observations(
                observations=observations,
                scenario=scenario,
                concurrency=settings.concurrency,
                agent_client=agent_client,
                fake_client=fake_client,
            )
            redis_after.storage_bytes = await calculate_storage_bytes(redis, prefix=settings.redis_prefix)
            if not external_runtime:
                runtime_jobs_cleaned = await _delete_all_runtime_jobs(runtime_client)
                jobs_response = await runtime_client.get("/v1/jobs", params={"limit": 200})
                jobs_response.raise_for_status()
                jobs = jobs_response.json().get("jobs")
                jobs_empty = runtime_jobs_cleaned and (jobs is None or (isinstance(jobs, list) and not jobs))
                (settings.results_dir / "runtime-jobs-after.json").write_text(
                    json.dumps(jobs_response.json(), indent=2, sort_keys=True)
                )
            else:
                (settings.results_dir / "runtime-jobs-after.json").write_text(
                    json.dumps({"external_runtime": True}, indent=2, sort_keys=True)
                )
    finally:
        await redis.aclose()

    samples = [observation.sample for observation in observations]
    for sample in samples:
        sample.cleanup_valid = jobs_empty
    outcomes = summarize_outcomes(samples=samples, elapsed_seconds=elapsed_seconds, max_active=tracker.peak)
    invalid_reasons = _invalid_reasons(
        samples=samples,
        redis_before=redis_before,
        redis_after=redis_after,
        jobs_empty=jobs_empty,
        require_e2b_active_windows=external_runtime and scenario.workload != "basic",
    )
    result = BlockResult(
        mode=settings.mode,
        scenario_id=scenario.id,
        scenario_version=scenario.version,
        workload=scenario.workload,
        requested_concurrency=settings.concurrency,
        block_id=settings.block_id,
        measurement_started_at_ns=measurement_started_at_ns,
        measurement_ended_at_ns=measurement_ended_at_ns,
        elapsed_seconds=elapsed_seconds,
        minimum_successful_runs=settings.minimum_successful_runs,
        outcomes=outcomes,
        redis_before=redis_before,
        redis_after=redis_after,
        samples=samples,
        cleanup={"jobs_empty": jobs_empty, "bindings_destroyed": True},
        valid=not invalid_reasons,
        invalid_reasons=invalid_reasons,
    )
    if outcomes.successful_runs:
        command_deltas = redis_command_call_deltas(redis_before, redis_after)
        result.resources.redis_commands_per_run = sum(command_deltas.values()) / outcomes.successful_runs
    _write_artifacts(settings.results_dir, result)
    return result


async def _delete_all_runtime_jobs(runtime_client: httpx.AsyncClient) -> bool:
    try:
        response = await runtime_client.get("/v1/jobs", params={"limit": 10000})
        response.raise_for_status()
        jobs = response.json().get("jobs")
        if jobs is None:
            return True
        if not isinstance(jobs, list):
            return False
        job_ids = [job["job_id"] for job in jobs if isinstance(job, dict) and isinstance(job.get("job_id"), str)]
        for job_id in job_ids:
            delete_response = await runtime_client.delete(f"/v1/jobs/{job_id}", params={"force": "true"})
            delete_response.raise_for_status()
        verification = await runtime_client.get("/v1/jobs", params={"limit": 1})
        verification.raise_for_status()
        remaining = verification.json().get("jobs")
        return remaining is None or remaining == []
    except Exception:
        return False


async def _create_binding(
    agent_client: httpx.AsyncClient,
    block_id: str,
    *,
    retry_attempts: int = 0,
    retry_delay_seconds: float = 0.5,
) -> tuple[str | None, str | None]:
    safe_id = hashlib.sha256(block_id.encode()).hexdigest()[:20]
    for attempt in range(retry_attempts + 1):
        response = await agent_client.post(
            "/execution-bindings",
            json={
                "tenant_id": "benchmark-tenant",
                "agent_id": "benchmark-agent",
                "binding_id": f"binding-{safe_id}",
                "workspace_id": f"workspace-{safe_id}",
            },
        )
        if response.status_code == httpx.codes.NOT_FOUND:
            return None, None
        if (
            response.status_code == httpx.codes.TOO_MANY_REQUESTS or response.status_code >= 500
        ) and attempt < retry_attempts:
            await asyncio.sleep(retry_delay_seconds * (attempt + 1))
            continue
        response.raise_for_status()
        payload = response.json()
        binding_ref = payload.get("binding_ref")
        workspace_ref = payload.get("workspace_ref")
        if not isinstance(binding_ref, str) or not isinstance(workspace_ref, str):
            raise TypeError("binding response did not contain string refs")
        return binding_ref, workspace_ref
    raise AssertionError("binding creation retry loop exhausted")


async def _destroy_binding(
    agent_client: httpx.AsyncClient,
    *,
    binding_ref: str | None,
    workspace_ref: str | None,
) -> None:
    if binding_ref is None and workspace_ref is None:
        return
    if binding_ref is None or workspace_ref is None:
        raise TypeError("binding and workspace refs must both be present")
    response = await agent_client.post(
        "/execution-bindings/destroy",
        json={
            "binding_ref": binding_ref,
            "destroy_workspace": True,
            "workspace_ref": workspace_ref,
        },
    )
    if response.status_code != httpx.codes.NOT_FOUND:
        response.raise_for_status()


@asynccontextmanager
async def _managed_binding_pool(
    agent_client: httpx.AsyncClient,
    *,
    block_id: str,
    binding_pool_size: int,
    creation_retry_attempts: int = 0,
    fallback_e2b_api_key: str | None = None,
) -> AsyncIterator[list[tuple[str | None, str | None]]]:
    """Create one binding per worker and destroy every successful allocation."""
    allocations: list[tuple[str | None, str | None]] = []
    try:
        results = await asyncio.gather(
            *(
                _create_binding(
                    agent_client,
                    f"{block_id}-worker-{worker_index}",
                    retry_attempts=creation_retry_attempts,
                )
                for worker_index in range(binding_pool_size)
            ),
            return_exceptions=True,
        )
        allocations.extend(result for result in results if isinstance(result, tuple))
        errors = [result for result in results if isinstance(result, BaseException)]
        if errors:
            raise RuntimeError(
                f"failed to create {len(errors)} of {binding_pool_size} benchmark bindings"
            ) from errors[0]
        yield allocations
    finally:
        cleanup_results = await asyncio.gather(
            *(
                _destroy_binding_with_fallback(
                    agent_client,
                    binding_ref=binding_ref,
                    workspace_ref=workspace_ref,
                    fallback_e2b_api_key=fallback_e2b_api_key,
                )
                for binding_ref, workspace_ref in allocations
            ),
            return_exceptions=True,
        )
        errors = [result for result in cleanup_results if isinstance(result, BaseException)]
        if errors:
            raise RuntimeError(
                f"failed to destroy {len(errors)} of {len(allocations)} benchmark bindings"
            ) from errors[0]


async def _destroy_binding_with_fallback(
    agent_client: httpx.AsyncClient,
    *,
    binding_ref: str | None,
    workspace_ref: str | None,
    fallback_e2b_api_key: str | None,
) -> None:
    try:
        await _destroy_binding(
            agent_client,
            binding_ref=binding_ref,
            workspace_ref=workspace_ref,
        )
    except Exception:
        if not fallback_e2b_api_key or not binding_ref:
            raise
        await _kill_e2b_sandbox(binding_ref, api_key=fallback_e2b_api_key)


async def _kill_e2b_sandbox(sandbox_id: str, *, api_key: str) -> None:
    from e2b import AsyncSandbox, NotFoundException, SandboxNotFoundException

    try:
        await AsyncSandbox.kill(sandbox_id, api_key=api_key)
    except (NotFoundException, SandboxNotFoundException):
        pass


async def _attach_e2b_active_windows(
    observations: Sequence[CapacityObservation],
    *,
    api_key: str,
) -> None:
    """Attach vendor-reported execution time from matching pause events."""
    by_binding: dict[str, list[CapacityObservation]] = {}
    for observation in observations:
        if observation.binding_ref and observation.sample.terminal_status == "succeeded":
            by_binding.setdefault(observation.binding_ref, []).append(observation)
    timeout = httpx.Timeout(connect=10, read=10, write=10, pool=10)
    semaphore = asyncio.Semaphore(5)
    async with httpx.AsyncClient(
        base_url="https://api.e2b.app",
        headers={"X-API-Key": api_key},
        timeout=timeout,
    ) as client:

        async def attach(binding_ref: str, items: list[CapacityObservation]) -> None:
            deadline = time.monotonic() + 15
            async with semaphore:
                while time.monotonic() < deadline:
                    events = await _fetch_e2b_pause_events(
                        client,
                        binding_ref,
                        timeout_seconds=max(0, deadline - time.monotonic()),
                    )
                    active_windows = _active_windows_from_events(
                        events,
                        windows=[
                            (observation.started_at_ns, observation.ended_at_ns)
                            for observation in items
                        ],
                    )
                    for observation, active_seconds in zip(items, active_windows, strict=True):
                        observation.sample.e2b_active_seconds = active_seconds
                    if all(item.sample.e2b_active_seconds is not None for item in items):
                        return
                    await asyncio.sleep(0.5)

        await asyncio.gather(*(attach(binding_ref, items) for binding_ref, items in by_binding.items()))


async def _fetch_e2b_pause_events(
    client: httpx.AsyncClient,
    binding_ref: str,
    *,
    timeout_seconds: float,
    retry_delay_seconds: float = 0.5,
) -> list[object]:
    deadline = time.monotonic() + timeout_seconds
    events: list[object] = []
    offset = 0
    page_limit = 100
    while True:
        try:
            response = await client.get(
                f"/events/sandboxes/{binding_ref}",
                params={
                    "offset": offset,
                    "limit": page_limit,
                    "orderAsc": "false",
                    "types": "sandbox.lifecycle.paused",
                },
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, list):
                raise TypeError("E2B lifecycle event response was not a list")
            page = cast(list[object], payload)
            events.extend(page)
            if len(page) < page_limit:
                return events
            offset += len(page)
        except httpx.TransportError:
            if time.monotonic() >= deadline:
                return events
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != httpx.codes.TOO_MANY_REQUESTS and exc.response.status_code < 500:
                raise
            if time.monotonic() >= deadline:
                return events
        await asyncio.sleep(retry_delay_seconds)


def _active_window_seconds_from_events(
    events: Sequence[object],
    *,
    started_at_ns: int,
    ended_at_ns: int,
) -> float | None:
    return _active_windows_from_events(events, windows=[(started_at_ns, ended_at_ns)])[0]


def _active_windows_from_events(
    events: Sequence[object],
    *,
    windows: Sequence[tuple[int, int]],
) -> list[float | None]:
    pause_events = _parse_pause_events(events)
    matched: list[float | None] = [None] * len(windows)
    available = set(range(len(pause_events)))
    for window_index, (started_at_ns, ended_at_ns) in sorted(
        enumerate(windows),
        key=lambda item: item[1][1],
    ):
        lower_bound = started_at_ns / 1_000_000_000 - 1
        upper_bound = ended_at_ns / 1_000_000_000 + 10
        candidates = [
            event_index
            for event_index in available
            if lower_bound <= pause_events[event_index][0] <= upper_bound
        ]
        if not candidates:
            continue
        ended_at = ended_at_ns / 1_000_000_000
        selected = min(
            candidates,
            key=lambda event_index: abs(pause_events[event_index][0] - ended_at),
        )
        matched[window_index] = pause_events[selected][1]
        available.remove(selected)
    return matched


def _parse_pause_events(events: Sequence[object]) -> list[tuple[float, float]]:
    parsed: list[tuple[float, float]] = []
    for raw_event in events:
        if not isinstance(raw_event, dict) or raw_event.get("type") != "sandbox.lifecycle.paused":
            continue
        timestamp = raw_event.get("timestamp")
        if not isinstance(timestamp, str):
            continue
        try:
            occurred_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp()
        except ValueError:
            continue
        event_data = raw_event.get("event_data", raw_event.get("eventData"))
        if not isinstance(event_data, dict):
            continue
        execution = event_data.get("execution")
        if not isinstance(execution, dict):
            continue
        execution_time_ms = execution.get("execution_time", execution.get("executionTime"))
        if isinstance(execution_time_ms, (float, int)) and execution_time_ms >= 0:
            parsed.append((occurred_at, float(execution_time_ms) / 1000))
    return sorted(parsed)


async def _prepare_resume_snapshot(
    *,
    scenario: CapacityScenario,
    settings: CapacityDriverSettings,
    agent_client: httpx.AsyncClient,
    fake_client: httpx.AsyncClient,
    binding_ref: str | None,
) -> dict[str, object] | None:
    if scenario.workload != "resume":
        return None
    observation = await _run_once(
        sequence=-1,
        worker_index=0,
        scenario=scenario,
        settings=settings,
        agent_client=agent_client,
        fake_client=fake_client,
        binding_ref=binding_ref,
        session_snapshot=None,
        tracker=None,
        suspend=True,
    )
    if observation.sample.terminal_status != "succeeded" or observation.session_snapshot is None:
        raise RuntimeError(f"failed to build resume snapshot: {observation.sample.error}")
    return observation.session_snapshot


async def _prepare_resume_snapshot_pool(
    *,
    scenario: CapacityScenario,
    binding_refs: Sequence[str | None],
    prepare: Callable[[str | None], Awaitable[dict[str, object] | None]],
    prime_first: bool,
) -> list[dict[str, object] | None]:
    if scenario.workload != "resume":
        return [None for _ in binding_refs]
    if prime_first:
        first = await prepare(binding_refs[0])
        remaining = await asyncio.gather(*(prepare(binding_ref) for binding_ref in binding_refs[1:]))
        return [first, *remaining]
    return list(await asyncio.gather(*(prepare(binding_ref) for binding_ref in binding_refs)))


async def _run_timed(
    *,
    duration_seconds: float,
    maximum_duration_seconds: float,
    minimum_successful_runs: int | None,
    scenario: CapacityScenario,
    settings: CapacityDriverSettings,
    agent_client: httpx.AsyncClient,
    fake_client: httpx.AsyncClient,
    binding_refs: Sequence[str | None],
    session_snapshots: Sequence[dict[str, object] | None],
    tracker: ActiveRunTracker | None,
) -> list[CapacityObservation]:
    started = time.perf_counter()
    minimum_deadline = started + duration_seconds
    maximum_deadline = started + maximum_duration_seconds
    observations: list[CapacityObservation] = []
    lock = asyncio.Lock()

    async def worker(worker_index: int) -> None:
        await asyncio.sleep(worker_index * 0.005)
        sequence = worker_index
        binding_ref, session_snapshot = _worker_context(
            worker_index,
            binding_refs=binding_refs,
            session_snapshots=session_snapshots,
        )
        while True:
            now = time.perf_counter()
            async with lock:
                successful = sum(
                    observation.sample.terminal_status == "succeeded" for observation in observations
                )
            minimum_met = minimum_successful_runs is None or successful >= minimum_successful_runs
            if (now >= minimum_deadline and minimum_met) or now >= maximum_deadline:
                return
            observation = await _run_once(
                sequence=sequence,
                worker_index=worker_index,
                scenario=scenario,
                settings=settings,
                agent_client=agent_client,
                fake_client=fake_client,
                binding_ref=binding_ref,
                session_snapshot=session_snapshot,
                tracker=tracker,
            )
            async with lock:
                observations.append(observation)
            sequence += settings.concurrency

    await asyncio.gather(*(worker(index) for index in range(settings.concurrency)))
    return observations


def _worker_context(
    worker_index: int,
    *,
    binding_refs: Sequence[str | None],
    session_snapshots: Sequence[dict[str, object] | None],
) -> tuple[str | None, dict[str, object] | None]:
    if not binding_refs or len(binding_refs) != len(session_snapshots):
        raise ValueError("binding refs and session snapshots must be aligned")
    index = worker_index % len(binding_refs)
    return binding_refs[index], session_snapshots[index]


async def _run_once(
    *,
    sequence: int,
    worker_index: int,
    scenario: CapacityScenario,
    settings: CapacityDriverSettings,
    agent_client: httpx.AsyncClient,
    fake_client: httpx.AsyncClient,
    binding_ref: str | None,
    session_snapshot: dict[str, object] | None,
    tracker: ActiveRunTracker | None,
    suspend: bool = False,
) -> CapacityObservation:
    benchmark_run_id = f"{settings.block_id}-{sequence}-{uuid4().hex}"
    prepare = await fake_client.post(
        "/__bench/prepare",
        json={
            "benchmark_run_id": benchmark_run_id,
            "scenario_id": scenario.id,
            "scenario_version": scenario.version,
            "payload_bytes": scenario.payload_bytes if scenario.workload == "file" else None,
        },
    )
    prepare.raise_for_status()
    sample = RunSample(
        mode=settings.mode,
        scenario_id=scenario.id,
        block_id=settings.block_id,
        benchmark_run_id=benchmark_run_id,
        worker_index=worker_index,
        payload_bytes=scenario.payload_bytes,
    )
    sse_event_ids: list[str] = []
    terminal_snapshot: dict[str, object] | None = None
    started_at_ns = time.time_ns()
    started_ns = time.perf_counter_ns()
    try:
        response = await agent_client.post(
            "/runs",
            json=build_capacity_run_request(
                scenario=scenario,
                benchmark_run_id=benchmark_run_id,
                binding_ref=binding_ref,
                session_snapshot=session_snapshot,
                suspend=suspend,
            ),
        )
        sample.create_run_http_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
        response.raise_for_status()
        run_id = response.json().get("run_id")
        if not isinstance(run_id, str):
            raise TypeError("create-run response did not contain run_id")
        sample.run_id = run_id
        sample.admitted = True
        if tracker:
            tracker.admitted()
        first_event_ns: int | None = None
        terminal_type: str | None = None
        async with agent_client.stream("GET", f"/runs/{run_id}/events/sse") as stream_response:
            stream_response.raise_for_status()
            async for event in iter_sse_data(stream_response):
                received_ns = time.perf_counter_ns()
                first_event_ns = first_event_ns or received_ns
                if isinstance(event.get("id"), str):
                    sse_event_ids.append(cast(str, event["id"]))
                sample.event_count += 1
                event_type = event.get("type")
                if event_type in _TERMINAL_EVENT_TYPES:
                    terminal_type = cast(str, event_type)
                    data = event.get("data")
                    if isinstance(data, dict) and isinstance(data.get("session_snapshot"), dict):
                        terminal_snapshot = cast(dict[str, object], data["session_snapshot"])
                    if (
                        terminal_type == "run_failed"
                        and isinstance(data, dict)
                        and isinstance(data.get("error"), str)
                    ):
                        sample.error = cast(str, data["error"])
                    break
        if first_event_ns is None or terminal_type is None:
            raise RuntimeError("SSE stream ended before a terminal event")
        sample.time_to_first_event_ms = (first_event_ns - started_ns) / 1_000_000
        sample.terminal_e2e_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
        sample.terminal_status = cast(
            TerminalStatus,
            {
                "run_succeeded": "succeeded",
                "run_failed": "failed",
                "run_cancelled": "cancelled",
            }[terminal_type],
        )
        if sample.terminal_status != "succeeded":
            sample.failure_kind = "terminal_failed"
    except Exception as exc:
        sample.failure_kind = cast(FailureKind, "stream_error" if sample.admitted else "admission_error")
        sample.error = f"{type(exc).__name__}: {exc}"
    finally:
        if sample.admitted and tracker:
            tracker.finished()
    return CapacityObservation(
        sample=sample,
        sse_event_ids=sse_event_ids,
        session_snapshot=terminal_snapshot,
        binding_ref=binding_ref,
        started_at_ns=started_at_ns,
        ended_at_ns=time.time_ns(),
    )


def build_capacity_run_request(
    *,
    scenario: CapacityScenario,
    benchmark_run_id: str,
    binding_ref: str | None,
    session_snapshot: dict[str, object] | None,
    suspend: bool,
) -> dict[str, object]:
    credentials = {
        "benchmark_run_id": benchmark_run_id,
        "scenario_id": scenario.id,
        "scenario_version": scenario.version,
    }
    execution_context = {
        "tenant_id": "benchmark-tenant",
        "user_id": benchmark_run_id,
        "user_from": "account",
        "agent_id": benchmark_run_id,
        "agent_config_version_id": "benchmark-config",
        "agent_config_version_kind": "snapshot",
        "agent_mode": "workflow_run",
        "invoke_from": "service-api",
    }
    layers: list[dict[str, object]] = [
        {
            "name": "prompt",
            "type": "plain.prompt",
            "config": {"prefix": "deterministic capacity benchmark", "user": "execute the benchmark plan"},
        },
        {"name": "execution_context", "type": "dify.execution_context", "config": execution_context},
    ]
    if scenario.workload != "basic":
        if binding_ref is not None:
            layers.append(
                {
                    "name": "runtime",
                    "type": "dify.runtime",
                    "config": {"backend_binding_ref": binding_ref},
                }
            )
        shell_dependencies = {"execution_context": "execution_context"}
        if binding_ref is not None:
            shell_dependencies["runtime"] = "runtime"
        layers.append(
            {
                "name": "shell",
                "type": "dify.shell",
                "deps": shell_dependencies,
                "config": {"agent_stub_drive_ref": f"agent-{benchmark_run_id}"},
            }
        )
    if scenario.workload == "config":
        skills = [
            {
                "name": f"skill-{index}",
                "description": "deterministic benchmark skill",
                "size": scenario.item_bytes,
                "mime_type": "application/zip",
            }
            for index in range(scenario.config_skill_count)
        ]
        files = [
            {
                "name": f"file-{index}.bin",
                "size": scenario.item_bytes,
                "mime_type": "application/octet-stream",
            }
            for index in range(scenario.config_file_count)
        ]
        layers.append(
            {
                "name": "config",
                "type": "dify.config",
                "deps": {"shell": "shell"},
                "config": {
                    "agent_id": benchmark_run_id,
                    "config_version": {"id": "benchmark-config", "kind": "snapshot", "writable": False},
                    "skills": skills,
                    "files": files,
                    "mentioned_skill_names": [item["name"] for item in skills],
                    "mentioned_file_names": [item["name"] for item in files],
                },
            }
        )
    layers.append(
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
        }
    )
    request: dict[str, object] = {
        "composition": {"schema_version": 1, "layers": layers},
        "metadata": {
            "benchmark_run_id": benchmark_run_id,
            "scenario_id": scenario.id,
            "scenario_version": scenario.version,
        },
        "on_exit": {"default": "suspend" if suspend else "delete", "layers": {}},
    }
    if session_snapshot is not None:
        request["session_snapshot"] = session_snapshot
    return request


async def _validate_observations(
    *,
    observations: list[CapacityObservation],
    scenario: CapacityScenario,
    concurrency: int,
    agent_client: httpx.AsyncClient,
    fake_client: httpx.AsyncClient,
) -> None:
    semaphore = asyncio.Semaphore(max(1, min(concurrency, 10)))

    async def validate(observation: CapacityObservation) -> None:
        sample = observation.sample
        if sample.terminal_status != "succeeded" or sample.run_id is None:
            return
        async with semaphore:
            try:
                sample.event_replay_valid = (
                    await _read_event_ids(agent_client, sample.run_id)
                ) == observation.sse_event_ids
                response = await fake_client.get(f"/__bench/ledgers/{sample.benchmark_run_id}")
                response.raise_for_status()
                ledger = FakeDependencyLedger.model_validate(response.json())
                sample.ledger_valid = validate_ledger(ledger=ledger, scenario=scenario)
                if not sample.event_replay_valid or not sample.ledger_valid:
                    sample.failure_kind = "validation_error"
            except Exception as exc:
                sample.failure_kind = "validation_error"
                sample.error = f"{type(exc).__name__}: {exc}"

    await asyncio.gather(*(validate(observation) for observation in observations))


async def _read_event_ids(agent_client: httpx.AsyncClient, run_id: str) -> list[str]:
    cursor = "0-0"
    event_ids: list[str] = []
    while True:
        response = await agent_client.get(f"/runs/{run_id}/events", params={"after": cursor, "limit": 500})
        response.raise_for_status()
        payload = response.json()
        events = payload.get("events")
        if not isinstance(events, list):
            raise TypeError("event replay did not contain events")
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


def validate_ledger(*, ledger: FakeDependencyLedger, scenario: CapacityScenario) -> bool:
    expected_calls: dict[str, int] = {}
    expected_payload_bytes = 0
    if scenario.workload == "config":
        expected_calls = {
            "config_skill_pull": scenario.config_skill_count,
            "config_file_pull": scenario.config_file_count,
        }
        expected_payload_bytes = (scenario.config_skill_count + scenario.config_file_count) * scenario.item_bytes
    elif scenario.workload == "file":
        expected_calls = {
            "file_upload_request": 1,
            "signed_upload": 1,
            "file_download_request": 2,
            "signed_download": 1,
        }
        expected_payload_bytes = scenario.payload_bytes * 2
    expected_hashes = sum(
        count
        for name, count in expected_calls.items()
        if name in {"config_skill_pull", "config_file_pull", "signed_upload", "signed_download"}
    )
    return (
        ledger.scenario_id == scenario.id
        and ledger.scenario_version == scenario.version
        and ledger.model_calls == scenario.model_rounds
        and len(ledger.model_start_elapsed_ms) == scenario.model_rounds
        and ledger.tool_calls == scenario.tool_rounds
        and ledger.text_chunks == scenario.text_chunks
        and ledger.model_stream_items == scenario.expected_model_stream_items
        and ledger.stub_calls == expected_calls
        and len(ledger.stub_elapsed_ms) == sum(expected_calls.values())
        and ledger.payload_bytes == expected_payload_bytes
        and len(ledger.payload_sha256) == expected_hashes
    )


def summarize_outcomes(
    *,
    samples: list[RunSample],
    elapsed_seconds: float,
    max_active: int,
) -> RunOutcomeSummary:
    attempted = len(samples)
    admitted = sum(sample.admitted for sample in samples)
    terminal = sum(sample.terminal_status in {"succeeded", "failed", "cancelled"} for sample in samples)
    successful = sum(sample.terminal_status == "succeeded" for sample in samples)
    timeout_runs = sum(sample.error is not None and "timeout" in sample.error.lower() for sample in samples)
    throttle_runs = sum(
        sample.error is not None
        and any(token in sample.error.lower() for token in ("429", "throttle", "quota"))
        for sample in samples
    )
    return RunOutcomeSummary(
        attempted_runs=attempted,
        admitted_runs=admitted,
        terminal_runs=terminal,
        successful_runs=successful,
        timeout_runs=timeout_runs,
        throttle_runs=throttle_runs,
        success_rate=successful / attempted if attempted else 0,
        runs_per_second=successful / elapsed_seconds if elapsed_seconds else 0,
        observed_max_active=max_active,
    )


def _invalid_reasons(
    *,
    samples: list[RunSample],
    redis_before: RedisSnapshot,
    redis_after: RedisSnapshot,
    jobs_empty: bool,
    require_e2b_active_windows: bool,
) -> list[str]:
    reasons: list[str] = []
    if not samples:
        reasons.append("measurement produced no Runs")
    for sample in samples:
        if sample.terminal_status == "succeeded":
            if not sample.ledger_valid:
                reasons.append("one or more dependency ledgers were invalid")
                break
            if not sample.event_replay_valid:
                reasons.append("one or more SSE sequences differed from Redis replay")
                break
        elif sample.failure_kind == "terminal_failed":
            terminal_errors = [
                _compact_error(item.error)
                for item in samples
                if item.failure_kind == "terminal_failed" and item.error
            ]
            detail = f": {terminal_errors[0]}" if terminal_errors else ""
            reasons.append(f"one or more Runs reached an unexpected terminal status{detail}")
            break
        elif sample.error and not any(
            token in sample.error.lower() for token in ("timeout", "429", "throttle", "quota")
        ):
            reasons.append("one or more Runs failed for a non-capacity reason")
            break
    if require_e2b_active_windows and any(
        sample.terminal_status == "succeeded" and sample.e2b_active_seconds is None for sample in samples
    ):
        reasons.append("one or more E2B Runs lacked a matching pause execution event")
    if not jobs_empty:
        reasons.append("shellctl jobs remained after cleanup")
    if redis_after.evicted_keys > redis_before.evicted_keys:
        reasons.append("Redis evicted benchmark keys")
    if redis_after.rejected_connections > redis_before.rejected_connections:
        reasons.append("Redis rejected benchmark connections")
    return list(dict.fromkeys(reasons))


def _compact_error(error: str, *, limit: int = 240) -> str:
    compact = " ".join(error.split())
    return compact if len(compact) <= limit else compact[: limit - 1] + "…"


async def iter_sse_data(response: httpx.Response) -> AsyncIterator[dict[str, object]]:
    async for line in response.aiter_lines():
        if not line.startswith("data: "):
            continue
        payload = json.loads(line.removeprefix("data: "))
        if not isinstance(payload, dict):
            raise TypeError("SSE payload must be a JSON object")
        yield payload


async def capture_redis_snapshot(redis: Redis) -> RedisSnapshot:
    info = cast(dict[str, object], await redis.info())
    commandstats = cast(dict[str, object], await redis.info("commandstats"))
    command_calls = {
        name.removeprefix("cmdstat_"): _counter_value(value)
        for name, value in commandstats.items()
        if name.startswith("cmdstat_")
    }
    return RedisSnapshot.model_validate(
        {
            "total_net_input_bytes": info.get("total_net_input_bytes", 0),
            "total_net_output_bytes": info.get("total_net_output_bytes", 0),
            "evicted_keys": info.get("evicted_keys", 0),
            "rejected_connections": info.get("rejected_connections", 0),
            "command_calls": command_calls,
        }
    )


async def calculate_storage_bytes(redis: Redis, *, prefix: str) -> int:
    total = 0
    async for key in redis.scan_iter(match=f"{prefix}:*"):
        usage = await redis.memory_usage(key)
        total += int(usage or 0)
    return total


def redis_command_call_deltas(before: RedisSnapshot, after: RedisSnapshot) -> dict[str, int]:
    return {
        command: max(0, after.command_calls.get(command, 0) - before.command_calls.get(command, 0))
        for command in set(before.command_calls) | set(after.command_calls)
    }


async def _reset(redis: Redis, fake_client: httpx.AsyncClient) -> None:
    await redis.flushdb()
    response = await fake_client.post("/__bench/reset")
    response.raise_for_status()


def _write_artifacts(results_dir: Path, result: BlockResult) -> None:
    (results_dir / "block-result.json").write_text(result.model_dump_json(indent=2))
    with (results_dir / "samples.jsonl").open("w") as output:
        for sample in result.samples:
            output.write(sample.model_dump_json())
            output.write("\n")
    (results_dir / "redis-before.json").write_text(result.redis_before.model_dump_json(indent=2))
    (results_dir / "redis-after.json").write_text(result.redis_after.model_dump_json(indent=2))


def _required_environment(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ValueError(f"{name} is required")
    return value


def _counter_value(value: object) -> int:
    if isinstance(value, dict):
        calls = value.get("calls")
        return int(calls) if isinstance(calls, (int, float)) else 0
    return 0


async def main() -> int:
    result = await run_block(CapacityDriverSettings.from_environment())
    return 0 if result.valid else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))


__all__ = [
    "CapacityDriverSettings",
    "build_capacity_run_request",
    "run_block",
    "summarize_outcomes",
    "validate_ledger",
]
