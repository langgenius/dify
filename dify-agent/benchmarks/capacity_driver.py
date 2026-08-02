"""Unified driver for local Runtime and real E2B capacity points."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
from importlib.metadata import PackageNotFoundError, version
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from typing import cast

import httpx
from redis.asyncio import Redis

from benchmarks.capacity_protocol import CapacityObservation, build_capacity_run_request
from benchmarks.load_phase import LoadPhaseRequest, LoadPhaseResult, PhaseKind, WorkerContext
from benchmarks.scenario import BenchmarkMode, CapacityScenario, load_scenario_manifest
from benchmarks.schemas import (
    BlockResult,
    FakeDependencyLedger,
    RedisSnapshot,
    RunOutcomeSummary,
    RunSample,
)


class BindingCleanupError(RuntimeError):
    """One or more benchmark bindings could not be destroyed."""


@dataclass(slots=True, frozen=True)
class _E2BExecutionWindow:
    """Official E2B lifecycle evidence for one running window."""

    occurred_at: float
    active_seconds: float
    vcpu_count: float | None
    memory_mib: float | None


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
            e2b_api_key=os.environ.get("BENCH_E2B_API_KEY") or None,
        )


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
    measurement_phase: LoadPhaseResult | None = None
    phase_errors: list[str] = []
    load_engine_phases: dict[str, object] = {}
    bindings_destroyed = True
    allocation_journal = settings.results_dir / ".e2b-allocations.jsonl" if external_runtime else None
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
                allocation_journal=allocation_journal,
            ) as allocations,
        ):
            binding_refs = [allocation[0] for allocation in allocations] or [None] * settings.concurrency
            contexts = [
                WorkerContext(worker_index=index, binding_ref=binding_ref)
                for index, binding_ref in enumerate(binding_refs)
            ]
            with tempfile.TemporaryDirectory(prefix="dify-agent-bench-load-") as private_directory:
                private_dir = Path(private_directory)
                contexts, resume_phases, resume_errors = await _prepare_resume_contexts(
                    scenario=scenario,
                    settings=settings,
                    contexts=contexts,
                    private_dir=private_dir,
                    prime_first=not external_runtime,
                )
                phase_errors.extend(resume_errors)
                if resume_phases:
                    load_engine_phases["resume_setup"] = [phase.model_dump(mode="json") for phase in resume_phases]
                _write_redacted_contexts(settings.results_dir / "worker-context.redacted.json", contexts)
                await _reset(redis, fake_client)
                if resume_errors:
                    warmup_phase = _record_skipped_load_phase(
                        settings=settings,
                        phase="warmup",
                        requested_users=len(contexts),
                        stats_path=settings.results_dir / "locust-warmup-stats.json",
                        reason="warmup skipped because resume setup failed",
                    )
                    warmup: list[CapacityObservation] = []
                else:
                    warmup_phase, warmup = await _execute_load_phase(
                        settings=settings,
                        contexts=contexts,
                        phase="warmup",
                        private_dir=private_dir,
                        duration_seconds=settings.warmup_seconds,
                        stats_path=settings.results_dir / "locust-warmup-stats.json",
                    )
                load_engine_phases["warmup"] = warmup_phase.model_dump(mode="json")
                if warmup_phase.fatal_errors:
                    phase_errors.extend(f"warmup: {error}" for error in warmup_phase.fatal_errors)
                if not resume_errors and not any(item.sample.terminal_status == "succeeded" for item in warmup):
                    phase_errors.append("warmup produced no successful Runs")
                if not external_runtime and not await _delete_all_runtime_jobs(runtime_client):
                    phase_errors.append("failed to clean warmup Runtime jobs")

                await _reset(redis, fake_client)
                redis_before = await capture_redis_snapshot(redis)
                if phase_errors:
                    measurement_phase = _record_skipped_load_phase(
                        settings=settings,
                        phase="measurement",
                        requested_users=len(contexts),
                        stats_path=settings.results_dir / "locust-measurement-stats.json",
                        reason="measurement skipped because setup or warmup failed",
                    )
                    observations = []
                else:
                    measurement_phase, observations = await _execute_load_phase(
                        settings=settings,
                        contexts=contexts,
                        phase="measurement",
                        private_dir=private_dir,
                        duration_seconds=settings.measurement_seconds,
                        stats_path=settings.results_dir / "locust-measurement-stats.json",
                    )
                load_engine_phases["measurement"] = measurement_phase.model_dump(mode="json")
                phase_errors.extend(measurement_phase.fatal_errors)
                elapsed_seconds = measurement_phase.elapsed_seconds
                measurement_started_at_ns = measurement_phase.started_at_ns
                measurement_ended_at_ns = measurement_phase.ended_at_ns
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
    except Exception as exc:
        if isinstance(exc, BindingCleanupError):
            bindings_destroyed = False
        phase_errors.append(f"driver pipeline: {type(exc).__name__}: {exc}")
        if "warmup" not in load_engine_phases:
            warmup_phase = _record_skipped_load_phase(
                settings=settings,
                phase="warmup",
                requested_users=settings.concurrency,
                stats_path=settings.results_dir / "locust-warmup-stats.json",
                reason="warmup did not start because the driver pipeline failed",
            )
            load_engine_phases["warmup"] = warmup_phase.model_dump(mode="json")
        if measurement_phase is None:
            measurement_phase = _record_skipped_load_phase(
                settings=settings,
                phase="measurement",
                requested_users=settings.concurrency,
                stats_path=settings.results_dir / "locust-measurement-stats.json",
                reason="measurement did not start because the driver pipeline failed",
            )
            load_engine_phases["measurement"] = measurement_phase.model_dump(mode="json")
        if not external_runtime:
            jobs_empty = False
        if not (settings.results_dir / "runtime-jobs-after.json").exists():
            (settings.results_dir / "runtime-jobs-after.json").write_text(
                json.dumps({"error": f"{type(exc).__name__}: {exc}"}, indent=2, sort_keys=True)
            )
    finally:
        try:
            await redis.aclose()
        except Exception as exc:
            phase_errors.append(f"Redis cleanup: {type(exc).__name__}: {exc}")

    samples = [observation.sample for observation in observations]
    for sample in samples:
        sample.cleanup_valid = jobs_empty and bindings_destroyed
    outcomes = summarize_outcomes(
        samples=samples,
        elapsed_seconds=elapsed_seconds,
        max_active=measurement_phase.observed_max_active if measurement_phase is not None else 0,
    )
    invalid_reasons = _invalid_reasons(
        samples=samples,
        redis_before=redis_before,
        redis_after=redis_after,
        jobs_empty=jobs_empty,
        require_e2b_active_windows=external_runtime and scenario.workload != "basic",
    )
    invalid_reasons.extend(f"Locust load engine: {error}" for error in phase_errors)
    if not bindings_destroyed:
        invalid_reasons.append("one or more E2B bindings were not destroyed by the driver")
    invalid_reasons = list(dict.fromkeys(invalid_reasons))
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
        outcomes=outcomes,
        redis_before=redis_before,
        redis_after=redis_after,
        samples=samples,
        cleanup={"jobs_empty": jobs_empty, "bindings_destroyed": bindings_destroyed},
        valid=not invalid_reasons,
        invalid_reasons=invalid_reasons,
    )
    if outcomes.successful_runs:
        command_deltas = redis_command_call_deltas(redis_before, redis_after)
        result.resources.redis_commands_per_run = sum(command_deltas.values()) / outcomes.successful_runs
    (settings.results_dir / "load-engine.json").write_text(
        json.dumps(
            {"engine": "locust", "spawn_rate": 200, "phases": load_engine_phases},
            indent=2,
            sort_keys=True,
        )
    )
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
    allocation_journal: Path | None = None,
) -> AsyncIterator[list[tuple[str | None, str | None]]]:
    """Create one binding per worker and destroy every successful allocation."""
    allocations: list[tuple[str | None, str | None]] = []

    async def create_and_record(worker_index: int) -> tuple[str | None, str | None]:
        binding_ref, workspace_ref = await _create_binding(
            agent_client,
            f"{block_id}-worker-{worker_index}",
            retry_attempts=creation_retry_attempts,
        )
        if binding_ref is not None and workspace_ref is not None:
            _append_binding_journal_event(
                allocation_journal,
                state="allocated",
                binding_ref=binding_ref,
                workspace_ref=workspace_ref,
            )
        return binding_ref, workspace_ref

    try:
        results = await asyncio.gather(
            *(create_and_record(worker_index) for worker_index in range(binding_pool_size)),
            return_exceptions=True,
        )
        allocations.extend(result for result in results if isinstance(result, tuple))
        errors = [result for result in results if isinstance(result, BaseException)]
        if errors:
            raise RuntimeError(f"failed to create {len(errors)} of {binding_pool_size} benchmark bindings") from errors[
                0
            ]
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
        for (binding_ref, workspace_ref), cleanup_result in zip(allocations, cleanup_results, strict=True):
            if not isinstance(cleanup_result, BaseException) and binding_ref is not None and workspace_ref is not None:
                _append_binding_journal_event(
                    allocation_journal,
                    state="destroyed",
                    binding_ref=binding_ref,
                    workspace_ref=workspace_ref,
                )
        errors = [result for result in cleanup_results if isinstance(result, BaseException)]
        if errors:
            raise BindingCleanupError(
                f"failed to destroy {len(errors)} of {len(allocations)} benchmark bindings"
            ) from errors[0]


def _append_binding_journal_event(
    path: Path | None,
    *,
    state: str,
    binding_ref: str,
    workspace_ref: str,
) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "binding_ref": binding_ref,
        "state": state,
        "workspace_ref": workspace_ref,
    }
    with path.open("a", encoding="utf-8", buffering=1) as output:
        output.write(json.dumps(payload, sort_keys=True) + "\n")
        output.flush()
        os.fsync(output.fileno())


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
            async with semaphore:
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    events = await _fetch_e2b_pause_events(
                        client,
                        binding_ref,
                        timeout_seconds=max(0, deadline - time.monotonic()),
                    )
                    execution_windows = _execution_windows_from_events(
                        events,
                        windows=[(observation.started_at_ns, observation.ended_at_ns) for observation in items],
                    )
                    for observation, execution_window in zip(items, execution_windows, strict=True):
                        if execution_window is None:
                            continue
                        observation.sample.e2b_active_seconds = execution_window.active_seconds
                        observation.sample.e2b_vcpu_count = execution_window.vcpu_count
                        observation.sample.e2b_memory_mib = execution_window.memory_mib
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
    return [
        execution.active_seconds if execution is not None else None
        for execution in _execution_windows_from_events(events, windows=windows)
    ]


def _execution_windows_from_events(
    events: Sequence[object],
    *,
    windows: Sequence[tuple[int, int]],
) -> list[_E2BExecutionWindow | None]:
    pause_events = _parse_pause_events(events)
    matched: list[_E2BExecutionWindow | None] = [None] * len(windows)
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
            if lower_bound <= pause_events[event_index].occurred_at <= upper_bound
        ]
        if not candidates:
            continue
        ended_at = ended_at_ns / 1_000_000_000
        selected = min(
            candidates,
            key=lambda event_index: abs(pause_events[event_index].occurred_at - ended_at),
        )
        matched[window_index] = pause_events[selected]
        available.remove(selected)
    return matched


def _parse_pause_events(events: Sequence[object]) -> list[_E2BExecutionWindow]:
    parsed: list[_E2BExecutionWindow] = []
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
        if isinstance(execution_time_ms, bool) or not isinstance(execution_time_ms, (float, int)):
            continue
        if execution_time_ms < 0:
            continue
        vcpu_count = _positive_number(execution.get("vcpu_count", execution.get("vcpuCount")))
        memory_mib = _positive_number(execution.get("memory_mb", execution.get("memoryMb")))
        parsed.append(
            _E2BExecutionWindow(
                occurred_at=occurred_at,
                active_seconds=float(execution_time_ms) / 1000,
                vcpu_count=vcpu_count,
                memory_mib=memory_mib,
            )
        )
    return sorted(parsed, key=lambda item: item.occurred_at)


def _positive_number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (float, int)) or value <= 0:
        return None
    return float(value)


async def _prepare_resume_contexts(
    *,
    scenario: CapacityScenario,
    settings: CapacityDriverSettings,
    contexts: list[WorkerContext],
    private_dir: Path,
    prime_first: bool,
) -> tuple[list[WorkerContext], list[LoadPhaseResult], list[str]]:
    if scenario.workload != "resume":
        return contexts, [], []
    groups = [contexts]
    if prime_first and len(contexts) > 1:
        groups = [contexts[:1], contexts[1:]]
    phases: list[LoadPhaseResult] = []
    snapshots: dict[int, dict[str, object]] = {}
    errors: list[str] = []
    for index, group in enumerate(groups):
        if not group:
            continue
        phase, observations = await _execute_load_phase(
            settings=settings,
            contexts=group,
            phase="resume-setup",
            private_dir=private_dir,
            iterations_per_user=1,
            suspend=True,
            stats_path=private_dir / f"resume-setup-{index}-stats.json",
            artifact_label=f"resume-setup-{index}",
        )
        phases.append(phase)
        if phase.fatal_errors:
            errors.extend(f"resume setup: {error}" for error in phase.fatal_errors)
            break
        by_worker = {observation.sample.worker_index: observation for observation in observations}
        for context in group:
            observation = by_worker.get(context.worker_index)
            if (
                observation is None
                or observation.sample.terminal_status != "succeeded"
                or observation.session_snapshot is None
            ):
                detail = observation.sample.error if observation is not None else "missing observation"
                errors.append(f"failed to build resume snapshot for worker {context.worker_index}: {detail}")
                continue
            snapshots[context.worker_index] = observation.session_snapshot
        if errors:
            break
    if errors:
        return contexts, phases, errors
    return (
        [context.model_copy(update={"session_snapshot": snapshots[context.worker_index]}) for context in contexts],
        phases,
        [],
    )


async def _execute_load_phase(
    *,
    settings: CapacityDriverSettings,
    contexts: Sequence[WorkerContext],
    phase: PhaseKind,
    private_dir: Path,
    stats_path: Path,
    duration_seconds: float | None = None,
    iterations_per_user: int | None = None,
    suspend: bool = False,
    artifact_label: str | None = None,
) -> tuple[LoadPhaseResult, list[CapacityObservation]]:
    label = artifact_label or phase
    contexts_path = private_dir / f"{label}-contexts.json"
    observations_path = private_dir / f"{label}-observations.jsonl"
    active_runs_path = private_dir / f"{label}-active-runs.jsonl"
    result_path = private_dir / f"{label}-result.json"
    request_path = private_dir / f"{label}-request.json"
    contexts_path.write_text(json.dumps([context.model_dump(mode="json") for context in contexts], sort_keys=True))
    request = LoadPhaseRequest(
        mode=settings.mode,
        phase=phase,
        agent_url=settings.agent_url,
        fake_deps_url=settings.fake_deps_url,
        scenario_id=settings.scenario_id,
        block_id=settings.block_id,
        contexts_path=contexts_path,
        observations_path=observations_path,
        active_runs_path=active_runs_path,
        stats_path=stats_path,
        result_path=result_path,
        duration_seconds=duration_seconds,
        iterations_per_user=iterations_per_user,
        sequence_stride=settings.concurrency,
        suspend=suspend,
    )
    request_path.write_text(request.model_dump_json(indent=2))
    timeout_seconds = (duration_seconds or 0) + request.drain_timeout_seconds + 30
    parent_started_at_ns = time.time_ns()
    parent_started_perf = time.perf_counter()
    stdout = b""
    stderr = b""
    process: asyncio.subprocess.Process | None = None
    timed_out = False
    parent_errors: list[str] = []
    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "benchmarks.locust_load",
            "--request",
            str(request_path),
            cwd=Path(__file__).resolve().parents[1],
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_load_subprocess_environment(),
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_seconds)
        except TimeoutError:
            timed_out = True
            parent_errors.append(f"Locust {label} subprocess exceeded {timeout_seconds:.0f}s")
            try:
                process.terminate()
            except ProcessLookupError:
                pass
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=5)
            except TimeoutError:
                process.kill()
                stdout, stderr = await process.communicate()
    except Exception as exc:
        parent_errors.append(f"failed to execute Locust {label} subprocess: {type(exc).__name__}: {exc}")
    finally:
        if process is not None and process.returncode is None:
            try:
                process.kill()
                remaining_stdout, remaining_stderr = await asyncio.wait_for(process.communicate(), timeout=5)
                stdout += remaining_stdout
                stderr += remaining_stderr
            except Exception as exc:
                parent_errors.append(f"failed to reap Locust {label} subprocess: {type(exc).__name__}: {exc}")
        log_payload = stdout + stderr
        if parent_errors:
            log_payload += ("\n[parent-driver]\n" + "\n".join(parent_errors) + "\n").encode()
        (settings.results_dir / f"locust-{label}.log").write_bytes(log_payload)

    active_run_ids, active_checkpoint_errors = _read_active_run_checkpoint(active_runs_path)
    parent_errors.extend(active_checkpoint_errors)
    if active_run_ids:
        terminal_count, recovery_errors = await _cancel_and_drain_active_runs(
            agent_url=settings.agent_url,
            run_ids=active_run_ids,
        )
        recovery_summary = (
            f"Locust {label} exited with {len(active_run_ids)} active Runs; terminal-drained {terminal_count}"
        )
        parent_errors.append(recovery_summary)
        parent_errors.extend(recovery_errors)
        with (settings.results_dir / f"locust-{label}.log").open("ab") as log:
            log.write(("\n[parent-recovery]\n" + recovery_summary + "\n").encode())
            if recovery_errors:
                log.write(("\n".join(recovery_errors) + "\n").encode())

    observations, observation_errors = _read_partial_observations(observations_path)
    parent_errors.extend(observation_errors)
    result: LoadPhaseResult | None = None
    if result_path.exists():
        try:
            result = LoadPhaseResult.model_validate_json(result_path.read_text())
        except Exception as exc:
            parent_errors.append(f"Locust {label} wrote an invalid phase result: {type(exc).__name__}: {exc}")
    else:
        returncode = process.returncode if process is not None else None
        parent_errors.append(f"Locust {label} subprocess exited with {returncode} without a phase result")

    parent_ended_at_ns = time.time_ns()
    parent_elapsed_seconds = max(0.000001, time.perf_counter() - parent_started_perf)
    if result is None:
        result = LoadPhaseResult(
            phase=phase,
            started_at_ns=parent_started_at_ns,
            ended_at_ns=parent_ended_at_ns,
            elapsed_seconds=parent_elapsed_seconds,
            drain_seconds=max(0, parent_elapsed_seconds - (duration_seconds or parent_elapsed_seconds)),
            requested_users=len(contexts),
            spawned_users=0,
            observed_max_active=0,
            observation_count=len(observations),
            timed_out=timed_out,
            fatal_errors=[],
            locust_version=_installed_locust_version(),
        )
    if timed_out:
        result.timed_out = True
    result.fatal_errors.extend(parent_errors)
    if process is not None and process.returncode:
        result.fatal_errors.append(f"subprocess exited with status {process.returncode}")
    result.fatal_errors.extend(
        _load_phase_integrity_errors(
            result=result,
            observations=observations,
            label=label,
            scenario_id=settings.scenario_id,
        )
    )
    result.fatal_errors = list(dict.fromkeys(result.fatal_errors))
    _write_incomplete_locust_stats(
        stats_path,
        phase=phase,
        fatal_errors=result.fatal_errors,
    )
    return result, observations


def _load_phase_integrity_errors(
    *,
    result: LoadPhaseResult,
    observations: Sequence[CapacityObservation],
    label: str,
    scenario_id: str,
) -> list[str]:
    errors: list[str] = []
    if result.observation_count != len(observations):
        errors.append(f"phase reported {result.observation_count} observations but wrote {len(observations)}")
    composite = result.composite_request
    unsuccessful_count = sum(observation.sample.terminal_status != "succeeded" for observation in observations)
    if composite is None:
        errors.append(f"Locust {label} phase did not report AGENT_RUN/{scenario_id} stats")
        return errors
    if composite.request_count != len(observations):
        errors.append(
            f"Locust {label} reported {composite.request_count} composite requests for {len(observations)} observations"
        )
    if composite.failure_count != unsuccessful_count:
        errors.append(
            f"Locust {label} reported {composite.failure_count} composite failures "
            f"for {unsuccessful_count} unsuccessful observations"
        )
    return errors


def _read_active_run_checkpoint(path: Path) -> tuple[list[str], list[str]]:
    if not path.exists():
        return [], ["Locust active-Run checkpoint was not written"]
    text = path.read_text()
    if not text.strip():
        return [], []
    unresolved: dict[str, None] = {}
    errors: list[str] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except Exception as exc:
            errors.append(f"failed to read active-Run journal line {line_number}: {type(exc).__name__}: {exc}")
            continue
        if not isinstance(event, dict) or not isinstance(event.get("run_id"), str):
            errors.append(f"active-Run journal line {line_number} was not a valid event")
            continue
        run_id = cast(str, event["run_id"])
        state = event.get("state")
        if state == "admitted":
            unresolved[run_id] = None
        elif state == "terminal":
            unresolved.pop(run_id, None)
        else:
            errors.append(f"active-Run journal line {line_number} had unknown state {state!r}")
    return sorted(unresolved), errors


async def _cancel_and_drain_active_runs(
    *,
    agent_url: str,
    run_ids: Sequence[str],
    timeout_seconds: float = 30,
) -> tuple[int, list[str]]:
    timeout = httpx.Timeout(connect=10, read=10, write=10, pool=10)
    limits = httpx.Limits(max_connections=max(1, len(run_ids)), max_keepalive_connections=max(1, len(run_ids)))
    async with httpx.AsyncClient(base_url=agent_url, timeout=timeout, limits=limits) as client:
        results = await asyncio.gather(
            *(_cancel_and_drain_run(client, run_id, timeout_seconds=timeout_seconds) for run_id in run_ids)
        )
    terminal_count = sum(error is None for error in results)
    errors = [error for error in results if error is not None]
    return terminal_count, cast(list[str], errors)


async def _cancel_and_drain_run(
    client: httpx.AsyncClient,
    run_id: str,
    *,
    timeout_seconds: float,
) -> str | None:
    deadline = time.monotonic() + timeout_seconds
    try:
        status = await client.get(f"/runs/{run_id}")
        status.raise_for_status()
        if _run_status_is_terminal(status):
            return None
        cancel = await client.post(
            f"/runs/{run_id}/cancel",
            json={"reason": "benchmark load engine interrupted"},
        )
        if cancel.status_code not in {httpx.codes.OK, httpx.codes.CONFLICT}:
            cancel.raise_for_status()
        while time.monotonic() < deadline:
            status = await client.get(f"/runs/{run_id}")
            status.raise_for_status()
            if _run_status_is_terminal(status):
                return None
            await asyncio.sleep(0.1)
        return f"Run {run_id} did not reach terminal status within the recovery timeout"
    except Exception as exc:
        return f"failed to recover interrupted Run {run_id}: {type(exc).__name__}: {exc}"


def _run_status_is_terminal(response: httpx.Response) -> bool:
    payload = response.json()
    return isinstance(payload, dict) and payload.get("status") in {"succeeded", "failed", "cancelled"}


def _read_partial_observations(path: Path) -> tuple[list[CapacityObservation], list[str]]:
    observations: list[CapacityObservation] = []
    errors: list[str] = []
    if not path.exists():
        return observations, errors
    for line_number, line in enumerate(path.read_text().splitlines(), start=1):
        if not line:
            continue
        try:
            observations.append(CapacityObservation.model_validate_json(line))
        except Exception as exc:
            errors.append(f"failed to parse observation line {line_number}: {type(exc).__name__}: {exc}")
    return observations, errors


def _write_incomplete_locust_stats(
    path: Path,
    *,
    phase: PhaseKind,
    fatal_errors: Sequence[str],
) -> None:
    if path.exists():
        return
    path.write_text(
        json.dumps(
            {
                "locust_version": _installed_locust_version(),
                "phase": phase,
                "entries": [],
                "errors": [],
                "total": {},
                "incomplete": True,
                "fatal_errors": list(fatal_errors),
            },
            indent=2,
            sort_keys=True,
        )
    )


def _record_skipped_load_phase(
    *,
    settings: CapacityDriverSettings,
    phase: PhaseKind,
    requested_users: int,
    stats_path: Path,
    reason: str,
) -> LoadPhaseResult:
    now_ns = time.time_ns()
    result = LoadPhaseResult(
        phase=phase,
        started_at_ns=now_ns,
        ended_at_ns=now_ns + 1,
        elapsed_seconds=0.000001,
        drain_seconds=0,
        requested_users=requested_users,
        spawned_users=0,
        observed_max_active=0,
        observation_count=0,
        fatal_errors=[reason],
        locust_version=_installed_locust_version(),
    )
    _write_incomplete_locust_stats(stats_path, phase=phase, fatal_errors=result.fatal_errors)
    (settings.results_dir / f"locust-{phase}.log").write_text(f"[parent-driver]\n{reason}\n")
    return result


def _installed_locust_version() -> str:
    try:
        return version("locust")
    except PackageNotFoundError:
        return "not-installed"


def _load_subprocess_environment() -> dict[str, str]:
    allowed = {
        "HOME",
        "LANG",
        "LC_ALL",
        "NO_PROXY",
        "PATH",
        "PYTHONPATH",
        "PYTHONDONTWRITEBYTECODE",
        "PYTHONUNBUFFERED",
        "SSL_CERT_DIR",
        "SSL_CERT_FILE",
        "TZ",
        "VIRTUAL_ENV",
    }
    return {name: value for name, value in os.environ.items() if name in allowed}


def _write_redacted_contexts(path: Path, contexts: Sequence[WorkerContext]) -> None:
    path.write_text(
        json.dumps(
            [
                {
                    "worker_index": context.worker_index,
                    "has_binding": context.binding_ref is not None,
                    "has_session_snapshot": context.session_snapshot is not None,
                }
                for context in contexts
            ],
            indent=2,
            sort_keys=True,
        )
    )


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
        sample.error is not None and any(token in sample.error.lower() for token in ("429", "throttle", "quota"))
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
                _compact_error(item.error) for item in samples if item.failure_kind == "terminal_failed" and item.error
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
