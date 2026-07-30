"""Agent-to-Runtime capability driver with deterministic Agent Stub data."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import shlex
import time
from typing import cast
from uuid import uuid4

import httpx
from redis.asyncio import Redis

from benchmarks.comparison import quantile
from benchmarks.load_driver import (
    calculate_storage_bytes,
    capture_redis_snapshot,
    iter_sse_data,
    redis_command_call_deltas,
)
from benchmarks.scenario import CapabilityBenchmarkScenario, load_scenario_manifest
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


@dataclass(slots=True, frozen=True)
class CapabilityDriverSettings:
    agent_url: str
    runtime_url: str
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
    def from_environment(cls) -> "CapabilityDriverSettings":
        target = os.environ.get("BENCH_TARGET", "candidate")
        if target not in {"baseline", "candidate"}:
            raise ValueError("BENCH_TARGET must be baseline or candidate")
        return cls(
            agent_url=os.environ.get("BENCH_AGENT_URL", "http://agent:5050").rstrip("/"),
            runtime_url=os.environ.get("BENCH_RUNTIME_URL", "http://runtime:5004").rstrip("/"),
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
class CapabilityObservation:
    sample: RunSample
    sse_event_ids: list[str]
    session_snapshot: dict[str, object] | None
    ledger: FakeDependencyLedger | None = None


@dataclass(slots=True)
class ActiveRunTracker:
    active: int = 0
    peak: int = 0

    def admitted(self) -> None:
        self.active += 1
        self.peak = max(self.peak, self.active)

    def finished(self) -> None:
        self.active -= 1


async def run_block(settings: CapabilityDriverSettings) -> BlockResult:
    loaded = load_scenario_manifest(profile="capability").get(settings.scenario_id)
    if not isinstance(loaded, CapabilityBenchmarkScenario):
        raise TypeError(f"{settings.scenario_id} is not a Capability benchmark scenario")
    scenario = _apply_overrides(loaded, settings)
    settings.results_dir.mkdir(parents=True, exist_ok=True)
    timeout = httpx.Timeout(connect=10, read=180, write=180, pool=10)
    limits = httpx.Limits(max_connections=max(30, scenario.concurrency * 5), max_keepalive_connections=30)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    async with (
        httpx.AsyncClient(base_url=settings.agent_url, timeout=timeout, limits=limits) as agent_client,
        httpx.AsyncClient(base_url=settings.runtime_url, timeout=timeout, limits=limits) as runtime_client,
        httpx.AsyncClient(base_url=settings.fake_deps_url, timeout=timeout, limits=limits) as fake_client,
    ):
        binding_ref, workspace_ref = await _create_binding(agent_client, settings.block_id)
        session_snapshot = await _prepare_resume_snapshot(
            scenario=scenario,
            settings=settings,
            agent_client=agent_client,
            fake_client=fake_client,
            binding_ref=binding_ref,
        )
        await _reset(redis, fake_client)
        await _run_warmup(
            scenario=scenario,
            settings=settings,
            agent_client=agent_client,
            runtime_client=runtime_client,
            fake_client=fake_client,
            binding_ref=binding_ref,
            session_snapshot=session_snapshot,
        )
        if not await _delete_all_runtime_jobs(runtime_client):
            raise RuntimeError("failed to clean capability warmup Runtime jobs")
        await _reset(redis, fake_client)
        redis_before = await capture_redis_snapshot(redis)

        tracker = ActiveRunTracker()
        measurement_started_at_ns = time.time_ns()
        started_perf_ns = time.perf_counter_ns()
        observations = await _run_measurement(
            scenario=scenario,
            settings=settings,
            agent_client=agent_client,
            fake_client=fake_client,
            binding_ref=binding_ref,
            session_snapshot=session_snapshot,
            tracker=tracker,
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
        drive_cleaned = await _cleanup_drive(runtime_client, observations, scenario=scenario)
        await _destroy_binding(
            agent_client,
            binding_ref=binding_ref,
            workspace_ref=workspace_ref,
        )
        runtime_jobs_cleaned = await _delete_all_runtime_jobs(runtime_client)
        jobs_response = await runtime_client.get("/v1/jobs", params={"limit": 200})
        jobs_response.raise_for_status()
        jobs = jobs_response.json().get("jobs")
        jobs_empty = runtime_jobs_cleaned and (jobs is None or (isinstance(jobs, list) and not jobs))
        (settings.results_dir / "runtime-jobs-after.json").write_text(
            json.dumps(jobs_response.json(), indent=2, sort_keys=True)
        )
        await redis.aclose()

    samples = [observation.sample for observation in observations]
    for sample in samples:
        sample.cleanup_valid = jobs_empty and drive_cleaned
    outcomes = summarize_capability_outcomes(
        samples=samples,
        elapsed_seconds=elapsed_seconds,
        max_active=tracker.peak,
    )
    invalid_reasons = _invalid_reasons(
        samples=samples,
        redis_before=redis_before,
        redis_after=redis_after,
        jobs_empty=jobs_empty,
    )
    behavior_counts = _behavior_counts(observations, outcomes.successful_runs)
    result = BlockResult(
        profile="capability",
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
        behavior_counts=behavior_counts,
        cleanup={
            "jobs_empty": jobs_empty,
            "binding_destroyed": True,
            "drive_cleaned": drive_cleaned,
        },
        valid=not invalid_reasons,
        invalid_reasons=invalid_reasons,
    )
    if outcomes.successful_runs:
        command_deltas = redis_command_call_deltas(redis_before, redis_after)
        result.resources.redis_command_calls_per_successful_run = {
            name: calls / outcomes.successful_runs for name, calls in sorted(command_deltas.items())
        }
        result.resources.redis_commands_per_successful_run = sum(command_deltas.values()) / outcomes.successful_runs
        result.resources.redis_storage_bytes_per_successful_run = redis_after.storage_bytes / outcomes.successful_runs
    fake_response_times = [
        elapsed
        for sample in samples
        for elapsed in [
            *sample.fake_model_start_elapsed_ms,
            *sample.fake_tool_elapsed_ms,
            *sample.fake_stub_elapsed_ms,
        ]
    ]
    if fake_response_times:
        result.resources.fake_response_p99_ms = quantile(fake_response_times, 0.99)
    _write_artifacts(settings.results_dir, result)
    return result


async def _cleanup_drive(
    runtime_client: httpx.AsyncClient,
    observations: list[CapabilityObservation],
    *,
    scenario: CapabilityBenchmarkScenario,
) -> bool:
    if scenario.workload != "drive_pull":
        return True
    targets = [
        f"/mnt/drive/agent-{observation.sample.benchmark_run_id}"
        for observation in observations
    ]
    if not targets:
        return True
    try:
        response = await runtime_client.post(
            "/v1/jobs/run",
            json={
                "script": "set -eu\nrm -rf -- " + " ".join(shlex.quote(target) for target in targets),
                "cwd": "/state",
                "timeout": 30,
                "output_limit": 16384,
                "idle_flush_seconds": 0.01,
            },
        )
        response.raise_for_status()
        result = response.json()
        job_id = result.get("job_id")
        if not isinstance(job_id, str):
            return False
        offset = result.get("offset") if isinstance(result.get("offset"), int) else 0
        while result.get("done") is not True:
            wait_response = await runtime_client.post(
                f"/v1/jobs/{job_id}/wait",
                json={"timeout": 10, "offset": offset, "output_limit": 16384},
            )
            wait_response.raise_for_status()
            result = wait_response.json()
            offset = result.get("offset") if isinstance(result.get("offset"), int) else offset
        succeeded = result.get("status") == "exited" and result.get("exit_code") == 0
        delete_response = await runtime_client.delete(f"/v1/jobs/{job_id}", params={"force": "true"})
        delete_response.raise_for_status()
        return succeeded and delete_response.json().get("deleted") is True
    except Exception:
        return False


async def _delete_all_runtime_jobs(runtime_client: httpx.AsyncClient) -> bool:
    try:
        response = await runtime_client.get("/v1/jobs", params={"limit": 10000})
        response.raise_for_status()
        jobs = response.json().get("jobs")
        if jobs is None:
            return True
        if not isinstance(jobs, list):
            return False
        job_ids = [
            job["job_id"]
            for job in jobs
            if isinstance(job, dict) and isinstance(job.get("job_id"), str)
        ]
        if not job_ids:
            return True
        anchor_response = await runtime_client.post(
            "/v1/jobs/run",
            json={
                "script": "printf 'cleanup-anchor\\n'; sleep 30",
                "cwd": "/state",
                "timeout": 30,
                "output_limit": 16384,
                "idle_flush_seconds": 0.01,
            },
        )
        anchor_response.raise_for_status()
        anchor_id = anchor_response.json().get("job_id")
        if not isinstance(anchor_id, str):
            return False
        for job_id in job_ids:
            delete_response = await runtime_client.delete(f"/v1/jobs/{job_id}", params={"force": "true"})
            delete_response.raise_for_status()
        anchor_delete = await runtime_client.delete(f"/v1/jobs/{anchor_id}", params={"force": "true"})
        anchor_delete.raise_for_status()
        verification = await runtime_client.get("/v1/jobs", params={"limit": 1})
        verification.raise_for_status()
        remaining = verification.json().get("jobs")
        return remaining is None or remaining == []
    except Exception:
        return False


async def _create_binding(agent_client: httpx.AsyncClient, block_id: str) -> tuple[str | None, str | None]:
    safe_id = hashlib.sha256(block_id.encode()).hexdigest()[:20]
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
    response.raise_for_status()
    payload = response.json()
    binding_ref = payload.get("binding_ref")
    workspace_ref = payload.get("workspace_ref")
    if not isinstance(binding_ref, str) or not isinstance(workspace_ref, str):
        raise TypeError("binding response did not contain string refs")
    return binding_ref, workspace_ref


async def _destroy_binding(
    agent_client: httpx.AsyncClient,
    *,
    binding_ref: str | None,
    workspace_ref: str | None,
) -> None:
    if binding_ref is None and workspace_ref is None:
        return
    if binding_ref is None or workspace_ref is None:
        raise TypeError("binding and workspace refs must either both be present or both be absent")
    response = await agent_client.post(
        "/execution-bindings/destroy",
        json={
            "binding_ref": binding_ref,
            "destroy_workspace": True,
            "workspace_ref": workspace_ref,
        },
    )
    response.raise_for_status()


async def _prepare_resume_snapshot(
    *,
    scenario: CapabilityBenchmarkScenario,
    settings: CapabilityDriverSettings,
    agent_client: httpx.AsyncClient,
    fake_client: httpx.AsyncClient,
    binding_ref: str | None,
) -> dict[str, object] | None:
    if scenario.workload != "shell_resume":
        return None
    observation = await _run_once(
        sequence=-1,
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


async def _run_warmup(
    *,
    scenario: CapabilityBenchmarkScenario,
    settings: CapabilityDriverSettings,
    agent_client: httpx.AsyncClient,
    runtime_client: httpx.AsyncClient,
    fake_client: httpx.AsyncClient,
    binding_ref: str | None,
    session_snapshot: dict[str, object] | None,
) -> None:
    if scenario.trial_runs is not None:
        count = settings.warmup_runs if settings.warmup_runs is not None else scenario.warmup_runs or 0
        observations = await _run_fixed(
            count=count,
            scenario=scenario,
            settings=settings,
            agent_client=agent_client,
            fake_client=fake_client,
            binding_ref=binding_ref,
            session_snapshot=session_snapshot,
            tracker=None,
        )
    else:
        duration = settings.warmup_seconds if settings.warmup_seconds is not None else scenario.warmup_seconds or 0
        observations = await _run_timed(
            duration_seconds=duration,
            scenario=scenario,
            settings=settings,
            agent_client=agent_client,
            fake_client=fake_client,
            binding_ref=binding_ref,
            session_snapshot=session_snapshot,
            tracker=None,
        )
    if not await _cleanup_drive(runtime_client, observations, scenario=scenario):
        raise RuntimeError("failed to clean capability warmup drive artifacts")


async def _run_measurement(
    *,
    scenario: CapabilityBenchmarkScenario,
    settings: CapabilityDriverSettings,
    agent_client: httpx.AsyncClient,
    fake_client: httpx.AsyncClient,
    binding_ref: str | None,
    session_snapshot: dict[str, object] | None,
    tracker: ActiveRunTracker,
) -> list[CapabilityObservation]:
    if scenario.trial_runs is not None:
        count = settings.trial_runs if settings.trial_runs is not None else scenario.trial_runs
        return await _run_fixed(
            count=count,
            scenario=scenario,
            settings=settings,
            agent_client=agent_client,
            fake_client=fake_client,
            binding_ref=binding_ref,
            session_snapshot=session_snapshot,
            tracker=tracker,
        )
    duration = settings.duration_seconds if settings.duration_seconds is not None else scenario.duration_seconds or 0
    return await _run_timed(
        duration_seconds=duration,
        scenario=scenario,
        settings=settings,
        agent_client=agent_client,
        fake_client=fake_client,
        binding_ref=binding_ref,
        session_snapshot=session_snapshot,
        tracker=tracker,
    )


async def _run_fixed(
    *,
    count: int,
    scenario: CapabilityBenchmarkScenario,
    settings: CapabilityDriverSettings,
    agent_client: httpx.AsyncClient,
    fake_client: httpx.AsyncClient,
    binding_ref: str | None,
    session_snapshot: dict[str, object] | None,
    tracker: ActiveRunTracker | None,
) -> list[CapabilityObservation]:
    semaphore = asyncio.Semaphore(scenario.concurrency)

    async def guarded(index: int) -> CapabilityObservation:
        async with semaphore:
            return await _run_once(
                sequence=index,
                scenario=scenario,
                settings=settings,
                agent_client=agent_client,
                fake_client=fake_client,
                binding_ref=binding_ref,
                session_snapshot=session_snapshot,
                tracker=tracker,
            )

    return list(await asyncio.gather(*(guarded(index) for index in range(count))))


async def _run_timed(
    *,
    duration_seconds: float,
    scenario: CapabilityBenchmarkScenario,
    settings: CapabilityDriverSettings,
    agent_client: httpx.AsyncClient,
    fake_client: httpx.AsyncClient,
    binding_ref: str | None,
    session_snapshot: dict[str, object] | None,
    tracker: ActiveRunTracker | None,
) -> list[CapabilityObservation]:
    deadline = time.perf_counter() + duration_seconds
    observations: list[CapabilityObservation] = []
    lock = asyncio.Lock()

    async def worker(index: int) -> None:
        await asyncio.sleep(index * 0.005)
        sequence = index
        while time.perf_counter() < deadline:
            observation = await _run_once(
                sequence=sequence,
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
            sequence += scenario.concurrency

    await asyncio.gather(*(worker(index) for index in range(scenario.concurrency)))
    return observations


async def _run_once(
    *,
    sequence: int,
    scenario: CapabilityBenchmarkScenario,
    settings: CapabilityDriverSettings,
    agent_client: httpx.AsyncClient,
    fake_client: httpx.AsyncClient,
    binding_ref: str | None,
    session_snapshot: dict[str, object] | None,
    tracker: ActiveRunTracker | None,
    suspend: bool = False,
) -> CapabilityObservation:
    benchmark_run_id = f"{settings.block_id}-{sequence}-{uuid4().hex}"
    prepare = await fake_client.post(
        "/__bench/prepare",
        json={
            "benchmark_run_id": benchmark_run_id,
            "scenario_id": scenario.id,
            "scenario_version": scenario.version,
        },
    )
    prepare.raise_for_status()
    sample = RunSample(
        profile="capability",
        target=settings.target,
        scenario_id=scenario.id,
        block_id=settings.block_id,
        pair_index=settings.pair_index,
        benchmark_run_id=benchmark_run_id,
        payload_bytes=scenario.payload_bytes,
        terminal_status="not_terminal",
    )
    sse_event_ids: list[str] = []
    terminal_snapshot: dict[str, object] | None = None
    started_ns = time.perf_counter_ns()
    try:
        request = build_capability_run_request(
            scenario=scenario,
            benchmark_run_id=benchmark_run_id,
            binding_ref=binding_ref,
            session_snapshot=session_snapshot,
            suspend=suspend,
        )
        response = await agent_client.post("/runs", json=request)
        sample.create_run_http_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
        response.raise_for_status()
        run_id = response.json().get("run_id")
        if not isinstance(run_id, str):
            raise TypeError("create-run response did not contain a string run_id")
        sample.run_id = run_id
        sample.operation_id = run_id
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
                if event_type in _TERMINAL_EVENT_TYPES:
                    terminal_type = cast(str, event_type)
                    data = event.get("data")
                    if isinstance(data, dict) and isinstance(data.get("session_snapshot"), dict):
                        terminal_snapshot = cast(dict[str, object], data["session_snapshot"])
                    break
        if first_event_ns is None or terminal_type is None:
            raise RuntimeError("SSE stream ended before a terminal event")
        sample.time_to_first_event_ms = (first_event_ns - started_ns) / 1_000_000
        sample.terminal_e2e_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
        sample.runtime_overhead_ms = sample.terminal_e2e_ms - scenario.dependency_budget_ms
        terminal_status = cast(
            TerminalStatus,
            {
                "run_succeeded": "succeeded",
                "run_failed": "failed",
                "run_cancelled": "cancelled",
            }[terminal_type],
        )
        sample.terminal_status = terminal_status
        if sample.terminal_status != "succeeded":
            sample.failure_kind = "terminal_failed"
    except Exception as exc:
        failure_kind: FailureKind = "stream_error" if sample.admitted else "admission_error"
        sample.failure_kind = failure_kind
        sample.error = f"{type(exc).__name__}: {exc}"
    finally:
        if sample.admitted and tracker is not None:
            tracker.finished()
    return CapabilityObservation(
        sample=sample,
        sse_event_ids=sse_event_ids,
        session_snapshot=terminal_snapshot,
    )


def build_capability_run_request(
    *,
    scenario: CapabilityBenchmarkScenario,
    benchmark_run_id: str,
    binding_ref: str | None,
    session_snapshot: dict[str, object] | None,
    suspend: bool,
) -> dict[str, object]:
    credentials = {
        "benchmark_profile": "capability",
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
            "config": {"prefix": "deterministic capability benchmark", "user": "execute the benchmark plan"},
        },
        {"name": "execution_context", "type": "dify.execution_context", "config": execution_context},
    ]
    shell_layer: dict[str, object] = {
            "name": "shell",
            "type": "dify.shell",
            "deps": {"execution_context": "execution_context"},
            "config": {"agent_stub_drive_ref": f"agent-{benchmark_run_id}"},
    }
    if binding_ref is not None:
        layers.append(
            {
                "name": "runtime",
                "type": "dify.runtime",
                "config": {"backend_binding_ref": binding_ref},
            }
        )
        shell_layer["deps"] = {"execution_context": "execution_context", "runtime": "runtime"}
    layers.append(shell_layer)
    if scenario.workload == "config_pull":
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
    if scenario.workload == "drive_pull":
        keys = [f"drive/file-{index}.bin" for index in range(scenario.drive_file_count)]
        layers.append(
            {
                "name": "drive",
                "type": "dify.drive",
                "deps": {"shell": "shell"},
                "config": {
                    "drive_ref": f"agent-{benchmark_run_id}",
                    "skills": [],
                    "mentioned_skill_keys": [],
                    "mentioned_file_keys": keys,
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
            "benchmark_profile": "capability",
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
    observations: list[CapabilityObservation],
    scenario: CapabilityBenchmarkScenario,
    agent_client: httpx.AsyncClient,
    fake_client: httpx.AsyncClient,
) -> None:
    semaphore = asyncio.Semaphore(max(1, min(scenario.concurrency, 10)))

    async def validate(observation: CapabilityObservation) -> None:
        async with semaphore:
            sample = observation.sample
            if sample.run_id is None:
                return
            try:
                replay_ids = await _read_event_ids(agent_client, sample.run_id)
                sample.event_replay_valid = replay_ids == observation.sse_event_ids
                response = await fake_client.get(f"/__bench/ledgers/{sample.benchmark_run_id}")
                response.raise_for_status()
                ledger = FakeDependencyLedger.model_validate(response.json())
                observation.ledger = ledger
                sample.fake_model_start_elapsed_ms = ledger.model_start_elapsed_ms
                sample.fake_tool_elapsed_ms = ledger.tool_elapsed_ms
                sample.fake_stub_elapsed_ms = ledger.stub_elapsed_ms
                sample.ledger_valid = validate_capability_ledger(ledger=ledger, scenario=scenario)
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
            raise TypeError("event replay response did not contain events")
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


def validate_capability_ledger(
    *,
    ledger: FakeDependencyLedger,
    scenario: CapabilityBenchmarkScenario,
) -> bool:
    expected_calls: dict[str, int] = {}
    expected_payload_bytes = 0
    if scenario.workload == "config_pull":
        expected_calls = {
            "config_skill_pull": scenario.config_skill_count,
            "config_file_pull": scenario.config_file_count,
        }
        expected_payload_bytes = (scenario.config_skill_count + scenario.config_file_count) * scenario.item_bytes
    elif scenario.workload == "drive_pull":
        expected_calls = {
            "drive_manifest": scenario.drive_file_count,
            "drive_download": scenario.drive_file_count,
        }
        expected_payload_bytes = scenario.drive_file_count * scenario.item_bytes
    elif scenario.workload == "file_roundtrip":
        expected_calls = {
            "file_upload_request": 1,
            "signed_upload": 1,
            "file_download_request": 2,
            "signed_download": 1,
        }
        expected_payload_bytes = scenario.payload_bytes * 2
    return (
        ledger.profile == "capability"
        and ledger.scenario_id == scenario.id
        and ledger.scenario_version == scenario.version
        and ledger.model_calls == scenario.model_rounds
        and len(ledger.model_start_elapsed_ms) == scenario.model_rounds
        and ledger.tool_calls == scenario.tool_rounds
        and ledger.text_chunks == scenario.text_chunks
        and ledger.model_stream_items == scenario.expected_model_stream_items
        and ledger.stub_calls == expected_calls
        and len(ledger.stub_elapsed_ms) == sum(expected_calls.values())
        and ledger.payload_bytes == expected_payload_bytes
        and len(ledger.payload_sha256) == sum(
            count for name, count in expected_calls.items() if name in {"config_skill_pull", "config_file_pull", "drive_download", "signed_upload", "signed_download"}
        )
        and ledger.dependency_budget_ms == scenario.dependency_budget_ms
    )


def summarize_capability_outcomes(
    *,
    samples: list[RunSample],
    elapsed_seconds: float,
    max_active: int,
) -> RunOutcomeSummary:
    attempted = len(samples)
    admitted = sum(sample.admitted for sample in samples)
    terminal = sum(sample.terminal_status in {"succeeded", "failed", "cancelled"} for sample in samples)
    successful = sum(sample.terminal_status == "succeeded" for sample in samples)
    times = [
        sample.terminal_e2e_ms
        for sample in samples
        if sample.terminal_status == "succeeded" and sample.terminal_e2e_ms is not None
    ]
    throughput = successful / elapsed_seconds if elapsed_seconds else 0
    payload_bytes = sum(sample.payload_bytes for sample in samples if sample.terminal_status == "succeeded")
    successful_events = sum(sample.event_count for sample in samples if sample.terminal_status == "succeeded")
    return RunOutcomeSummary(
        attempted_runs=attempted,
        admitted_runs=admitted,
        terminal_runs=terminal,
        successful_runs=successful,
        admission_rate=admitted / attempted if attempted else 0,
        terminal_rate=terminal / admitted if admitted else 0,
        success_rate=successful / terminal if terminal else 0,
        terminal_runs_per_second=terminal / elapsed_seconds if elapsed_seconds else 0,
        successful_runs_per_second=throughput,
        successful_operations_per_second=throughput,
        service_time_mean_ms=sum(times) / len(times) if times else None,
        useful_payload_mib_per_second=payload_bytes / (1024**2) / elapsed_seconds if payload_bytes else None,
        events_per_successful_run=successful_events / successful if successful else 0,
        max_active_runs=max_active,
    )


def _behavior_counts(observations: list[CapabilityObservation], successful: int) -> dict[str, float]:
    if successful <= 0:
        return {}
    totals: dict[str, int] = {}
    for observation in observations:
        if observation.sample.terminal_status != "succeeded" or observation.ledger is None:
            continue
        for name, count in observation.ledger.stub_calls.items():
            totals[f"stub:{name}"] = totals.get(f"stub:{name}", 0) + count
    return {name: count / successful for name, count in sorted(totals.items())}


def _invalid_reasons(
    *,
    samples: list[RunSample],
    redis_before: RedisSnapshot,
    redis_after: RedisSnapshot,
    jobs_empty: bool,
) -> list[str]:
    reasons: list[str] = []
    if not samples:
        reasons.append("measurement produced no capability runs")
    if any(sample.terminal_status != "succeeded" for sample in samples):
        reasons.append("one or more capability runs did not succeed")
    if any(not sample.ledger_valid for sample in samples):
        reasons.append("one or more capability ledgers had incorrect calls, bytes, or checksums")
    if any(not sample.event_replay_valid for sample in samples):
        reasons.append("one or more SSE event sequences differed from Redis replay")
    if not jobs_empty:
        reasons.append("shellctl jobs remained after binding cleanup")
    if redis_after.evicted_keys > redis_before.evicted_keys:
        reasons.append("Redis evicted benchmark keys")
    if redis_after.rejected_connections > redis_before.rejected_connections:
        reasons.append("Redis rejected benchmark connections")
    return reasons


async def _reset(redis: Redis, fake_client: httpx.AsyncClient) -> None:
    await redis.flushdb()
    response = await fake_client.post("/__bench/reset")
    response.raise_for_status()


def _apply_overrides(
    scenario: CapabilityBenchmarkScenario,
    settings: CapabilityDriverSettings,
) -> CapabilityBenchmarkScenario:
    updates: dict[str, int | float | None] = {}
    if settings.trial_runs is not None:
        updates.update(trial_runs=settings.trial_runs, duration_seconds=None)
    if settings.duration_seconds is not None:
        updates.update(duration_seconds=settings.duration_seconds, trial_runs=None)
    if settings.warmup_runs is not None:
        updates.update(warmup_runs=settings.warmup_runs, warmup_seconds=None)
    if settings.warmup_seconds is not None:
        updates.update(warmup_seconds=settings.warmup_seconds, warmup_runs=None)
    return CapabilityBenchmarkScenario.model_validate(scenario.model_dump() | updates)


def _write_artifacts(results_dir: Path, result: BlockResult) -> None:
    (results_dir / "block-result.json").write_text(result.model_dump_json(indent=2))
    with (results_dir / "samples.jsonl").open("w") as output:
        for sample in result.samples:
            output.write(sample.model_dump_json())
            output.write("\n")
    if result.redis_before is not None:
        (results_dir / "redis-before.json").write_text(result.redis_before.model_dump_json(indent=2))
    if result.redis_after is not None:
        (results_dir / "redis-after.json").write_text(result.redis_after.model_dump_json(indent=2))


def _required_environment(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ValueError(f"{name} is required")
    return value


def _optional_int_environment(name: str) -> int | None:
    value = os.environ.get(name)
    return int(value) if value else None


def _optional_float_environment(name: str) -> float | None:
    value = os.environ.get(name)
    return float(value) if value else None


async def main() -> int:
    result = await run_block(CapabilityDriverSettings.from_environment())
    return 0 if result.valid else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))


__all__ = [
    "CapabilityDriverSettings",
    "build_capability_run_request",
    "run_block",
    "summarize_capability_outcomes",
    "validate_capability_ledger",
]
