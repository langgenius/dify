"""Direct shellctl HTTP driver for deterministic Runtime profile workloads."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import time
from typing import cast
from uuid import uuid4

import httpx

from benchmarks.scenario import RuntimeBenchmarkScenario, load_scenario_manifest
from benchmarks.schemas import BlockResult, FailureKind, RunOutcomeSummary, RunSample, TargetKind


_START_MARKER = "<<<DIFY_BENCH_START>>>"
_OUTPUT_LIMIT = 512 * 1024


@dataclass(slots=True, frozen=True)
class RuntimeDriverSettings:
    runtime_url: str
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
    def from_environment(cls) -> "RuntimeDriverSettings":
        target = os.environ.get("BENCH_TARGET", "candidate")
        if target not in {"baseline", "candidate"}:
            raise ValueError("BENCH_TARGET must be baseline or candidate")
        return cls(
            runtime_url=os.environ.get("BENCH_RUNTIME_URL", "http://runtime:5004").rstrip("/"),
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
class RuntimeObservation:
    sample: RunSample
    job_id: str | None


@dataclass(slots=True)
class ActiveOperationTracker:
    active: int = 0
    peak: int = 0

    def admitted(self) -> None:
        self.active += 1
        self.peak = max(self.peak, self.active)

    def finished(self) -> None:
        self.active -= 1


async def run_block(settings: RuntimeDriverSettings) -> BlockResult:
    loaded = load_scenario_manifest(profile="runtime").get(settings.scenario_id)
    if not isinstance(loaded, RuntimeBenchmarkScenario):
        raise TypeError(f"{settings.scenario_id} is not a Runtime benchmark scenario")
    scenario = _apply_overrides(loaded, settings)
    settings.results_dir.mkdir(parents=True, exist_ok=True)
    limits = httpx.Limits(max_connections=max(20, scenario.concurrency * 3), max_keepalive_connections=20)
    timeout = httpx.Timeout(connect=10, read=120, write=30, pool=10)
    async with httpx.AsyncClient(base_url=settings.runtime_url, timeout=timeout, limits=limits) as client:
        await _delete_all_jobs(client)
        await _run_warmup(scenario=scenario, settings=settings, client=client)
        await _delete_all_jobs(client)

        tracker = ActiveOperationTracker()
        measurement_started_at_ns = time.time_ns()
        started_perf_ns = time.perf_counter_ns()
        observations = await _run_measurement(
            scenario=scenario,
            settings=settings,
            client=client,
            tracker=tracker,
        )
        elapsed_seconds = (time.perf_counter_ns() - started_perf_ns) / 1_000_000_000
        measurement_ended_at_ns = time.time_ns()

        await _delete_observations(client, observations)
        await _delete_all_jobs(client)
        jobs_response = await client.get("/v1/jobs", params={"limit": 200})
        jobs_response.raise_for_status()
        jobs = jobs_response.json().get("jobs")
        jobs_empty = jobs is None or (isinstance(jobs, list) and not jobs)
        (settings.results_dir / "runtime-jobs-after.json").write_text(
            json.dumps(jobs_response.json(), indent=2, sort_keys=True)
        )

    samples = [observation.sample for observation in observations]
    outcomes = summarize_runtime_outcomes(
        samples=samples,
        elapsed_seconds=elapsed_seconds,
        max_active=tracker.peak,
    )
    invalid_reasons = _invalid_reasons(samples=samples, jobs_empty=jobs_empty)
    result = BlockResult(
        profile="runtime",
        target=settings.target,
        target_id=settings.target_id,
        scenario_id=scenario.id,
        scenario_version=scenario.version,
        block_id=settings.block_id,
        pair_index=settings.pair_index,
        measurement_started_at_ns=measurement_started_at_ns,
        measurement_ended_at_ns=measurement_ended_at_ns,
        outcomes=outcomes,
        samples=samples,
        behavior_counts={"shell_jobs_per_operation": 1.0},
        cleanup={"jobs_empty": jobs_empty},
        valid=not invalid_reasons,
        invalid_reasons=invalid_reasons,
    )
    _write_artifacts(settings.results_dir, result)
    return result


async def _run_warmup(
    *,
    scenario: RuntimeBenchmarkScenario,
    settings: RuntimeDriverSettings,
    client: httpx.AsyncClient,
) -> None:
    if scenario.trial_runs is not None:
        count = settings.warmup_runs if settings.warmup_runs is not None else scenario.warmup_runs or 0
        observations = await _run_fixed(
            count=count,
            scenario=scenario,
            settings=settings,
            client=client,
            tracker=None,
        )
    else:
        duration = settings.warmup_seconds if settings.warmup_seconds is not None else scenario.warmup_seconds or 0
        observations = await _run_timed(
            duration_seconds=duration,
            scenario=scenario,
            settings=settings,
            client=client,
            tracker=None,
        )
    await _delete_observations(client, observations)


async def _run_measurement(
    *,
    scenario: RuntimeBenchmarkScenario,
    settings: RuntimeDriverSettings,
    client: httpx.AsyncClient,
    tracker: ActiveOperationTracker,
) -> list[RuntimeObservation]:
    if scenario.trial_runs is not None:
        count = settings.trial_runs if settings.trial_runs is not None else scenario.trial_runs
        return await _run_fixed(
            count=count,
            scenario=scenario,
            settings=settings,
            client=client,
            tracker=tracker,
        )
    duration = settings.duration_seconds if settings.duration_seconds is not None else scenario.duration_seconds or 0
    return await _run_timed(
        duration_seconds=duration,
        scenario=scenario,
        settings=settings,
        client=client,
        tracker=tracker,
    )


async def _run_fixed(
    *,
    count: int,
    scenario: RuntimeBenchmarkScenario,
    settings: RuntimeDriverSettings,
    client: httpx.AsyncClient,
    tracker: ActiveOperationTracker | None,
) -> list[RuntimeObservation]:
    semaphore = asyncio.Semaphore(scenario.concurrency)

    async def guarded(index: int) -> RuntimeObservation:
        async with semaphore:
            return await _run_once(
                sequence=index,
                scenario=scenario,
                settings=settings,
                client=client,
                tracker=tracker,
            )

    return list(await asyncio.gather(*(guarded(index) for index in range(count))))


async def _run_timed(
    *,
    duration_seconds: float,
    scenario: RuntimeBenchmarkScenario,
    settings: RuntimeDriverSettings,
    client: httpx.AsyncClient,
    tracker: ActiveOperationTracker | None,
) -> list[RuntimeObservation]:
    deadline = time.perf_counter() + duration_seconds
    observations: list[RuntimeObservation] = []
    lock = asyncio.Lock()

    async def worker(index: int) -> None:
        await asyncio.sleep(index * 0.002)
        sequence = index
        while time.perf_counter() < deadline:
            observation = await _run_once(
                sequence=sequence,
                scenario=scenario,
                settings=settings,
                client=client,
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
    scenario: RuntimeBenchmarkScenario,
    settings: RuntimeDriverSettings,
    client: httpx.AsyncClient,
    tracker: ActiveOperationTracker | None,
) -> RuntimeObservation:
    operation_id = f"{settings.block_id}-{sequence}-{uuid4().hex}"
    sample = RunSample(
        profile="runtime",
        target=settings.target,
        scenario_id=scenario.id,
        block_id=settings.block_id,
        pair_index=settings.pair_index,
        benchmark_run_id=operation_id,
        operation_id=operation_id,
        payload_bytes=scenario.payload_bytes,
        terminal_status="not_terminal",
    )
    started_ns = time.perf_counter_ns()
    job_id: str | None = None
    output = ""
    first_output_ns: int | None = None
    tracker_started = False
    try:
        if tracker is not None:
            tracker.admitted()
            tracker_started = True
        response = await client.post(
            "/v1/jobs/run",
            json={
                "script": _script_for(scenario, operation_id),
                "cwd": "/state",
                "timeout": 120,
                "output_limit": _OUTPUT_LIMIT,
                "idle_flush_seconds": 0.01,
            },
        )
        sample.create_run_http_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
        response.raise_for_status()
        result = response.json()
        job_id_value = result.get("job_id")
        if not isinstance(job_id_value, str):
            raise TypeError("shellctl response did not contain a string job_id")
        job_id = job_id_value
        sample.run_id = job_id
        sample.operation_id = job_id
        sample.admitted = True
        output, first_output_ns, result = await _collect_job_output(
            client=client,
            initial=result,
            output=output,
            started_ns=started_ns,
            first_output_ns=first_output_ns,
        )
        sample.terminal_e2e_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
        sample.runtime_overhead_ms = sample.terminal_e2e_ms
        sample.first_output_ms = (
            (first_output_ns - started_ns) / 1_000_000 if first_output_ns is not None else None
        )
        sample.time_to_first_event_ms = sample.first_output_ms
        sample.output_bytes = len(output.encode())
        sample.output_sha256 = hashlib.sha256(output.encode()).hexdigest()
        exit_code = result.get("exit_code")
        sample.exit_code = exit_code if isinstance(exit_code, int) else None
        sample.terminal_status = "succeeded" if result.get("status") == "exited" and exit_code == 0 else "failed"
        if sample.terminal_status != "succeeded":
            sample.failure_kind = "terminal_failed"
            sample.error = (
                f"unexpected shellctl terminal status={result.get('status')!r} "
                f"exit_code={exit_code!r}"
            )
        sample.ledger_valid = _validate_output(scenario, output)
        sample.event_replay_valid = True
        if not sample.ledger_valid:
            sample.failure_kind = "validation_error"
    except Exception as exc:
        failure_kind: FailureKind = "stream_error" if sample.admitted else "admission_error"
        sample.failure_kind = failure_kind
        sample.error = f"{type(exc).__name__}: {exc}"
    finally:
        if tracker_started and tracker is not None:
            tracker.finished()
    return RuntimeObservation(sample=sample, job_id=job_id)


async def _collect_job_output(
    *,
    client: httpx.AsyncClient,
    initial: dict[str, object],
    output: str,
    started_ns: int,
    first_output_ns: int | None,
) -> tuple[str, int | None, dict[str, object]]:
    result = initial
    offset = 0
    while True:
        chunk = result.get("output")
        if isinstance(chunk, str):
            output += chunk
            if first_output_ns is None and _START_MARKER in output:
                first_output_ns = time.perf_counter_ns()
        next_offset = result.get("offset")
        if isinstance(next_offset, int):
            offset = next_offset
        if result.get("done") is True and result.get("truncated") is not True:
            return output, first_output_ns, result
        job_id = result.get("job_id")
        if not isinstance(job_id, str):
            raise TypeError("shellctl wait response lost job_id")
        response = await client.post(
            f"/v1/jobs/{job_id}/wait",
            json={
                "timeout": 10,
                "offset": offset,
                "output_limit": _OUTPUT_LIMIT,
                "idle_flush_seconds": 0.01,
            },
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise TypeError("shellctl wait response must be a JSON object")
        result = cast(dict[str, object], payload)


def _script_for(scenario: RuntimeBenchmarkScenario, operation_id: str) -> str:
    root = f"/state/bench-workspaces/{operation_id}"
    marker = f"printf '%s\\n' '{_START_MARKER}'"
    if scenario.workload == "noop":
        return f"set -eu\n{marker}\nprintf '{{\"ok\":true}}\\n'"
    if scenario.workload == "output":
        return "\n".join(
            [
                "set -eu",
                marker,
                f"python -c \"import sys; sys.stdout.write('x' * {scenario.output_bytes})\"",
            ]
        )
    if scenario.workload == "many_files":
        return "\n".join(
            [
                "set -eu",
                marker,
                "python - <<'PY'",
                "import hashlib, json, pathlib, shutil",
                f"root = pathlib.Path({root!r})",
                "root.mkdir(parents=True, exist_ok=False)",
                "digest = hashlib.sha256()",
                f"for index in range({scenario.file_count}):",
                "    seed = hashlib.sha256(str(index).encode()).digest()",
                f"    data = (seed * (({scenario.file_bytes} + len(seed) - 1) // len(seed)))[:{scenario.file_bytes}]",
                "    path = root / f'{index:04d}.bin'",
                "    path.write_bytes(data)",
                "for path in sorted(root.iterdir()):",
                "    digest.update(path.read_bytes())",
                f"payload_bytes = {scenario.file_count * scenario.file_bytes}",
                "shutil.rmtree(root)",
                "print(json.dumps({'payload_bytes': payload_bytes, 'sha256': digest.hexdigest()}))",
                "PY",
            ]
        )
    return "\n".join(
        [
            "set -eu",
            marker,
            "python - <<'PY'",
            "import hashlib, json, pathlib, shutil",
            f"root = pathlib.Path({root!r})",
            "root.mkdir(parents=True, exist_ok=False)",
            "path = root / 'payload.bin'",
            f"size = {scenario.payload_bytes}",
            "pattern = bytes(range(256))",
            "data = (pattern * ((size + 255) // 256))[:size]",
            "path.write_bytes(data)",
            "payload = path.read_bytes()",
            "digest = hashlib.sha256(payload).hexdigest()",
            "shutil.rmtree(root)",
            "print(json.dumps({'payload_bytes': len(payload), 'sha256': digest}))",
            "PY",
        ]
    )


def _validate_output(scenario: RuntimeBenchmarkScenario, output: str) -> bool:
    if _START_MARKER not in output:
        return False
    payload = output.split(_START_MARKER, 1)[1].lstrip("\r\n")
    if scenario.workload == "noop":
        return '"ok":true' in payload.replace(" ", "")
    if scenario.workload == "output":
        normalized = payload.replace("\r", "").replace("\n", "")
        return len(normalized) == scenario.output_bytes and hashlib.sha256(normalized.encode()).hexdigest() == hashlib.sha256(
            b"x" * scenario.output_bytes
        ).hexdigest()
    try:
        record = json.loads(payload.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError):
        return False
    expected_hash = _expected_file_hash(scenario)
    return record.get("payload_bytes") == scenario.payload_bytes and record.get("sha256") == expected_hash


def _expected_file_hash(scenario: RuntimeBenchmarkScenario) -> str:
    digest = hashlib.sha256()
    if scenario.workload == "many_files":
        for index in range(scenario.file_count):
            seed = hashlib.sha256(str(index).encode()).digest()
            digest.update((seed * ((scenario.file_bytes + len(seed) - 1) // len(seed)))[: scenario.file_bytes])
        return digest.hexdigest()
    pattern = bytes(range(256))
    remaining = scenario.payload_bytes
    while remaining:
        chunk = pattern[: min(remaining, len(pattern))]
        digest.update(chunk)
        remaining -= len(chunk)
    return digest.hexdigest()


async def _delete_observations(client: httpx.AsyncClient, observations: list[RuntimeObservation]) -> None:
    for observation in observations:
        if observation.job_id is None:
            continue
        started_ns = time.perf_counter_ns()
        try:
            response = await client.delete(f"/v1/jobs/{observation.job_id}", params={"force": "true"})
            response.raise_for_status()
            observation.sample.cleanup_valid = response.json().get("deleted") is True
        except Exception as exc:
            observation.sample.cleanup_valid = False
            observation.sample.error = observation.sample.error or f"delete failed: {type(exc).__name__}: {exc}"
        observation.sample.delete_ms = (time.perf_counter_ns() - started_ns) / 1_000_000


async def _delete_all_jobs(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/jobs", params={"limit": 200})
    response.raise_for_status()
    jobs = response.json().get("jobs", [])
    if jobs is None:
        return
    if not isinstance(jobs, list):
        raise TypeError("shellctl jobs response must contain a list")
    for job in jobs:
        if isinstance(job, dict) and isinstance(job.get("job_id"), str):
            delete_response = await client.delete(f"/v1/jobs/{job['job_id']}", params={"force": "true"})
            delete_response.raise_for_status()


def summarize_runtime_outcomes(
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
        max_active_runs=max_active,
    )


def _invalid_reasons(*, samples: list[RunSample], jobs_empty: bool) -> list[str]:
    reasons: list[str] = []
    if not samples:
        reasons.append("measurement produced no Runtime operations")
    if any(sample.terminal_status != "succeeded" or sample.exit_code != 0 for sample in samples):
        reasons.append("one or more shellctl jobs did not succeed with exit code zero")
    if any(not sample.ledger_valid for sample in samples):
        reasons.append("one or more Runtime outputs or checksums were invalid")
    if any(not sample.cleanup_valid for sample in samples):
        reasons.append("one or more measured shellctl jobs were not deleted")
    if not jobs_empty:
        reasons.append("shellctl jobs remained after explicit cleanup")
    return reasons


def _apply_overrides(
    scenario: RuntimeBenchmarkScenario,
    settings: RuntimeDriverSettings,
) -> RuntimeBenchmarkScenario:
    updates: dict[str, int | float | None] = {}
    if settings.trial_runs is not None:
        updates.update(trial_runs=settings.trial_runs, duration_seconds=None)
    if settings.duration_seconds is not None:
        updates.update(duration_seconds=settings.duration_seconds, trial_runs=None)
    if settings.warmup_runs is not None:
        updates.update(warmup_runs=settings.warmup_runs, warmup_seconds=None)
    if settings.warmup_seconds is not None:
        updates.update(warmup_seconds=settings.warmup_seconds, warmup_runs=None)
    return RuntimeBenchmarkScenario.model_validate(scenario.model_dump() | updates)


def _write_artifacts(results_dir: Path, result: BlockResult) -> None:
    (results_dir / "block-result.json").write_text(result.model_dump_json(indent=2))
    with (results_dir / "samples.jsonl").open("w") as output:
        for sample in result.samples:
            output.write(sample.model_dump_json())
            output.write("\n")


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
    result = await run_block(RuntimeDriverSettings.from_environment())
    return 0 if result.valid else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))


__all__ = [
    "RuntimeDriverSettings",
    "run_block",
    "summarize_runtime_outcomes",
]
