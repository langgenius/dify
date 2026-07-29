"""Build and run local Docker baseline/candidate service benchmarks.

The orchestrator owns only benchmark-prefixed Compose projects and temporary
source archives. It never stops or deletes unrelated Docker resources. Runtime
regression classifications are report-only; command failure is reserved for
environment, workload, or correctness failures.
"""

from __future__ import annotations

import argparse
from collections.abc import Callable, Iterable, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import io
import json
import logging
import math
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile
from typing import Iterator, Literal

from benchmarks.comparison import (
    compare_blocked_quantile_latency,
    compare_paired_blocks,
    compare_redis_commands,
)
from benchmarks.docker_stats import DockerStatsSampler, summarize_resource_window
from benchmarks.scenario import load_scenario_manifest
from benchmarks.schemas import (
    BlockResult,
    ComparisonReport,
    EnvironmentFingerprint,
    MetricComparison,
    RunSample,
    ScenarioComparison,
    TargetIdentity,
    TargetKind,
    TargetResult,
)


logger = logging.getLogger(__name__)

_HARNESS_VERSION = 2
_PYTHON_BASE_IMAGE = "python:3.12-slim-bookworm"
_REDIS_IMAGE = (
    "redis:7.4.10-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2"
)
_PRODUCTION_INPUTS = (
    "dify-agent/src",
    "dify-agent/pyproject.toml",
    "dify-agent/uv.lock",
    "dify-agent/Dockerfile",
)
_ABBA: tuple[tuple[TargetKind, int], ...] = (
    ("baseline", 0),
    ("candidate", 0),
    ("candidate", 1),
    ("baseline", 1),
)


@dataclass(slots=True, frozen=True)
class RunOptions:
    """Resolved command-line options for one local invocation."""

    baseline_ref: str
    candidate_ref: str | None
    keep_containers: bool
    quick: bool
    scenario_ids: tuple[str, ...]
    results_root: Path | None


class BenchmarkCommandError(RuntimeError):
    """Raised for an environment or correctness failure that must stop the run."""


def repository_root() -> Path:
    """Return the Git repository root containing ``dify-agent``."""
    return Path(__file__).resolve().parents[2]


def run_ab(options: RunOptions) -> Path:
    """Build both targets, execute ABBA blocks, and write report-only comparison artifacts."""
    root = repository_root()
    _verify_docker_environment(root)
    manifest = load_scenario_manifest()
    scenario_ids = options.scenario_ids or tuple(scenario.id for scenario in manifest.scenarios)
    for scenario_id in scenario_ids:
        _ = manifest.get(scenario_id)

    run_id = _new_run_id()
    results_root = options.results_root or root / "dify-agent" / "benchmarks" / "results"
    invocation_dir = (results_root / f"{run_id}-ab").resolve()
    invocation_dir.mkdir(parents=True)
    python_base_image_id = _prepare_python_base_image()
    harness_image = _build_harness_image(root)
    baseline = _build_target_image(root, kind="baseline", ref=options.baseline_ref)
    candidate = _build_target_image(root, kind="candidate", ref=options.candidate_ref)
    environment = _capture_environment(root, python_base_image_id=python_base_image_id)
    (invocation_dir / "environment.json").write_text(environment.model_dump_json(indent=2))
    (invocation_dir / "baseline-identity.json").write_text(baseline.model_dump_json(indent=2))
    (invocation_dir / "candidate-identity.json").write_text(candidate.model_dump_json(indent=2))
    logger.info("benchmark results: %s", invocation_dir)

    blocks: list[BlockResult] = []
    for scenario_id in scenario_ids:
        for position, (kind, pair_index) in enumerate(_ABBA):
            identity = baseline if kind == "baseline" else candidate
            block_id = f"{scenario_id}-{kind}-{pair_index}"
            block_dir = invocation_dir / "blocks" / block_id
            block = _run_compose_block(
                root=root,
                invocation_id=run_id,
                block_position=position,
                identity=identity,
                harness_image=harness_image,
                scenario_id=scenario_id,
                block_id=block_id,
                pair_index=pair_index,
                block_dir=block_dir,
                keep_containers=options.keep_containers,
                quick=options.quick,
            )
            blocks.append(block)

    baseline_result = TargetResult(
        target=baseline,
        environment=environment,
        blocks=[block for block in blocks if block.target == "baseline"],
    )
    candidate_result = TargetResult(
        target=candidate,
        environment=environment,
        blocks=[block for block in blocks if block.target == "candidate"],
    )
    comparison = build_comparison(
        baseline_result=baseline_result,
        candidate_result=candidate_result,
        scenario_ids=scenario_ids,
    )
    _write_invocation_artifacts(
        invocation_dir=invocation_dir,
        baseline_result=baseline_result,
        candidate_result=candidate_result,
        comparison=comparison,
    )
    if not comparison.compatible or comparison.overall_verdict == "invalid":
        raise BenchmarkCommandError(f"benchmark correctness failed; inspect {invocation_dir}")
    logger.info("overall local A/B verdict: %s", comparison.overall_verdict)
    return invocation_dir


def run_smoke(*, keep_containers: bool, results_root: Path | None = None) -> Path:
    """Build the current worktree and execute a two-run Docker correctness smoke."""
    root = repository_root()
    _verify_docker_environment(root)
    run_id = _new_run_id()
    resolved_results_root = results_root or root / "dify-agent" / "benchmarks" / "results"
    invocation_dir = (resolved_results_root / f"{run_id}-smoke").resolve()
    invocation_dir.mkdir(parents=True)
    python_base_image_id = _prepare_python_base_image()
    harness_image = _build_harness_image(root)
    candidate = _build_target_image(root, kind="candidate", ref=None)
    environment = _capture_environment(root, python_base_image_id=python_base_image_id)
    (invocation_dir / "environment.json").write_text(environment.model_dump_json(indent=2))
    (invocation_dir / "candidate-identity.json").write_text(candidate.model_dump_json(indent=2))
    block = _run_compose_block(
        root=root,
        invocation_id=run_id,
        block_position=0,
        identity=candidate,
        harness_image=harness_image,
        scenario_id="single_1_chunk_c1",
        block_id="smoke-candidate-0",
        pair_index=0,
        block_dir=invocation_dir / "blocks" / "smoke-candidate-0",
        keep_containers=keep_containers,
        quick=True,
    )
    result = TargetResult(target=candidate, environment=environment, blocks=[block])
    (invocation_dir / "candidate-result.json").write_text(result.model_dump_json(indent=2))
    if not block.valid:
        raise BenchmarkCommandError(f"Docker smoke failed; inspect {invocation_dir}")
    logger.info("Docker benchmark smoke passed: %s", invocation_dir)
    return invocation_dir


def build_comparison(
    *,
    baseline_result: TargetResult,
    candidate_result: TargetResult,
    scenario_ids: Sequence[str],
) -> ComparisonReport:
    """Create scenario comparisons from paired ABBA block results."""
    compatibility_errors = _compatibility_errors(baseline_result, candidate_result)
    scenario_comparisons = [
        _compare_scenario(
            scenario_id=scenario_id,
            baseline_blocks=[block for block in baseline_result.blocks if block.scenario_id == scenario_id],
            candidate_blocks=[block for block in candidate_result.blocks if block.scenario_id == scenario_id],
        )
        for scenario_id in scenario_ids
    ]
    compatible = not compatibility_errors
    if not compatible or any(not comparison.valid for comparison in scenario_comparisons):
        overall: Literal["no_regression", "possible_regression", "inconclusive", "invalid"] = "invalid"
    elif any(
        metric.verdict in {"possible_regression", "behavior_change"}
        for comparison in scenario_comparisons
        for metric in _decision_metrics(comparison)
    ):
        overall = "possible_regression"
    elif any(
        metric.verdict in {"inconclusive", "unavailable"}
        for comparison in scenario_comparisons
        for metric in _decision_metrics(comparison)
    ):
        overall = "inconclusive"
    else:
        overall = "no_regression"
    return ComparisonReport(
        baseline=baseline_result.target,
        candidate=candidate_result.target,
        environment=baseline_result.environment,
        compatible=compatible,
        compatibility_errors=compatibility_errors,
        overall_verdict=overall,
        scenarios=scenario_comparisons,
    )


def _compare_scenario(
    *,
    scenario_id: str,
    baseline_blocks: list[BlockResult],
    candidate_blocks: list[BlockResult],
) -> ScenarioComparison:
    invalid_reasons = [
        f"{block.block_id}: {reason}"
        for block in [*baseline_blocks, *candidate_blocks]
        for reason in block.invalid_reasons
    ]
    baseline_by_pair = {block.pair_index: block for block in baseline_blocks}
    candidate_by_pair = {block.pair_index: block for block in candidate_blocks}
    if set(baseline_by_pair) != {0, 1} or set(candidate_by_pair) != {0, 1}:
        invalid_reasons.append("scenario does not contain both ABBA pairs")
    create_baseline, create_candidate = _sample_blocks_by_pair(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda sample: sample.create_run_http_ms,
    )
    first_event_baseline, first_event_candidate = _sample_blocks_by_pair(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda sample: sample.time_to_first_event_ms,
    )
    terminal_e2e_baseline, terminal_e2e_candidate = _sample_blocks_by_pair(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda sample: sample.terminal_e2e_ms,
    )
    overhead_baseline, overhead_candidate = _sample_blocks_by_pair(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda sample: sample.runtime_overhead_ms,
    )
    admission_baseline, admission_candidate = _paired_block_metric(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda block: block.outcomes.admission_rate,
    )
    terminal_rate_baseline, terminal_rate_candidate = _paired_block_metric(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda block: block.outcomes.terminal_rate,
    )
    success_rate_baseline, success_rate_candidate = _paired_block_metric(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda block: block.outcomes.success_rate,
    )
    events_per_run_baseline, events_per_run_candidate = _paired_block_metric(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda block: block.outcomes.events_per_successful_run,
    )
    terminal_throughput_baseline, terminal_throughput_candidate = _paired_block_metric(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda block: block.outcomes.terminal_runs_per_second,
    )
    successful_throughput_baseline, successful_throughput_candidate = _paired_block_metric(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda block: block.outcomes.successful_runs_per_second,
    )
    max_active_baseline, max_active_candidate = _paired_block_metric(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda block: float(block.outcomes.max_active_runs),
    )
    cpu_baseline, cpu_candidate = _paired_block_metric(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda block: block.resources.agent_cpu_seconds_per_successful_run,
    )
    peak_memory_baseline, peak_memory_candidate = _paired_block_metric(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda block: _optional_float(block.resources.agent_peak_memory_delta_bytes),
    )
    agent_memory_baseline, agent_memory_candidate = _paired_block_metric(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda block: block.resources.agent_memory_gb_seconds_per_successful_run,
    )
    agent_network_baseline, agent_network_candidate = _paired_block_metric(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda block: block.resources.agent_network_bytes_per_successful_run,
    )
    redis_cpu_baseline, redis_cpu_candidate = _paired_block_metric(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda block: block.resources.redis_cpu_seconds_per_successful_run,
    )
    redis_memory_baseline, redis_memory_candidate = _paired_block_metric(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda block: block.resources.redis_memory_gb_seconds_per_successful_run,
    )
    redis_commands_baseline, redis_commands_candidate = _paired_block_metric(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda block: block.resources.redis_commands_per_successful_run,
    )
    redis_network_baseline, redis_network_candidate = _paired_block_metric(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda block: block.resources.redis_network_bytes_per_successful_run,
    )
    redis_storage_baseline, redis_storage_candidate = _paired_block_metric(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda block: block.resources.redis_storage_bytes_per_successful_run,
    )
    workload_consistent = all(
        sample.terminal_status == "succeeded" and sample.ledger_valid and sample.event_replay_valid
        for block in [*baseline_blocks, *candidate_blocks]
        for sample in block.samples
    )
    if not workload_consistent:
        invalid_reasons.append("workload ledger, terminal status, or SSE/Redis replay differed")

    return ScenarioComparison(
        scenario_id=scenario_id,
        valid=not invalid_reasons,
        invalid_reasons=invalid_reasons,
        workload_consistent=workload_consistent,
        admission_rate=compare_paired_blocks(
            admission_baseline,
            admission_candidate,
            regression_direction="decrease",
            relative_threshold_percent=math.inf,
        ),
        terminal_rate=compare_paired_blocks(
            terminal_rate_baseline,
            terminal_rate_candidate,
            regression_direction="decrease",
            relative_threshold_percent=math.inf,
        ),
        success_rate=compare_paired_blocks(
            success_rate_baseline,
            success_rate_candidate,
            regression_direction="decrease",
            relative_threshold_percent=math.inf,
        ),
        events_per_successful_run=compare_paired_blocks(
            events_per_run_baseline,
            events_per_run_candidate,
            regression_direction="increase",
            relative_threshold_percent=math.inf,
        ),
        create_run_http_p95_ms=compare_blocked_quantile_latency(
            create_baseline,
            create_candidate,
            probability=0.95,
            relative_threshold_percent=math.inf,
        ),
        time_to_first_event_p95_ms=compare_blocked_quantile_latency(
            first_event_baseline,
            first_event_candidate,
            probability=0.95,
            relative_threshold_percent=math.inf,
        ),
        p50_terminal_e2e_ms=compare_blocked_quantile_latency(
            terminal_e2e_baseline,
            terminal_e2e_candidate,
            probability=0.50,
            relative_threshold_percent=math.inf,
        ),
        p95_terminal_e2e_ms=compare_blocked_quantile_latency(
            terminal_e2e_baseline,
            terminal_e2e_candidate,
            probability=0.95,
            relative_threshold_percent=math.inf,
        ),
        p50_runtime_overhead_ms=compare_blocked_quantile_latency(
            overhead_baseline,
            overhead_candidate,
            probability=0.50,
            relative_threshold_percent=math.inf,
        ),
        p95_runtime_overhead_ms=compare_blocked_quantile_latency(
            overhead_baseline,
            overhead_candidate,
            probability=0.95,
        ),
        terminal_runs_per_second=compare_paired_blocks(
            terminal_throughput_baseline,
            terminal_throughput_candidate,
            regression_direction="decrease",
        ),
        successful_runs_per_second=compare_paired_blocks(
            successful_throughput_baseline,
            successful_throughput_candidate,
            regression_direction="decrease",
        ),
        max_active_runs=compare_paired_blocks(
            max_active_baseline,
            max_active_candidate,
            regression_direction="decrease",
            relative_threshold_percent=math.inf,
        ),
        agent_cpu_seconds_per_successful_run=compare_paired_blocks(
            cpu_baseline,
            cpu_candidate,
            regression_direction="increase",
        ),
        agent_peak_memory_delta_bytes=compare_paired_blocks(
            peak_memory_baseline,
            peak_memory_candidate,
            regression_direction="increase",
            relative_threshold_percent=math.inf,
        ),
        agent_memory_gb_seconds_per_successful_run=compare_paired_blocks(
            agent_memory_baseline,
            agent_memory_candidate,
            regression_direction="increase",
            relative_threshold_percent=math.inf,
        ),
        agent_network_bytes_per_successful_run=compare_paired_blocks(
            agent_network_baseline,
            agent_network_candidate,
            regression_direction="increase",
            relative_threshold_percent=math.inf,
        ),
        redis_cpu_seconds_per_successful_run=compare_paired_blocks(
            redis_cpu_baseline,
            redis_cpu_candidate,
            regression_direction="increase",
            relative_threshold_percent=math.inf,
        ),
        redis_memory_gb_seconds_per_successful_run=compare_paired_blocks(
            redis_memory_baseline,
            redis_memory_candidate,
            regression_direction="increase",
            relative_threshold_percent=math.inf,
        ),
        redis_commands_per_successful_run=compare_redis_commands(
            redis_commands_baseline,
            redis_commands_candidate,
        ),
        redis_network_bytes_per_successful_run=compare_paired_blocks(
            redis_network_baseline,
            redis_network_candidate,
            regression_direction="increase",
            relative_threshold_percent=math.inf,
        ),
        redis_storage_bytes_per_successful_run=compare_paired_blocks(
            redis_storage_baseline,
            redis_storage_candidate,
            regression_direction="increase",
            relative_threshold_percent=math.inf,
        ),
        redis_command_mix=_compare_redis_command_mix(baseline_by_pair, candidate_by_pair),
        stats_coverage_valid=all(
            block.resources.agent_stats_coverage.window_covered
            and block.resources.redis_stats_coverage.window_covered
            for block in [*baseline_blocks, *candidate_blocks]
        ),
        baseline_fake_cpu_p95_percent=_maximum_resource(
            baseline_blocks,
            getter=lambda block: block.resources.fake_cpu_p95_percent,
        ),
        candidate_fake_cpu_p95_percent=_maximum_resource(
            candidate_blocks,
            getter=lambda block: block.resources.fake_cpu_p95_percent,
        ),
        baseline_fake_response_p99_ms=_maximum_resource(
            baseline_blocks,
            getter=lambda block: block.resources.fake_response_p99_ms,
        ),
        candidate_fake_response_p99_ms=_maximum_resource(
            candidate_blocks,
            getter=lambda block: block.resources.fake_response_p99_ms,
        ),
    )


def _sample_blocks_by_pair(
    baseline_by_pair: dict[int, BlockResult],
    candidate_by_pair: dict[int, BlockResult],
    *,
    getter: Callable[[RunSample], float | None],
) -> tuple[list[list[float]], list[list[float]]]:
    baseline_blocks: list[list[float]] = []
    candidate_blocks: list[list[float]] = []
    for pair_index in sorted(set(baseline_by_pair) & set(candidate_by_pair)):
        baseline_values = [
            value
            for sample in baseline_by_pair[pair_index].samples
            if (value := getter(sample)) is not None
        ]
        candidate_values = [
            value
            for sample in candidate_by_pair[pair_index].samples
            if (value := getter(sample)) is not None
        ]
        if baseline_values and candidate_values:
            baseline_blocks.append(baseline_values)
            candidate_blocks.append(candidate_values)
    return baseline_blocks, candidate_blocks


def _paired_block_metric(
    baseline_by_pair: dict[int, BlockResult],
    candidate_by_pair: dict[int, BlockResult],
    *,
    getter: Callable[[BlockResult], float | None],
) -> tuple[list[float], list[float]]:
    baseline_values: list[float] = []
    candidate_values: list[float] = []
    for pair_index in sorted(set(baseline_by_pair) & set(candidate_by_pair)):
        baseline_value = getter(baseline_by_pair[pair_index])
        candidate_value = getter(candidate_by_pair[pair_index])
        if baseline_value is not None and candidate_value is not None:
            baseline_values.append(baseline_value)
            candidate_values.append(candidate_value)
    return baseline_values, candidate_values


def _compare_redis_command_mix(
    baseline_by_pair: dict[int, BlockResult],
    candidate_by_pair: dict[int, BlockResult],
) -> dict[str, MetricComparison]:
    command_names = {
        name
        for block in [*baseline_by_pair.values(), *candidate_by_pair.values()]
        for name in block.resources.redis_command_calls_per_successful_run
    }
    comparisons: dict[str, MetricComparison] = {}
    for command_name in sorted(command_names):
        baseline_values, candidate_values = _paired_block_metric(
            baseline_by_pair,
            candidate_by_pair,
            getter=lambda block, name=command_name: block.resources.redis_command_calls_per_successful_run.get(
                name,
                0,
            ),
        )
        comparisons[command_name] = compare_redis_commands(baseline_values, candidate_values)
    return comparisons


def _optional_float(value: int | float | None) -> float | None:
    return float(value) if value is not None else None


def _maximum_resource(
    blocks: Sequence[BlockResult],
    *,
    getter: Callable[[BlockResult], float | None],
) -> float | None:
    values = [value for block in blocks if (value := getter(block)) is not None]
    return max(values, default=None)


def _run_compose_block(
    *,
    root: Path,
    invocation_id: str,
    block_position: int,
    identity: TargetIdentity,
    harness_image: str,
    scenario_id: str,
    block_id: str,
    pair_index: int,
    block_dir: Path,
    keep_containers: bool,
    quick: bool,
) -> BlockResult:
    block_dir.mkdir(parents=True)
    project = _compose_project_name(invocation_id, scenario_id, block_position, identity.kind)
    compose_file = root / "dify-agent" / "benchmarks" / "docker-compose.yml"
    environment = {
        **os.environ,
        "BENCH_HARNESS_IMAGE": harness_image,
        "BENCH_AGENT_IMAGE": identity.image_tag,
        "BENCH_RESULTS_DIR": str(block_dir),
        "BENCH_TARGET": identity.kind,
        "BENCH_TARGET_ID": identity.content_hash[:16],
        "BENCH_SCENARIO_ID": scenario_id,
        "BENCH_BLOCK_ID": block_id,
        "BENCH_PAIR_INDEX": str(pair_index),
    }
    if quick:
        environment.update(
            {
                "BENCH_WARMUP_RUNS": "1",
                "BENCH_TRIAL_RUNS": "2",
            }
        )
    compose = ["docker", "compose", "-f", str(compose_file), "-p", project]
    sampler: DockerStatsSampler | None = None
    driver_result: subprocess.CompletedProcess[str] | None = None
    result: BlockResult | None = None
    sampler_stopped = False
    try:
        _run_command([*compose, "up", "-d", "--wait", "--wait-timeout", "180", "redis", "fake-deps", "agent"], env=environment)
        agent_container_id = _run_command([*compose, "ps", "-q", "agent"], env=environment).stdout.strip()
        redis_container_id = _run_command([*compose, "ps", "-q", "redis"], env=environment).stdout.strip()
        fake_container_id = _run_command([*compose, "ps", "-q", "fake-deps"], env=environment).stdout.strip()
        if not agent_container_id or not redis_container_id or not fake_container_id:
            raise BenchmarkCommandError(f"Compose project {project} did not expose benchmark container ids")
        sampler = DockerStatsSampler(
            {
                "agent": agent_container_id,
                "redis": redis_container_id,
                "fake-deps": fake_container_id,
            }
        )
        sampler.start()
        driver_result = _run_command(
            [*compose, "run", "--rm", "-T", "--no-deps", "load-driver"],
            env=environment,
            check=False,
        )
        sampler.stop()
        sampler_stopped = True
        sampler.write_jsonl(block_dir / "docker-stats.jsonl")

        result_path = block_dir / "block-result.json"
        if not result_path.exists():
            output = driver_result.stdout + driver_result.stderr
            raise BenchmarkCommandError(f"load driver did not write {result_path}\n{output}")
        result = BlockResult.model_validate_json(result_path.read_text())
        driver_resources = result.resources
        engine_resources = summarize_resource_window(
            samples=sampler.samples,
            measurement_started_at_ns=result.measurement_started_at_ns,
            measurement_ended_at_ns=result.measurement_ended_at_ns,
            completed_runs=result.outcomes.successful_runs,
        )
        engine_resources.redis_commands_per_successful_run = driver_resources.redis_commands_per_successful_run
        engine_resources.redis_command_calls_per_successful_run = (
            driver_resources.redis_command_calls_per_successful_run
        )
        engine_resources.redis_network_bytes_per_successful_run = (
            driver_resources.redis_network_bytes_per_successful_run
        )
        engine_resources.redis_storage_bytes_per_successful_run = (
            driver_resources.redis_storage_bytes_per_successful_run
        )
        engine_resources.fake_response_p99_ms = driver_resources.fake_response_p99_ms
        result.resources = engine_resources
        if sampler.errors:
            result.invalid_reasons.extend(f"Docker stats error: {error}" for error in sampler.errors)
        if result.resources.fake_cpu_p95_percent is not None and result.resources.fake_cpu_p95_percent > 50:
            result.invalid_reasons.append(
                f"fake dependency sustained CPU p95 was {result.resources.fake_cpu_p95_percent:.1f}%, above 50%"
            )
        if not result.resources.agent_stats_coverage.window_covered:
            result.invalid_reasons.append("Docker stats did not cover the Agent measurement boundaries")
        if not result.resources.redis_stats_coverage.window_covered:
            result.invalid_reasons.append("Docker stats did not cover the Redis measurement boundaries")
        if driver_result.returncode != 0 and not result.invalid_reasons:
            result.invalid_reasons.append(f"load driver exited with status {driver_result.returncode}")
        result.valid = not result.invalid_reasons
        result_path.write_text(result.model_dump_json(indent=2))
        return result
    finally:
        if sampler is not None and not sampler_stopped:
            sampler.stop()
            sampler.write_jsonl(block_dir / "docker-stats.jsonl")
        logs = _run_command(
            [*compose, "logs", "--no-color", "agent", "redis", "fake-deps"],
            env=environment,
            check=False,
        )
        (block_dir / "services.log").write_text(logs.stdout + logs.stderr)
        should_keep = keep_containers and (result is None or not result.valid)
        if should_keep:
            logger.warning("keeping benchmark Compose project %s", project)
        else:
            _ = _run_command([*compose, "down", "-v", "--remove-orphans"], env=environment, check=False)


def _build_harness_image(root: Path) -> str:
    harness_hash = _hash_paths(
        root,
        (
            "dify-agent/benchmarks",
            "dify-agent/pyproject.toml",
            "dify-agent/uv.lock",
        ),
    )
    tag = f"dify-agent-bench-harness:{harness_hash[:16]}"
    _run_command(
        [
            "docker",
            "build",
            "--progress=plain",
            "-f",
            "dify-agent/benchmarks/Dockerfile",
            "-t",
            tag,
            ".",
        ],
        cwd=root,
    )
    return tag


def _build_target_image(root: Path, *, kind: TargetKind, ref: str | None) -> TargetIdentity:
    if kind == "baseline" and ref is None:
        raise ValueError("baseline ref is required")
    if kind == "candidate" and ref is None:
        context_manager = _worktree_context(root)
    else:
        assert ref is not None
        context_manager = _archive_context(root, ref)
    with context_manager as (context, resolved_ref, commit, dirty):
        content_hash = _hash_paths(context, _PRODUCTION_INPUTS)
        tag_suffix = f"{commit[:12]}-{content_hash[:12]}"
        tag = f"dify-agent-bench-{kind}:{tag_suffix}".lower()
        _run_command(
            [
                "docker",
                "build",
                "--progress=plain",
                "-f",
                "dify-agent/Dockerfile",
                "--build-arg",
                f"COMMIT_SHA={commit}",
                "-t",
                tag,
                ".",
            ],
            cwd=context,
        )
        image_data = json.loads(_run_command(["docker", "image", "inspect", tag]).stdout)[0]
        image_id = str(image_data["Id"])
        python_version = _run_command(
            ["docker", "run", "--rm", "--entrypoint", "python", tag, "--version"],
        ).stdout.strip()
        return TargetIdentity(
            kind=kind,
            ref=resolved_ref,
            commit=commit,
            dirty=dirty,
            content_hash=content_hash,
            lock_hash=_hash_file(context / "dify-agent" / "uv.lock"),
            image_tag=tag,
            image_id=image_id,
            python_version=python_version,
        )


@contextmanager
def _worktree_context(root: Path) -> Iterator[tuple[Path, str, str, bool]]:
    commit = _run_command(["git", "rev-parse", "HEAD"], cwd=root).stdout.strip()
    dirty = bool(
        _run_command(
            ["git", "status", "--porcelain", "--", *_PRODUCTION_INPUTS],
            cwd=root,
        ).stdout.strip()
    )
    yield root, "worktree", commit, dirty


@contextmanager
def _archive_context(root: Path, ref: str) -> Iterator[tuple[Path, str, str, bool]]:
    commit = _run_command(["git", "rev-parse", f"{ref}^{{commit}}"], cwd=root).stdout.strip()
    archive = _run_command_bytes(["git", "archive", "--format=tar", commit], cwd=root)
    with tempfile.TemporaryDirectory(prefix="dify-agent-benchmark-source-") as temporary_directory:
        context = Path(temporary_directory)
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as source_archive:
            source_archive.extractall(context, filter="data")
        shutil.copy2(root / ".dockerignore", context / ".dockerignore")
        yield context, ref, commit, False


def _prepare_python_base_image() -> str:
    pull = _run_command(["docker", "pull", "--quiet", _PYTHON_BASE_IMAGE], check=False)
    inspect = _run_command(["docker", "image", "inspect", _PYTHON_BASE_IMAGE], check=False)
    if inspect.returncode != 0:
        raise BenchmarkCommandError(
            f"could not pull or find local Python base image {_PYTHON_BASE_IMAGE}\n"
            f"{pull.stdout}{pull.stderr}{inspect.stdout}{inspect.stderr}"
        )
    if pull.returncode != 0:
        logger.warning(
            "could not refresh %s; using the recorded local image: %s",
            _PYTHON_BASE_IMAGE,
            pull.stderr.strip(),
        )
    image_data = json.loads(inspect.stdout)[0]
    return str(image_data["Id"])


def _capture_environment(root: Path, *, python_base_image_id: str) -> EnvironmentFingerprint:
    docker_info = json.loads(_run_command(["docker", "info", "--format", "{{json .}}"]).stdout)
    docker_version = json.loads(_run_command(["docker", "version", "--format", "{{json .Server}}"]).stdout)
    compose_version = _run_command(["docker", "compose", "version", "--short"]).stdout.strip()
    return EnvironmentFingerprint(
        captured_at=datetime.now(timezone.utc).isoformat(),
        os=str(docker_info.get("OperatingSystem", "")),
        architecture=str(docker_info.get("Architecture", "")),
        kernel=str(docker_info.get("KernelVersion", "")),
        cpu_model=_cpu_model(),
        docker_engine=str(docker_version.get("Version", "")),
        docker_compose=compose_version,
        docker_cpus=int(docker_info.get("NCPU", 0)),
        docker_memory_bytes=int(docker_info.get("MemTotal", 0)),
        compose_hash=_hash_file(root / "dify-agent" / "benchmarks" / "docker-compose.yml"),
        harness_hash=_hash_paths(
            root,
            (
                "dify-agent/benchmarks",
                "dify-agent/pyproject.toml",
                "dify-agent/uv.lock",
            ),
        ),
        redis_image=_REDIS_IMAGE,
        python_base_image_id=python_base_image_id,
    )


def _compatibility_errors(baseline: TargetResult, candidate: TargetResult) -> list[str]:
    errors: list[str] = []
    if baseline.environment != candidate.environment:
        errors.append("baseline and candidate environment fingerprints differ")
    baseline_scenarios = {(block.scenario_id, block.scenario_version) for block in baseline.blocks}
    candidate_scenarios = {(block.scenario_id, block.scenario_version) for block in candidate.blocks}
    if baseline_scenarios != candidate_scenarios:
        errors.append("baseline and candidate scenario versions differ")
    return errors


def _write_invocation_artifacts(
    *,
    invocation_dir: Path,
    baseline_result: TargetResult,
    candidate_result: TargetResult,
    comparison: ComparisonReport,
) -> None:
    (invocation_dir / "baseline-result.json").write_text(baseline_result.model_dump_json(indent=2))
    (invocation_dir / "candidate-result.json").write_text(candidate_result.model_dump_json(indent=2))
    (invocation_dir / "comparison.json").write_text(comparison.model_dump_json(indent=2))
    with (invocation_dir / "samples.jsonl").open("w") as output:
        for block in [*baseline_result.blocks, *candidate_result.blocks]:
            for sample in block.samples:
                output.write(sample.model_dump_json())
                output.write("\n")
    (invocation_dir / "comparison.md").write_text(_render_markdown(comparison))


def _render_markdown(report: ComparisonReport) -> str:
    lines = [
        "# Dify Agent local Docker A/B benchmark",
        "",
        f"- Overall: `{report.overall_verdict}`",
        f"- Baseline: `{report.baseline.ref}` (`{report.baseline.content_hash[:12]}`)",
        f"- Candidate: `{report.candidate.ref}` (`{report.candidate.content_hash[:12]}`)",
        f"- Environment: `{report.environment.os}` / `{report.environment.architecture}`",
        "",
        "## Correctness and workload",
        "",
        "| Scenario | Workload | admission rate | terminal rate | success rate | events/success | max active | stats | Fake CPU p95 B/C | Fake response p99 B/C |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for comparison in report.scenarios:
        lines.append(
            "| "
            + " | ".join(
                [
                    comparison.scenario_id,
                    "consistent" if comparison.workload_consistent else "invalid",
                    _format_metric(comparison.admission_rate),
                    _format_metric(comparison.terminal_rate),
                    _format_metric(comparison.success_rate),
                    _format_metric(comparison.events_per_successful_run),
                    _format_metric(comparison.max_active_runs),
                    "covered" if comparison.stats_coverage_valid else "invalid",
                    _format_pair(
                        comparison.baseline_fake_cpu_p95_percent,
                        comparison.candidate_fake_cpu_p95_percent,
                    ),
                    _format_pair(
                        comparison.baseline_fake_response_p99_ms,
                        comparison.candidate_fake_response_p99_ms,
                    ),
                ]
            )
            + " |"
        )
    lines.extend(
        [
            "",
            "## Latency and throughput",
            "",
            "| Scenario | create p95 | TTFE p95 | e2e p50 | e2e p95 | overhead p50 | overhead p95 | terminal runs/s | successful runs/s |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for comparison in report.scenarios:
        lines.append(
            "| "
            + " | ".join(
                [
                    comparison.scenario_id,
                    _format_metric(comparison.create_run_http_p95_ms),
                    _format_metric(comparison.time_to_first_event_p95_ms),
                    _format_metric(comparison.p50_terminal_e2e_ms),
                    _format_metric(comparison.p95_terminal_e2e_ms),
                    _format_metric(comparison.p50_runtime_overhead_ms),
                    _format_metric(comparison.p95_runtime_overhead_ms),
                    _format_metric(comparison.terminal_runs_per_second),
                    _format_metric(comparison.successful_runs_per_second),
                ]
            )
            + " |"
        )
    lines.extend(
        [
            "",
            "## Cost-oriented resource efficiency",
            "",
            "| Scenario | Agent CPU/success | Agent peak memory delta | Agent GB-s/success | Agent network/success | Redis CPU/success | Redis GB-s/success | Redis commands/success | Redis network/success | Redis storage/success |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for comparison in report.scenarios:
        lines.append(
            "| "
            + " | ".join(
                [
                    comparison.scenario_id,
                    _format_metric(comparison.agent_cpu_seconds_per_successful_run),
                    _format_metric(comparison.agent_peak_memory_delta_bytes),
                    _format_metric(comparison.agent_memory_gb_seconds_per_successful_run),
                    _format_metric(comparison.agent_network_bytes_per_successful_run),
                    _format_metric(comparison.redis_cpu_seconds_per_successful_run),
                    _format_metric(comparison.redis_memory_gb_seconds_per_successful_run),
                    _format_metric(comparison.redis_commands_per_successful_run),
                    _format_metric(comparison.redis_network_bytes_per_successful_run),
                    _format_metric(comparison.redis_storage_bytes_per_successful_run),
                ]
            )
            + " |"
        )
        for reason in comparison.invalid_reasons:
            lines.append(f"\n- `{comparison.scenario_id}` invalid: {reason}")
    lines.extend(["", "## Redis command mix", ""])
    for comparison in report.scenarios:
        changes = ", ".join(
            f"`{name}` {_format_metric(metric)}"
            for name, metric in comparison.redis_command_mix.items()
        )
        lines.append(f"- `{comparison.scenario_id}`: {changes or 'none'}")
    lines.extend(
        [
            "",
            "Performance classifications are report-only. Correctness and compatibility failures make the command fail.",
            "",
        ]
    )
    return "\n".join(lines)


def _format_metric(metric: MetricComparison) -> str:
    if metric.baseline is None or metric.candidate is None:
        return f"`{metric.verdict}`"
    relative = (
        "n/a"
        if metric.relative_change_percent is None
        else f"{metric.relative_change_percent:+.2f}%"
    )
    return f"{metric.baseline:.4g} → {metric.candidate:.4g} ({relative}) `{metric.verdict}`"


def _format_pair(baseline: float | None, candidate: float | None) -> str:
    if baseline is None or candidate is None:
        return "unavailable"
    return f"{baseline:.3g} / {candidate:.3g}"


def _decision_metrics(comparison: ScenarioComparison) -> tuple[MetricComparison, ...]:
    return (
        comparison.p95_runtime_overhead_ms,
        comparison.terminal_runs_per_second,
        comparison.agent_cpu_seconds_per_successful_run,
        comparison.redis_commands_per_successful_run,
    )


def _verify_docker_environment(root: Path) -> None:
    _ = _run_command(["docker", "info"])
    _ = _run_command(["docker", "compose", "version"])
    compose_file = root / "dify-agent" / "benchmarks" / "docker-compose.yml"
    placeholder_environment = {
        **os.environ,
        "BENCH_HARNESS_IMAGE": "benchmark-harness",
        "BENCH_AGENT_IMAGE": "benchmark-agent",
        "BENCH_RESULTS_DIR": str(root / "dify-agent" / "benchmarks" / "results"),
        "BENCH_TARGET": "candidate",
        "BENCH_TARGET_ID": "environment-check",
        "BENCH_SCENARIO_ID": "single_1_chunk_c1",
        "BENCH_BLOCK_ID": "environment-check",
        "BENCH_PAIR_INDEX": "0",
    }
    _ = _run_command(
        ["docker", "compose", "-f", str(compose_file), "config", "--quiet"],
        env=placeholder_environment,
    )


def _hash_paths(root: Path, relative_paths: Iterable[str]) -> str:
    hasher = hashlib.sha256()
    files: list[Path] = []
    for relative_path in relative_paths:
        path = root / relative_path
        if path.is_dir():
            files.extend(candidate for candidate in path.rglob("*") if candidate.is_file())
        elif path.is_file():
            files.append(path)
    for path in sorted(files):
        if "results" in path.parts or "__pycache__" in path.parts or ".venv" in path.parts:
            continue
        hasher.update(path.relative_to(root).as_posix().encode())
        hasher.update(b"\0")
        hasher.update(path.read_bytes())
        hasher.update(b"\0")
    return hasher.hexdigest()


def _hash_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _compose_project_name(invocation_id: str, scenario_id: str, position: int, kind: TargetKind) -> str:
    scenario_hash = hashlib.sha256(scenario_id.encode()).hexdigest()[:8]
    project = f"dify-agent-bench-{invocation_id}-{scenario_hash}-{position}-{kind}"
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]+", project):
        raise ValueError(f"unsafe Compose project name: {project}")
    return project


def _new_run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")


def _cpu_model() -> str:
    if platform.system() == "Darwin":
        result = _run_command(["sysctl", "-n", "machdep.cpu.brand_string"], check=False)
        if result.returncode == 0:
            return result.stdout.strip()
    cpu_info = Path("/proc/cpuinfo")
    if cpu_info.exists():
        for line in cpu_info.read_text().splitlines():
            if line.lower().startswith("model name"):
                return line.split(":", 1)[1].strip()
    return platform.processor()


def _run_command(
    command: Sequence[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    logger.debug("running command: %s", " ".join(command))
    result = subprocess.run(
        list(command),
        cwd=cwd,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    if check and result.returncode != 0:
        raise BenchmarkCommandError(
            f"command failed ({result.returncode}): {' '.join(command)}\n{result.stdout}{result.stderr}"
        )
    return result


def _run_command_bytes(command: Sequence[str], *, cwd: Path) -> bytes:
    result = subprocess.run(list(command), cwd=cwd, capture_output=True, check=False)
    if result.returncode != 0:
        raise BenchmarkCommandError(
            f"command failed ({result.returncode}): {' '.join(command)}\n"
            f"{result.stderr.decode(errors='replace')}"
        )
    return result.stdout


def _parse_args() -> tuple[str, RunOptions]:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    smoke_parser = subparsers.add_parser("smoke")
    smoke_parser.add_argument("--keep-containers", action="store_true")
    smoke_parser.add_argument("--results-root", type=Path)
    ab_parser = subparsers.add_parser("ab")
    ab_parser.add_argument("--baseline-ref", default=os.environ.get("BASE_REF", "origin/main"))
    ab_parser.add_argument("--candidate-ref", default=os.environ.get("CANDIDATE_REF") or None)
    ab_parser.add_argument("--keep-containers", action="store_true", default=os.environ.get("KEEP_CONTAINERS") == "1")
    ab_parser.add_argument("--quick", action="store_true")
    ab_parser.add_argument("--scenario", action="append", dest="scenarios", default=[])
    ab_parser.add_argument("--results-root", type=Path)
    args = parser.parse_args()
    options = RunOptions(
        baseline_ref=getattr(args, "baseline_ref", "origin/main"),
        candidate_ref=getattr(args, "candidate_ref", None),
        keep_containers=args.keep_containers,
        quick=getattr(args, "quick", False),
        scenario_ids=tuple(getattr(args, "scenarios", [])),
        results_root=args.results_root,
    )
    return args.command, options


def main() -> int:
    """CLI entrypoint for Make targets."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    command, options = _parse_args()
    try:
        if command == "smoke":
            _ = run_smoke(keep_containers=options.keep_containers, results_root=options.results_root)
        else:
            _ = run_ab(options)
    except BenchmarkCommandError:
        logger.exception("benchmark failed")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "BenchmarkCommandError",
    "RunOptions",
    "build_comparison",
    "repository_root",
    "run_ab",
    "run_smoke",
]
