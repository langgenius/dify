"""Build and run local Docker A/B benchmarks for Agent, Runtime, and capabilities."""

from __future__ import annotations

import argparse
from collections.abc import Callable, Iterable, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
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
from typing import Iterator, Literal, cast

from benchmarks.capacity import (
    CapacityPoint,
    E2BLifecycleSample,
    QuotaRecommendation,
    aggregate_e2b_lifecycle_point,
    aggregate_local_capacity_point,
    build_e2b_service_capacity_matrix,
    build_local_capacity_matrix,
    build_quota_recommendation,
    build_unit_consumption,
    enrich_e2b_service_point,
    render_capacity_markdown,
)
from benchmarks.comparison import (
    compare_blocked_quantile_latency,
    compare_paired_blocks,
    compare_redis_commands,
)
from benchmarks.docker_stats import DockerStatsSampler, summarize_resource_window
from benchmarks.scenario import BenchmarkProfile, load_scenario_manifest
from benchmarks.schemas import (
    BlockResult,
    ComparisonReport,
    ComponentIdentity,
    EnvironmentFingerprint,
    MetricComparison,
    ResourceSummary,
    RunSample,
    ScenarioComparison,
    TargetIdentity,
    TargetKind,
    TargetResult,
)


logger = logging.getLogger(__name__)

_HARNESS_VERSION = 3
_PYTHON_BASE_IMAGE = "python:3.12-slim-bookworm"
_GO_BASE_IMAGE = "golang:1.26"
_REDIS_IMAGE = "redis:7.4.10-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2"
_REDIS_CONFIG = '--save "" --appendonly no --maxmemory-policy noeviction'
_MIN_SUSTAINED_CPU_SAMPLE_COUNT = 10
_AGENT_INPUTS = (
    "dify-agent/src",
    "dify-agent/pyproject.toml",
    "dify-agent/uv.lock",
    "dify-agent/Dockerfile",
)
_RUNTIME_INPUTS = (
    "dify-agent-runtime/cmd",
    "dify-agent-runtime/gen",
    "dify-agent-runtime/internal",
    "dify-agent-runtime/go.mod",
    "dify-agent-runtime/go.sum",
    "dify-agent-runtime/docker/Dockerfile",
)
_ABBA: tuple[tuple[TargetKind, int], ...] = (
    ("baseline", 0),
    ("candidate", 0),
    ("candidate", 1),
    ("baseline", 1),
)
_PROFILE_COMPOSE = {
    "agent": "docker-compose.yml",
    "runtime": "docker-compose.runtime.yml",
    "capability": "docker-compose.capability.yml",
    "e2b": "docker-compose.e2b-capacity.yml",
}
_PROFILE_DRIVER = {
    "agent": "load-driver",
    "runtime": "runtime-driver",
    "capability": "capability-driver",
    "e2b": "e2b-service-driver",
}
_PROFILE_SERVICES = {
    "agent": ("redis", "fake-deps", "agent"),
    "runtime": ("runtime",),
    "capability": ("redis", "fake-deps", "runtime", "agent"),
    "e2b": ("redis", "fake-deps", "agent"),
}
_PROFILE_PRIMARY_COMPONENTS = {
    "agent": ("agent",),
    "runtime": ("runtime",),
    "capability": ("agent", "runtime"),
    "e2b": ("agent",),
}
_RESOURCE_LIMITS = {
    "agent": {"agent": "4 CPU/1 GiB", "redis": "2 CPU/512 MiB", "fake-deps": "2 CPU/512 MiB"},
    "runtime": {"runtime": "4 CPU/2 GiB"},
    "capability": {
        "agent": "4 CPU/1 GiB",
        "runtime": "4 CPU/2 GiB",
        "redis": "2 CPU/512 MiB",
        "fake-deps": "2 CPU/512 MiB",
    },
    "e2b": {"agent": "4 CPU/1 GiB", "redis": "2 CPU/512 MiB", "fake-deps": "2 CPU/512 MiB"},
}


@dataclass(slots=True, frozen=True)
class RunOptions:
    """Resolved command-line options for one local invocation."""

    profile: BenchmarkProfile
    baseline_ref: str
    candidate_ref: str | None
    pin_agent_ref: str | None
    pin_runtime_ref: str | None
    keep_containers: bool
    quick: bool
    scenario_ids: tuple[str, ...]
    results_root: Path | None

    def __post_init__(self) -> None:
        if self.pin_agent_ref and self.pin_runtime_ref:
            raise ValueError("PIN_AGENT_REF and PIN_RUNTIME_REF cannot be used together")
        if self.profile != "capability" and (self.pin_agent_ref or self.pin_runtime_ref):
            raise ValueError("component pinning is available only for the capability profile")


@dataclass(slots=True, frozen=True)
class CapacityOptions:
    """Single-target Local capacity execution settings."""

    target_ref: str
    keep_containers: bool
    quick: bool
    results_root: Path | None


@dataclass(slots=True, frozen=True)
class E2BCapacityOptions:
    """Secret-bearing real E2B calibration settings."""

    target_ref: str
    api_key: str = field(repr=False)
    template: str
    max_concurrency: int
    max_inventory: int
    pilot_tenant_count: int
    keep_containers: bool
    quick: bool
    capacity_results_dir: Path | None
    results_root: Path | None

    def __post_init__(self) -> None:
        if not self.api_key.strip() or not self.template.strip():
            raise ValueError("E2B API key and template are required")
        if min(self.max_concurrency, self.max_inventory, self.pilot_tenant_count) < 1:
            raise ValueError("E2B vendor limits and pilot tenant count must be positive")
        if self.max_concurrency < 20:
            raise ValueError(
                "BENCH_E2B_MAX_CONCURRENCY must be at least 20 for the fixed capacity matrix"
            )
        if self.max_inventory < 20:
            raise ValueError(
                "BENCH_E2B_MAX_INVENTORY must be at least 20 for the fixed capacity matrix"
            )


def _fake_dependency_cpu_saturated(resources: ResourceSummary) -> bool:
    fake = resources.components.get("fake-deps")
    return (
        resources.fake_cpu_p95_percent is not None
        and resources.fake_cpu_p95_percent > 50
        and fake is not None
        and fake.stats_coverage.in_window_sample_count >= _MIN_SUSTAINED_CPU_SAMPLE_COUNT
    )


class BenchmarkCommandError(RuntimeError):
    """Raised for an environment or correctness failure that must stop the run."""


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


def run_ab(options: RunOptions) -> Path:
    """Build both targets, execute ABBA blocks, and write report-only artifacts."""
    root = repository_root()
    _verify_docker_environment(root, options.profile)
    manifest = load_scenario_manifest(profile=options.profile)
    scenario_ids = options.scenario_ids or tuple(scenario.id for scenario in manifest.scenarios)
    for scenario_id in scenario_ids:
        _ = manifest.get(scenario_id)

    run_id = _new_run_id()
    results_root = options.results_root or root / "dify-agent" / "benchmarks" / "results"
    invocation_dir = (results_root / f"{run_id}-{options.profile}-ab").resolve()
    invocation_dir.mkdir(parents=True)
    python_base_image_id = _prepare_base_images()
    harness_image = _build_harness_image(root)
    baseline = _build_target_identity(
        root,
        kind="baseline",
        profile=options.profile,
        ref=options.baseline_ref,
        pin_agent_ref=options.pin_agent_ref,
        pin_runtime_ref=options.pin_runtime_ref,
    )
    candidate = _build_target_identity(
        root,
        kind="candidate",
        profile=options.profile,
        ref=options.candidate_ref,
        pin_agent_ref=options.pin_agent_ref,
        pin_runtime_ref=options.pin_runtime_ref,
    )
    environment = _capture_environment(
        root,
        profile=options.profile,
        python_base_image_id=python_base_image_id,
    )
    _write_json(invocation_dir / "environment.json", environment)
    _write_json(invocation_dir / "baseline-identity.json", baseline)
    _write_json(invocation_dir / "candidate-identity.json", candidate)
    logger.info("%s benchmark results: %s", options.profile, invocation_dir)

    blocks: list[BlockResult] = []
    for scenario_id in scenario_ids:
        for position, (kind, pair_index) in enumerate(_ABBA):
            identity = baseline if kind == "baseline" else candidate
            block_id = f"{scenario_id}-{kind}-{pair_index}"
            blocks.append(
                _run_compose_block(
                    root=root,
                    profile=options.profile,
                    invocation_id=run_id,
                    block_position=position,
                    identity=identity,
                    harness_image=harness_image,
                    scenario_id=scenario_id,
                    block_id=block_id,
                    pair_index=pair_index,
                    block_dir=invocation_dir / "blocks" / block_id,
                    keep_containers=options.keep_containers,
                    quick=options.quick,
                )
            )

    baseline_result = TargetResult(
        profile=options.profile,
        target=baseline,
        environment=environment,
        blocks=[block for block in blocks if block.target == "baseline"],
    )
    candidate_result = TargetResult(
        profile=options.profile,
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
    logger.info("overall %s A/B verdict: %s", options.profile, comparison.overall_verdict)
    return invocation_dir


def run_smoke(
    *,
    profile: BenchmarkProfile = "agent",
    keep_containers: bool,
    results_root: Path | None = None,
    scenario_id: str | None = None,
    quick: bool = True,
) -> Path:
    """Build current production inputs and run the smallest profile scenario."""
    root = repository_root()
    _verify_docker_environment(root, profile)
    run_id = _new_run_id()
    resolved_results_root = results_root or root / "dify-agent" / "benchmarks" / "results"
    invocation_dir = (resolved_results_root / f"{run_id}-{profile}-smoke").resolve()
    invocation_dir.mkdir(parents=True)
    python_base_image_id = _prepare_base_images()
    harness_image = _build_harness_image(root)
    candidate = _build_target_identity(
        root,
        kind="candidate",
        profile=profile,
        ref=None,
        pin_agent_ref=None,
        pin_runtime_ref=None,
    )
    environment = _capture_environment(root, profile=profile, python_base_image_id=python_base_image_id)
    _write_json(invocation_dir / "environment.json", environment)
    _write_json(invocation_dir / "candidate-identity.json", candidate)
    selected_scenario_id = (
        scenario_id
        or {
            "agent": "single_1_chunk_c1",
            "runtime": "runtime_noop_c1",
            "capability": "capability_shell_noop_c1",
        }[profile]
    )
    _ = load_scenario_manifest(profile=profile).get(selected_scenario_id)
    block = _run_compose_block(
        root=root,
        profile=profile,
        invocation_id=run_id,
        block_position=0,
        identity=candidate,
        harness_image=harness_image,
        scenario_id=selected_scenario_id,
        block_id="smoke-candidate-0",
        pair_index=0,
        block_dir=invocation_dir / "blocks" / "smoke-candidate-0",
        keep_containers=keep_containers,
        quick=quick,
    )
    result = TargetResult(profile=profile, target=candidate, environment=environment, blocks=[block])
    _write_json(invocation_dir / "candidate-result.json", result)
    if not block.valid:
        raise BenchmarkCommandError(f"Docker smoke failed; inspect {invocation_dir}")
    logger.info("%s Docker benchmark smoke passed: %s", profile, invocation_dir)
    return invocation_dir


def run_local_capacity(options: CapacityOptions) -> Path:
    """Run the compact single-target Local capacity matrix and write reference artifacts."""
    root = repository_root()
    for profile in ("agent", "capability"):
        _verify_docker_environment(root, cast(BenchmarkProfile, profile))
    run_id = _new_run_id()
    results_root = options.results_root or root / "dify-agent" / "benchmarks" / "results"
    invocation_dir = (results_root / f"{run_id}-capacity").resolve()
    invocation_dir.mkdir(parents=True)
    (invocation_dir / "logs").mkdir()
    python_base_image_id = _prepare_base_images()
    harness_image = _build_harness_image(root)
    identities = {
        profile: _build_target_identity(
            root,
            kind="candidate",
            profile=cast(BenchmarkProfile, profile),
            ref=options.target_ref,
            pin_agent_ref=None,
            pin_runtime_ref=None,
        )
        for profile in ("agent", "capability")
    }
    environments = {
        profile: _capture_environment(
            root,
            profile=cast(BenchmarkProfile, profile),
            python_base_image_id=python_base_image_id,
        )
        for profile in ("agent", "capability")
    }
    _write_json(
        invocation_dir / "environment.json",
        {
            "schema_version": 1,
            "mode": "local_capacity",
            "target_ref": options.target_ref,
            "reference_valid": not options.quick,
            "profiles": {
                profile: environment.model_dump(mode="json")
                for profile, environment in environments.items()
            },
        },
    )
    blocks_by_scenario: dict[str, list[BlockResult]] = {}
    block_position = 0
    block_count = 1 if options.quick else 3
    for matrix_point in build_local_capacity_matrix():
        profile = cast(BenchmarkProfile, matrix_point.profile)
        point_blocks: list[BlockResult] = []
        for block_index in range(block_count):
            block_id = f"{matrix_point.scenario_id}-candidate-{block_index}"
            block_dir = invocation_dir / "blocks" / block_id
            overrides = {
                "BENCH_RESULT_SCENARIO_ID": matrix_point.scenario_id,
                "BENCH_CONCURRENCY": str(matrix_point.requested_concurrency),
            }
            if matrix_point.profile == "capability":
                overrides["BENCH_BINDING_POOL_SIZE"] = str(matrix_point.requested_concurrency)
            if not options.quick:
                overrides.update(
                    {
                        "BENCH_WARMUP_RUNS": "",
                        "BENCH_TRIAL_RUNS": "",
                        "BENCH_WARMUP_SECONDS": "15",
                        "BENCH_DURATION_SECONDS": "60",
                        "BENCH_MIN_SUCCESSFUL_RUNS": "100",
                        "BENCH_MAX_DURATION_SECONDS": "300",
                    }
                )
            block = _run_compose_block(
                root=root,
                profile=profile,
                invocation_id=run_id,
                block_position=block_position,
                identity=identities[matrix_point.profile],
                harness_image=harness_image,
                scenario_id=matrix_point.source_scenario_id,
                block_id=block_id,
                pair_index=block_index,
                block_dir=block_dir,
                keep_containers=options.keep_containers,
                quick=options.quick,
                environment_overrides=overrides,
            )
            point_blocks.append(block)
            block_position += 1
            service_log = block_dir / "services.log"
            if service_log.exists():
                shutil.copyfile(service_log, invocation_dir / "logs" / f"{block_id}.log")
        blocks_by_scenario[matrix_point.scenario_id] = point_blocks

    points = [
        aggregate_local_capacity_point(
            profile=cast(Literal["agent", "capability"], matrix_point.profile),
            workload=matrix_point.workload,
            scenario_id=matrix_point.scenario_id,
            requested_concurrency=matrix_point.requested_concurrency,
            blocks=blocks_by_scenario[matrix_point.scenario_id],
            reference_valid=not options.quick,
            expected_blocks=block_count,
            minimum_samples=2 if options.quick else 300,
        )
        for matrix_point in build_local_capacity_matrix()
    ]
    local_payload = {
        "schema_version": 1,
        "mode": "local_capacity",
        "target_ref": options.target_ref,
        "reference_valid": not options.quick,
        "identities": {
            profile: identity.model_dump(mode="json")
            for profile, identity in identities.items()
        },
        "points": [point.model_dump(mode="json") for point in points],
    }
    _write_json(invocation_dir / "local-capacity.json", local_payload)
    _write_json(
        invocation_dir / "unit-consumption.json",
        {
            "schema_version": 1,
            "units": [
                unit.model_dump(mode="json")
                for unit in build_unit_consumption(points)
            ],
        },
    )
    _write_json(
        invocation_dir / "quota-recommendation.json",
        {
            "schema_version": 1,
            "status": "pending_e2b",
            "reference_valid": False,
            "reasons": ["real E2B capacity evidence is required before recommending launch quotas"],
        },
    )
    (invocation_dir / "capacity-report.md").write_text(
        render_capacity_markdown(
            target_ref=options.target_ref,
            local_points=points,
            e2b_points=[],
            quota=None,
        )
    )
    with (invocation_dir / "samples.jsonl").open("w") as output:
        for point_blocks in blocks_by_scenario.values():
            for block in point_blocks:
                for sample in block.samples:
                    output.write(sample.model_dump_json())
                    output.write("\n")
    results_root.mkdir(parents=True, exist_ok=True)
    (results_root / "latest-capacity.txt").write_text(str(invocation_dir))
    if any(point.status == "invalid" for point in points):
        raise BenchmarkCommandError(f"local capacity correctness failed; inspect {invocation_dir}")
    logger.info("Local capacity results: %s", invocation_dir)
    return invocation_dir


def run_e2b_capacity(options: E2BCapacityOptions) -> Path:
    """Calibrate the existing Local capacity result against real E2B."""
    root = repository_root()
    secret_environment = {
        "BENCH_E2B_API_KEY": options.api_key,
        "BENCH_E2B_TEMPLATE": options.template,
    }
    invocation_dir = _resolve_capacity_results_dir(root, options)
    local_payload = json.loads((invocation_dir / "local-capacity.json").read_text())
    local_points = [
        CapacityPoint.model_validate(point)
        for point in cast(list[object], local_payload.get("points", []))
    ]
    if not local_points:
        raise BenchmarkCommandError(f"no Local capacity points found in {invocation_dir}")
    _verify_docker_environment(root, "e2b", environment_overrides=secret_environment)

    python_base_image_id = _prepare_base_images()
    harness_image = _build_harness_image(root)
    identity = _build_target_identity(
        root,
        kind="candidate",
        profile="e2b",
        ref=options.target_ref,
        pin_agent_ref=None,
        pin_runtime_ref=None,
    )
    _verify_capacity_target_matches(local_payload, identity, invocation_dir)
    environment = _capture_environment(
        root,
        profile="e2b",
        python_base_image_id=python_base_image_id,
    )
    _verify_capacity_environment_matches(invocation_dir, environment)
    reference_valid = bool(local_payload.get("reference_valid")) and not options.quick
    lifecycle_points: list[CapacityPoint] = []
    lifecycle_samples: list[E2BLifecycleSample] = []
    block_position = 0
    smoke_block_id = "e2b_contract_smoke_c1"
    smoke_samples, _, _ = _run_e2b_lifecycle_block(
        root=root,
        invocation_id=invocation_dir.name,
        block_position=block_position,
        identity=identity,
        harness_image=harness_image,
        block_id=smoke_block_id,
        concurrency=1,
        waves=1,
        block_dir=invocation_dir / "blocks" / smoke_block_id,
        keep_containers=options.keep_containers,
        api_key=options.api_key,
        template=options.template,
    )
    lifecycle_samples.extend(smoke_samples)
    smoke_log = invocation_dir / "blocks" / smoke_block_id / "driver.log"
    if smoke_log.exists():
        shutil.copyfile(smoke_log, invocation_dir / "logs" / f"{smoke_block_id}.log")
    block_position += 1
    if not smoke_samples or any(
        not sample.success or sample.cleanup_error for sample in smoke_samples
    ):
        _write_e2b_capacity_artifacts(
            invocation_dir=invocation_dir,
            target_ref=options.target_ref,
            local_points=local_points,
            e2b_points=[],
            lifecycle_samples=lifecycle_samples,
            service_blocks=[],
            identity=identity,
            environment=environment,
            options=options,
            quota=None,
        )
        raise BenchmarkCommandError(
            f"real E2B lifecycle contract smoke failed; inspect {invocation_dir}"
        )
    lifecycle_block_count = 1 if options.quick else 2
    lifecycle_waves = 1 if options.quick else 5
    for concurrency in (1, 5, 10, 20):
        point_samples: list[E2BLifecycleSample] = []
        elapsed_seconds = 0.0
        observed_max_active = 0
        for block_index in range(lifecycle_block_count):
            block_id = f"e2b_binding_create_pause_c{concurrency}-candidate-{block_index}"
            samples, observed, elapsed = _run_e2b_lifecycle_block(
                root=root,
                invocation_id=invocation_dir.name,
                block_position=block_position,
                identity=identity,
                harness_image=harness_image,
                block_id=block_id,
                concurrency=concurrency,
                waves=lifecycle_waves,
                block_dir=invocation_dir / "blocks" / block_id,
                keep_containers=options.keep_containers,
                api_key=options.api_key,
                template=options.template,
            )
            driver_log = invocation_dir / "blocks" / block_id / "driver.log"
            if driver_log.exists():
                shutil.copyfile(driver_log, invocation_dir / "logs" / f"{block_id}.log")
            block_position += 1
            point_samples.extend(samples)
            lifecycle_samples.extend(samples)
            observed_max_active = max(observed_max_active, observed)
            elapsed_seconds += elapsed
        point = aggregate_e2b_lifecycle_point(
            requested_concurrency=concurrency,
            samples=point_samples,
            block_count=lifecycle_block_count,
            elapsed_seconds=elapsed_seconds,
            observed_max_active=observed_max_active,
            reference_valid=reference_valid,
            expected_blocks=lifecycle_block_count,
            waves_per_block=lifecycle_waves,
        )
        lifecycle_points.append(point)
        if concurrency == 1 and point.status == "invalid":
            _write_e2b_capacity_artifacts(
                invocation_dir=invocation_dir,
                target_ref=options.target_ref,
                local_points=local_points,
                e2b_points=lifecycle_points,
                lifecycle_samples=lifecycle_samples,
                service_blocks=[],
                identity=identity,
                environment=environment,
                options=options,
                quota=None,
            )
            raise BenchmarkCommandError(
                f"real E2B c1 lifecycle contract failed; inspect {invocation_dir}"
            )

    service_blocks: list[BlockResult] = []
    service_points: list[CapacityPoint] = []
    service_block_count = 1 if options.quick else 2
    for matrix_point in build_e2b_service_capacity_matrix():
        point_blocks: list[BlockResult] = []
        for block_index in range(service_block_count):
            block_id = f"{matrix_point.scenario_id}-candidate-{block_index}"
            block_dir = invocation_dir / "blocks" / block_id
            overrides = {
                **secret_environment,
                "BENCH_RESULT_SCENARIO_ID": matrix_point.scenario_id,
                "BENCH_CONCURRENCY": str(matrix_point.requested_concurrency),
                "BENCH_BINDING_POOL_SIZE": str(matrix_point.requested_concurrency),
                "BENCH_WARMUP_ONCE_PER_WORKER": "1",
            }
            if not options.quick:
                overrides.update(
                    {
                        "BENCH_WARMUP_RUNS": "",
                        "BENCH_TRIAL_RUNS": "",
                        "BENCH_WARMUP_SECONDS": "1",
                        "BENCH_DURATION_SECONDS": "0.001",
                        "BENCH_MIN_SUCCESSFUL_RUNS": "50",
                        "BENCH_MAX_DURATION_SECONDS": "120",
                    }
                )
            try:
                block = _run_compose_block(
                    root=root,
                    profile="e2b",
                    invocation_id=invocation_dir.name,
                    block_position=block_position,
                    identity=identity,
                    harness_image=harness_image,
                    scenario_id=matrix_point.source_scenario_id,
                    block_id=block_id,
                    pair_index=block_index,
                    block_dir=block_dir,
                    keep_containers=options.keep_containers,
                    quick=options.quick,
                    environment_overrides=overrides,
                )
            except BenchmarkCommandError as exc:
                raise BenchmarkCommandError(
                    str(exc).replace(options.api_key, "[redacted]")
                ) from exc
            finally:
                _redact_secret_in_directory(block_dir, options.api_key)
            point_blocks.append(block)
            service_blocks.append(block)
            block_position += 1
            service_log = block_dir / "services.log"
            if service_log.exists():
                shutil.copyfile(service_log, invocation_dir / "logs" / f"{block_id}.log")
        point = aggregate_local_capacity_point(
            profile="e2b",
            workload=matrix_point.workload,
            scenario_id=matrix_point.scenario_id,
            requested_concurrency=matrix_point.requested_concurrency,
            blocks=point_blocks,
            reference_valid=reference_valid,
            expected_blocks=service_block_count,
            minimum_samples=2 if options.quick else 100,
        )
        point = enrich_e2b_service_point(
            point,
            workload=matrix_point.workload,
            blocks=point_blocks,
        )
        service_points.append(point)
        if matrix_point.requested_concurrency == 1 and point.status == "invalid":
            all_e2b_points = [*lifecycle_points, *service_points]
            _write_e2b_capacity_artifacts(
                invocation_dir=invocation_dir,
                target_ref=options.target_ref,
                local_points=local_points,
                e2b_points=all_e2b_points,
                lifecycle_samples=lifecycle_samples,
                service_blocks=service_blocks,
                identity=identity,
                environment=environment,
                options=options,
                quota=None,
            )
            raise BenchmarkCommandError(
                f"real E2B c1 service contract failed; inspect {invocation_dir}"
            )

    e2b_points = [*lifecycle_points, *service_points]
    quota = build_quota_recommendation(
        local_points=local_points,
        e2b_points=e2b_points,
        e2b_max_concurrency=options.max_concurrency,
        e2b_max_inventory=options.max_inventory,
        pilot_tenant_count=options.pilot_tenant_count,
    )
    _write_e2b_capacity_artifacts(
        invocation_dir=invocation_dir,
        target_ref=options.target_ref,
        local_points=local_points,
        e2b_points=e2b_points,
        lifecycle_samples=lifecycle_samples,
        service_blocks=service_blocks,
        identity=identity,
        environment=environment,
        options=options,
        quota=quota,
    )
    if any(point.status == "invalid" for point in e2b_points):
        raise BenchmarkCommandError(f"E2B capacity correctness failed; inspect {invocation_dir}")
    logger.info("E2B capacity results: %s", invocation_dir)
    return invocation_dir


def _resolve_capacity_results_dir(root: Path, options: E2BCapacityOptions) -> Path:
    if options.capacity_results_dir is not None:
        invocation_dir = options.capacity_results_dir.resolve()
    else:
        results_root = options.results_root or root / "dify-agent" / "benchmarks" / "results"
        pointer = results_root / "latest-capacity.txt"
        if not pointer.is_file():
            raise BenchmarkCommandError(
                "Local capacity result is required; run bench-docker-capacity first"
            )
        invocation_dir = Path(pointer.read_text().strip()).resolve()
    if not (invocation_dir / "local-capacity.json").is_file():
        raise BenchmarkCommandError(
            f"{invocation_dir} does not contain local-capacity.json"
        )
    (invocation_dir / "logs").mkdir(exist_ok=True)
    return invocation_dir


def _verify_capacity_target_matches(
    local_payload: object,
    identity: TargetIdentity,
    invocation_dir: Path,
) -> None:
    if not isinstance(local_payload, dict):
        raise BenchmarkCommandError(f"invalid Local capacity payload in {invocation_dir}")
    identities = local_payload.get("identities")
    agent_identity = identities.get("agent") if isinstance(identities, dict) else None
    components = (
        agent_identity.get("components") if isinstance(agent_identity, dict) else None
    )
    agent_component = components.get("agent") if isinstance(components, dict) else None
    local_commit = (
        agent_component.get("commit") if isinstance(agent_component, dict) else None
    )
    if not isinstance(local_commit, str):
        raise BenchmarkCommandError(
            f"Local capacity identity is incomplete in {invocation_dir}"
        )
    e2b_commit = identity.components["agent"].commit
    if local_commit != e2b_commit:
        raise BenchmarkCommandError(
            f"Local capacity Agent commit {local_commit} differs from E2B target {e2b_commit}"
        )


def _verify_capacity_environment_matches(
    invocation_dir: Path,
    e2b_environment: EnvironmentFingerprint,
) -> None:
    environment_path = invocation_dir / "environment.json"
    payload = json.loads(environment_path.read_text())
    profiles = payload.get("profiles") if isinstance(payload, dict) else None
    agent_payload = profiles.get("agent") if isinstance(profiles, dict) else None
    capability_payload = (
        profiles.get("capability") if isinstance(profiles, dict) else None
    )
    if not isinstance(agent_payload, dict) or not isinstance(capability_payload, dict):
        raise BenchmarkCommandError(
            f"Local environment fingerprints are incomplete in {environment_path}"
        )
    agent_environment = EnvironmentFingerprint.model_validate(agent_payload)
    capability_environment = EnvironmentFingerprint.model_validate(capability_payload)
    mismatches: list[str] = []
    if {
        agent_environment.harness_hash,
        capability_environment.harness_hash,
    } != {e2b_environment.harness_hash}:
        mismatches.append("harness hash")
    if (
        capability_environment.scenario_manifest_hash
        != e2b_environment.scenario_manifest_hash
    ):
        mismatches.append("capability scenario manifest")
    for name, local_value, e2b_value in (
        ("OS", agent_environment.os, e2b_environment.os),
        ("architecture", agent_environment.architecture, e2b_environment.architecture),
        ("CPU model", agent_environment.cpu_model, e2b_environment.cpu_model),
        ("Docker Engine", agent_environment.docker_engine, e2b_environment.docker_engine),
        ("Docker CPU allocation", agent_environment.docker_cpus, e2b_environment.docker_cpus),
        (
            "Docker memory allocation",
            agent_environment.docker_memory_bytes,
            e2b_environment.docker_memory_bytes,
        ),
    ):
        if local_value != e2b_value:
            mismatches.append(name)
    for name, local_value, e2b_value in (
        ("Redis image", agent_environment.redis_image, e2b_environment.redis_image),
        (
            "Redis config",
            agent_environment.redis_config_hash,
            e2b_environment.redis_config_hash,
        ),
        (
            "Agent resource limit",
            agent_environment.resource_limits.get("agent"),
            e2b_environment.resource_limits.get("agent"),
        ),
        (
            "Redis resource limit",
            agent_environment.resource_limits.get("redis"),
            e2b_environment.resource_limits.get("redis"),
        ),
        (
            "Fake resource limit",
            agent_environment.resource_limits.get("fake-deps"),
            e2b_environment.resource_limits.get("fake-deps"),
        ),
    ):
        if local_value != e2b_value:
            mismatches.append(name)
    if mismatches:
        raise BenchmarkCommandError(
            "Local and E2B capacity evidence is not comparable: "
            + ", ".join(mismatches)
        )


def _run_e2b_lifecycle_block(
    *,
    root: Path,
    invocation_id: str,
    block_position: int,
    identity: TargetIdentity,
    harness_image: str,
    block_id: str,
    concurrency: int,
    waves: int,
    block_dir: Path,
    keep_containers: bool,
    api_key: str,
    template: str,
) -> tuple[list[E2BLifecycleSample], int, float]:
    block_dir.mkdir(parents=True)
    project = _compose_project_name(
        invocation_id,
        "e2b",
        block_id,
        block_position,
        identity.kind,
    )
    compose_file = root / "dify-agent" / "benchmarks" / _PROFILE_COMPOSE["e2b"]
    environment = _compose_environment(
        identity=identity,
        harness_image=harness_image,
        block_dir=block_dir,
        scenario_id=block_id,
        block_id=block_id,
        pair_index=block_position,
        quick=False,
    )
    environment.update(
        {
            "BENCH_E2B_API_KEY": api_key,
            "BENCH_E2B_TEMPLATE": template,
            "BENCH_CONCURRENCY": str(concurrency),
            "BENCH_E2B_WAVES": str(waves),
        }
    )
    compose = ["docker", "compose", "-f", str(compose_file), "-p", project]
    driver_result: subprocess.CompletedProcess[str] | None = None
    try:
        driver_result = _run_command(
            [*compose, "run", "--rm", "-T", "--no-deps", "e2b-lifecycle-driver"],
            env=environment,
            check=False,
        )
        driver_log = (driver_result.stdout + driver_result.stderr).replace(
            api_key,
            "[redacted]",
        )
        (block_dir / "driver.log").write_text(driver_log)
        result_path = block_dir / "e2b-lifecycle.json"
        if not result_path.is_file():
            raise BenchmarkCommandError(
                f"E2B lifecycle driver did not write {result_path}\n{driver_log}"
            )
        payload = json.loads(result_path.read_text())
        samples_raw = payload.get("samples")
        if not isinstance(samples_raw, list):
            raise BenchmarkCommandError(f"invalid E2B lifecycle samples in {result_path}")
        samples = [E2BLifecycleSample.model_validate(sample) for sample in samples_raw]
        observed_max_active = int(payload.get("observed_max_active", 0))
        elapsed_seconds = float(payload.get("elapsed_seconds", 0))
        return samples, observed_max_active, elapsed_seconds
    finally:
        _redact_secret_in_directory(block_dir, api_key)
        if keep_containers and driver_result is not None and driver_result.returncode != 0:
            logger.warning("E2B lifecycle driver failed in Compose project %s", project)
        else:
            _ = _run_command(
                [*compose, "down", "-v", "--remove-orphans"],
                env=environment,
                check=False,
            )


def _write_e2b_capacity_artifacts(
    *,
    invocation_dir: Path,
    target_ref: str,
    local_points: Sequence[CapacityPoint],
    e2b_points: Sequence[CapacityPoint],
    lifecycle_samples: Sequence[E2BLifecycleSample],
    service_blocks: Sequence[BlockResult],
    identity: TargetIdentity,
    environment: EnvironmentFingerprint,
    options: E2BCapacityOptions,
    quota: QuotaRecommendation | None,
) -> None:
    reference_valid = bool(
        local_points
        and e2b_points
        and all(point.reference_valid for point in [*local_points, *e2b_points])
    )
    _write_json(
        invocation_dir / "e2b-capacity.json",
        {
            "schema_version": 1,
            "mode": "e2b_capacity",
            "target_ref": target_ref,
            "reference_valid": reference_valid,
            "identity": identity.model_dump(mode="json"),
            "points": [point.model_dump(mode="json") for point in e2b_points],
        },
    )
    _write_json(
        invocation_dir / "unit-consumption.json",
        {
            "schema_version": 1,
            "units": [
                unit.model_dump(mode="json")
                for unit in build_unit_consumption([*local_points, *e2b_points])
            ],
        },
    )
    if quota is None:
        quota_payload: object = {
            "schema_version": 1,
            "status": "no_launch_recommendation",
            "reference_valid": False,
            "reasons": ["E2B correctness failed before a quota could be derived"],
        }
    else:
        quota_payload = {
            "schema_version": 1,
            **quota.model_dump(mode="json"),
        }
    _write_json(invocation_dir / "quota-recommendation.json", quota_payload)
    (invocation_dir / "capacity-report.md").write_text(
        render_capacity_markdown(
            target_ref=target_ref,
            local_points=local_points,
            e2b_points=e2b_points,
            quota=quota,
        )
    )
    environment_path = invocation_dir / "environment.json"
    existing_environment = (
        json.loads(environment_path.read_text()) if environment_path.is_file() else {}
    )
    if not isinstance(existing_environment, dict):
        existing_environment = {}
    profiles = existing_environment.setdefault("profiles", {})
    if not isinstance(profiles, dict):
        profiles = {}
        existing_environment["profiles"] = profiles
    profiles["e2b"] = environment.model_dump(mode="json")
    existing_environment["e2b_calibration"] = {
        "template": options.template,
        "vendor_max_concurrency": options.max_concurrency,
        "approved_inventory_limit": options.max_inventory,
        "pilot_tenant_count": options.pilot_tenant_count,
        "reference_valid": reference_valid,
    }
    _write_json(environment_path, existing_environment)
    samples_path = invocation_dir / "samples.jsonl"
    retained_lines: list[str] = []
    if samples_path.is_file():
        for line in samples_path.read_text().splitlines():
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                retained_lines.append(line)
                continue
            if isinstance(record, dict) and (
                record.get("kind") == "e2b_lifecycle"
                or record.get("profile") == "e2b"
            ):
                continue
            retained_lines.append(line)
    with samples_path.open("w") as output:
        for line in retained_lines:
            output.write(line)
            output.write("\n")
        for sample in lifecycle_samples:
            output.write(
                json.dumps(
                    {
                        "kind": "e2b_lifecycle",
                        "sample": sample.model_dump(mode="json"),
                    },
                    sort_keys=True,
                )
            )
            output.write("\n")
        for block in service_blocks:
            for sample in block.samples:
                output.write(sample.model_dump_json())
                output.write("\n")


def _redact_secret_in_directory(directory: Path, secret: str) -> None:
    if not secret or not directory.exists():
        return
    for path in directory.rglob("*"):
        if not path.is_file():
            continue
        try:
            content = path.read_text()
        except (OSError, UnicodeDecodeError):
            continue
        if secret in content:
            path.write_text(content.replace(secret, "[redacted]"))


def build_comparison(
    *,
    baseline_result: TargetResult,
    candidate_result: TargetResult,
    scenario_ids: Sequence[str],
) -> ComparisonReport:
    compatibility_errors = _compatibility_errors(baseline_result, candidate_result)
    scenarios = [
        _compare_scenario(
            profile=baseline_result.profile,
            scenario_id=scenario_id,
            baseline_blocks=[block for block in baseline_result.blocks if block.scenario_id == scenario_id],
            candidate_blocks=[block for block in candidate_result.blocks if block.scenario_id == scenario_id],
        )
        for scenario_id in scenario_ids
    ]
    if baseline_result.target.content_hash == candidate_result.target.content_hash:
        _downgrade_identical_target_noise(scenarios)
    compatible = not compatibility_errors
    if not compatible or any(not scenario.valid for scenario in scenarios):
        overall: Literal["no_regression", "possible_regression", "inconclusive", "invalid"] = "invalid"
    elif any(
        metric.verdict == "possible_regression" for scenario in scenarios for metric in _decision_metrics(scenario)
    ):
        overall = "possible_regression"
    elif any(
        metric.verdict in {"inconclusive", "unavailable"}
        for scenario in scenarios
        for metric in _decision_metrics(scenario)
    ):
        overall = "inconclusive"
    else:
        overall = "no_regression"
    return ComparisonReport(
        profile=baseline_result.profile,
        baseline=baseline_result.target,
        candidate=candidate_result.target,
        environment=baseline_result.environment,
        compatible=compatible,
        compatibility_errors=compatibility_errors,
        overall_verdict=overall,
        scenarios=scenarios,
    )


def _downgrade_identical_target_noise(scenarios: Sequence[ScenarioComparison]) -> None:
    """Treat measured deltas between identical production inputs as local noise."""
    for scenario in scenarios:
        metrics = [
            scenario.success_rate,
            scenario.service_time_mean_ms,
            scenario.start_delay_p95_ms,
            scenario.runtime_overhead_p95_ms,
            scenario.successful_operations_per_second,
            scenario.useful_payload_mib_per_second,
            scenario.total_cpu_seconds_per_successful_operation,
            scenario.total_memory_gb_seconds_per_successful_operation,
            *scenario.component_cpu_seconds_per_successful_operation.values(),
            *scenario.component_memory_gb_seconds_per_successful_operation.values(),
            *scenario.behavior_changes.values(),
            *scenario.redis_command_mix.values(),
        ]
        for metric in metrics:
            if metric.verdict in {"possible_regression", "behavior_change"}:
                metric.verdict = "inconclusive"


def _compare_scenario(
    *,
    profile: BenchmarkProfile,
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

    start_field: Callable[[RunSample], float | None]
    start_field = (
        (lambda sample: sample.first_output_ms)
        if profile == "runtime"
        else (lambda sample: sample.time_to_first_event_ms)
    )
    start_baseline, start_candidate = _sample_blocks_by_pair(
        baseline_by_pair,
        candidate_by_pair,
        getter=start_field,
    )
    overhead_baseline, overhead_candidate = _sample_blocks_by_pair(
        baseline_by_pair,
        candidate_by_pair,
        getter=lambda sample: sample.runtime_overhead_ms,
    )
    workload_consistent = all(
        sample.terminal_status == "succeeded"
        and sample.ledger_valid
        and sample.event_replay_valid
        and sample.cleanup_valid
        for block in [*baseline_blocks, *candidate_blocks]
        for sample in block.samples
    )
    if not workload_consistent:
        invalid_reasons.append("terminal state, output/ledger, replay, or cleanup differed")

    components = _PROFILE_PRIMARY_COMPONENTS[profile]
    component_cpu = {
        component: _compare_block_resource(
            baseline_by_pair,
            candidate_by_pair,
            component=component,
            kind="cpu",
        )
        for component in components
    }
    component_memory = {
        component: _compare_block_resource(
            baseline_by_pair,
            candidate_by_pair,
            component=component,
            kind="memory",
        )
        for component in components
    }
    required_stats = [*components]
    if profile in {"agent", "capability"}:
        required_stats.append("redis")
    stats_coverage_valid = all(
        all(
            service in block.resources.components and block.resources.components[service].stats_coverage.window_covered
            for service in required_stats
        )
        for block in [*baseline_blocks, *candidate_blocks]
    )
    if not stats_coverage_valid:
        invalid_reasons.append("Docker stats did not cover all primary measurement boundaries")
    baseline_fake_p99 = _maximum_resource(
        baseline_blocks,
        getter=lambda block: block.resources.fake_response_p99_ms,
    )
    candidate_fake_p99 = _maximum_resource(
        candidate_blocks,
        getter=lambda block: block.resources.fake_response_p99_ms,
    )
    if (
        baseline_fake_p99 is not None
        and candidate_fake_p99 is not None
        and baseline_fake_p99 > 0
        and candidate_fake_p99 - baseline_fake_p99 > 5
        and candidate_fake_p99 / baseline_fake_p99 > 1.5
    ):
        invalid_reasons.append("fake dependency response p99 rose enough to invalidate attribution")

    return ScenarioComparison(
        profile=profile,
        scenario_id=scenario_id,
        valid=not invalid_reasons,
        invalid_reasons=invalid_reasons,
        workload_consistent=workload_consistent,
        success_rate=_compare_block_outcome(
            baseline_by_pair,
            candidate_by_pair,
            getter=lambda block: block.outcomes.success_rate,
            direction="decrease",
            threshold=math.inf,
        ),
        service_time_mean_ms=_compare_block_outcome(
            baseline_by_pair,
            candidate_by_pair,
            getter=lambda block: block.outcomes.service_time_mean_ms,
            direction="increase",
            threshold=math.inf,
        ),
        start_delay_p95_ms=compare_blocked_quantile_latency(
            start_baseline,
            start_candidate,
            probability=0.95,
            relative_threshold_percent=math.inf,
        ),
        runtime_overhead_p95_ms=compare_blocked_quantile_latency(
            overhead_baseline,
            overhead_candidate,
            probability=0.95,
        ),
        successful_operations_per_second=_compare_block_outcome(
            baseline_by_pair,
            candidate_by_pair,
            getter=lambda block: block.outcomes.successful_operations_per_second,
            direction="decrease",
        ),
        useful_payload_mib_per_second=_compare_block_outcome(
            baseline_by_pair,
            candidate_by_pair,
            getter=lambda block: block.outcomes.useful_payload_mib_per_second,
            direction="decrease",
        ),
        component_cpu_seconds_per_successful_operation=component_cpu,
        component_memory_gb_seconds_per_successful_operation=component_memory,
        total_cpu_seconds_per_successful_operation=_compare_block_outcome(
            baseline_by_pair,
            candidate_by_pair,
            getter=lambda block: block.resources.total_cpu_seconds_per_successful_operation,
            direction="increase",
        ),
        total_memory_gb_seconds_per_successful_operation=_compare_block_outcome(
            baseline_by_pair,
            candidate_by_pair,
            getter=lambda block: block.resources.total_memory_gb_seconds_per_successful_operation,
            direction="increase",
        ),
        behavior_changes=_compare_behavior_counts(baseline_by_pair, candidate_by_pair),
        redis_command_mix=_compare_redis_command_mix(baseline_by_pair, candidate_by_pair),
        stats_coverage_valid=stats_coverage_valid,
        baseline_fake_cpu_p95_percent=_maximum_resource(
            baseline_blocks,
            getter=lambda block: block.resources.fake_cpu_p95_percent,
        ),
        candidate_fake_cpu_p95_percent=_maximum_resource(
            candidate_blocks,
            getter=lambda block: block.resources.fake_cpu_p95_percent,
        ),
        baseline_fake_response_p99_ms=baseline_fake_p99,
        candidate_fake_response_p99_ms=candidate_fake_p99,
    )


def _compare_block_resource(
    baseline_by_pair: dict[int, BlockResult],
    candidate_by_pair: dict[int, BlockResult],
    *,
    component: str,
    kind: Literal["cpu", "memory"],
) -> MetricComparison:
    def getter(block: BlockResult) -> float | None:
        resource = block.resources.components.get(component)
        if resource is None:
            return None
        if kind == "cpu":
            return resource.cpu_seconds_per_successful_operation
        return resource.memory_gb_seconds_per_successful_operation

    return _compare_block_outcome(
        baseline_by_pair,
        candidate_by_pair,
        getter=getter,
        direction="increase",
    )


def _compare_block_outcome(
    baseline_by_pair: dict[int, BlockResult],
    candidate_by_pair: dict[int, BlockResult],
    *,
    getter: Callable[[BlockResult], float | None],
    direction: Literal["increase", "decrease"],
    threshold: float = 10,
) -> MetricComparison:
    baseline, candidate = _paired_block_metric(baseline_by_pair, candidate_by_pair, getter=getter)
    return compare_paired_blocks(
        baseline,
        candidate,
        regression_direction=direction,
        relative_threshold_percent=threshold,
    )


def _sample_blocks_by_pair(
    baseline_by_pair: dict[int, BlockResult],
    candidate_by_pair: dict[int, BlockResult],
    *,
    getter: Callable[[RunSample], float | None],
) -> tuple[list[list[float]], list[list[float]]]:
    baseline_blocks: list[list[float]] = []
    candidate_blocks: list[list[float]] = []
    for pair in sorted(set(baseline_by_pair) & set(candidate_by_pair)):
        baseline = [value for sample in baseline_by_pair[pair].samples if (value := getter(sample)) is not None]
        candidate = [value for sample in candidate_by_pair[pair].samples if (value := getter(sample)) is not None]
        if baseline and candidate:
            baseline_blocks.append(baseline)
            candidate_blocks.append(candidate)
    return baseline_blocks, candidate_blocks


def _paired_block_metric(
    baseline_by_pair: dict[int, BlockResult],
    candidate_by_pair: dict[int, BlockResult],
    *,
    getter: Callable[[BlockResult], float | None],
) -> tuple[list[float], list[float]]:
    baseline_values: list[float] = []
    candidate_values: list[float] = []
    for pair in sorted(set(baseline_by_pair) & set(candidate_by_pair)):
        baseline = getter(baseline_by_pair[pair])
        candidate = getter(candidate_by_pair[pair])
        if baseline is not None and candidate is not None:
            baseline_values.append(baseline)
            candidate_values.append(candidate)
    return baseline_values, candidate_values


def _compare_behavior_counts(
    baseline_by_pair: dict[int, BlockResult],
    candidate_by_pair: dict[int, BlockResult],
) -> dict[str, MetricComparison]:
    names = {
        name for block in [*baseline_by_pair.values(), *candidate_by_pair.values()] for name in block.behavior_counts
    }
    comparisons: dict[str, MetricComparison] = {}
    for name in sorted(names):
        baseline, candidate = _paired_block_metric(
            baseline_by_pair,
            candidate_by_pair,
            getter=lambda block, key=name: block.behavior_counts.get(key, 0),
        )
        comparison = compare_paired_blocks(
            baseline,
            candidate,
            regression_direction="increase",
            relative_threshold_percent=math.inf,
        )
        if baseline and candidate:
            differences = [candidate[index] != baseline[index] for index in range(min(len(baseline), len(candidate)))]
            if differences and all(differences):
                comparison.verdict = "behavior_change"
            elif any(differences):
                comparison.verdict = "inconclusive"
        comparisons[name] = comparison
    return comparisons


def _compare_redis_command_mix(
    baseline_by_pair: dict[int, BlockResult],
    candidate_by_pair: dict[int, BlockResult],
) -> dict[str, MetricComparison]:
    names = {
        name
        for block in [*baseline_by_pair.values(), *candidate_by_pair.values()]
        for name in block.resources.redis_command_calls_per_successful_run
    }
    comparisons: dict[str, MetricComparison] = {}
    for name in sorted(names):
        baseline, candidate = _paired_block_metric(
            baseline_by_pair,
            candidate_by_pair,
            getter=lambda block, key=name: block.resources.redis_command_calls_per_successful_run.get(key, 0),
        )
        comparisons[name] = compare_redis_commands(baseline, candidate)
    return comparisons


def _run_compose_block(
    *,
    root: Path,
    profile: BenchmarkProfile,
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
    environment_overrides: dict[str, str] | None = None,
) -> BlockResult:
    block_dir.mkdir(parents=True)
    project = _compose_project_name(invocation_id, profile, scenario_id, block_position, identity.kind)
    compose_file = root / "dify-agent" / "benchmarks" / _PROFILE_COMPOSE[profile]
    environment = _compose_environment(
        identity=identity,
        harness_image=harness_image,
        block_dir=block_dir,
        scenario_id=scenario_id,
        block_id=block_id,
        pair_index=pair_index,
        quick=quick,
    )
    if environment_overrides:
        environment.update(environment_overrides)
    compose = ["docker", "compose", "-f", str(compose_file), "-p", project]
    sampler: DockerStatsSampler | None = None
    result: BlockResult | None = None
    sampler_stopped = False
    try:
        services = list(_PROFILE_SERVICES[profile])
        _run_command(
            [*compose, "up", "-d", "--wait", "--wait-timeout", "240", *services],
            env=environment,
        )
        container_ids = {
            service: _run_command([*compose, "ps", "-q", service], env=environment).stdout.strip()
            for service in services
        }
        if any(not container_id for container_id in container_ids.values()):
            raise BenchmarkCommandError(f"Compose project {project} did not expose all container ids")
        sampler = DockerStatsSampler(container_ids)
        sampler.start()
        driver_result = _run_command(
            [*compose, "run", "--rm", "-T", "--no-deps", _PROFILE_DRIVER[profile]],
            env=environment,
            check=False,
        )
        sampler.stop()
        sampler_stopped = True
        sampler.write_jsonl(block_dir / "docker-stats.jsonl")
        result_path = block_dir / "block-result.json"
        if not result_path.exists():
            raise BenchmarkCommandError(
                f"load driver did not write {result_path}\n{driver_result.stdout}{driver_result.stderr}"
            )
        result = BlockResult.model_validate_json(result_path.read_text())
        driver_resources = result.resources
        result.resources = summarize_resource_window(
            samples=sampler.samples,
            measurement_started_at_ns=result.measurement_started_at_ns,
            measurement_ended_at_ns=result.measurement_ended_at_ns,
            completed_runs=result.outcomes.successful_runs,
            measured_services=tuple(services),
        )
        result.resources.redis_commands_per_successful_run = driver_resources.redis_commands_per_successful_run
        result.resources.redis_command_calls_per_successful_run = (
            driver_resources.redis_command_calls_per_successful_run
        )
        result.resources.redis_storage_bytes_per_successful_run = (
            driver_resources.redis_storage_bytes_per_successful_run
        )
        result.resources.fake_response_p99_ms = driver_resources.fake_response_p99_ms
        if profile in {"runtime", "capability"}:
            cleanup_valid, cleanup_output = _check_runtime_cleanup(compose, environment, profile=profile)
            (block_dir / "runtime-cleanup.txt").write_text(cleanup_output)
            result.cleanup["runtime_state_empty"] = cleanup_valid
            if not cleanup_valid:
                result.invalid_reasons.append("Runtime SQLite, tmux, job artifacts, or workspace state remained")
        if profile == "capability" and result.outcomes.successful_runs:
            shell_jobs = _count_runtime_job_creates(
                compose,
                environment,
                start_ns=result.measurement_started_at_ns,
                end_ns=result.measurement_ended_at_ns,
            )
            result.behavior_counts["shell_jobs_per_operation"] = shell_jobs / result.outcomes.successful_runs
        if sampler.errors:
            result.invalid_reasons.extend(f"Docker stats error: {error}" for error in sampler.errors)
        if _fake_dependency_cpu_saturated(result.resources):
            result.invalid_reasons.append("fake dependency sustained CPU p95 exceeded 50%")
        for service in [*_PROFILE_PRIMARY_COMPONENTS[profile], *(("redis",) if profile != "runtime" else ())]:
            resource = result.resources.components.get(service)
            if resource is None or not resource.stats_coverage.window_covered:
                result.invalid_reasons.append(f"Docker stats did not cover {service} measurement boundaries")
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
            [*compose, "logs", "--no-color", "--timestamps", *_PROFILE_SERVICES[profile]],
            env=environment,
            check=False,
        )
        (block_dir / "services.log").write_text(logs.stdout + logs.stderr)
        if keep_containers and (result is None or not result.valid):
            logger.warning("keeping benchmark Compose project %s", project)
        else:
            _ = _run_command([*compose, "down", "-v", "--remove-orphans"], env=environment, check=False)


def _compose_environment(
    *,
    identity: TargetIdentity,
    harness_image: str,
    block_dir: Path,
    scenario_id: str,
    block_id: str,
    pair_index: int,
    quick: bool,
) -> dict[str, str]:
    environment = {
        **os.environ,
        "BENCH_HARNESS_IMAGE": harness_image,
        "BENCH_RESULTS_DIR": str(block_dir),
        "BENCH_TARGET": identity.kind,
        "BENCH_TARGET_ID": identity.content_hash[:16],
        "BENCH_SCENARIO_ID": scenario_id,
        "BENCH_BLOCK_ID": block_id,
        "BENCH_PAIR_INDEX": str(pair_index),
        "BENCH_AGENT_IMAGE": identity.components.get("agent", _placeholder_component("agent")).image_tag,
        "BENCH_RUNTIME_IMAGE": identity.components.get("runtime", _placeholder_component("runtime")).image_tag,
    }
    if quick:
        environment.update(
            {
                "BENCH_WARMUP_RUNS": "1",
                "BENCH_TRIAL_RUNS": "2",
                "BENCH_WARMUP_SECONDS": "",
                "BENCH_DURATION_SECONDS": "",
            }
        )
    return environment


def _check_runtime_cleanup(
    compose: list[str],
    environment: dict[str, str],
    *,
    profile: BenchmarkProfile,
) -> tuple[bool, str]:
    paths = ["/state/jobs", "/state/bench-workspaces"]
    if profile == "capability":
        paths.extend(["/state/materialized-homes", "/state/workspaces", "/state/home-snapshots"])
    script = "\n".join(
        [
            "set -eu",
            "python - <<'PY'",
            "import pathlib, sqlite3",
            "db = pathlib.Path('/state/shellctl.db')",
            "if db.exists():",
            "    with sqlite3.connect(db) as connection:",
            "        count = connection.execute('select count(*) from jobs').fetchone()[0]",
            "    assert count == 0, f'{count} SQLite job rows remain'",
            "PY",
            *[f'test ! -d {path} || test -z "$(find {path} -mindepth 1 -print -quit)"' for path in paths],
            *(
                ['test ! -d /mnt/drive || test -z "$(find /mnt/drive -mindepth 1 -print -quit)"']
                if profile == "capability"
                else []
            ),
            "if test -S /state/runtime/tmux.sock; then",
            "  sessions=\"$(tmux -S /state/runtime/tmux.sock list-sessions -F '#{session_name}' 2>/dev/null || true)\"",
            '  test -z "$sessions"',
            "fi",
        ]
    )
    check = _run_command([*compose, "exec", "-T", "runtime", "sh", "-c", script], env=environment, check=False)
    return check.returncode == 0, check.stdout + check.stderr


def _count_runtime_job_creates(
    compose: list[str],
    environment: dict[str, str],
    *,
    start_ns: int,
    end_ns: int,
) -> int:
    logs = _run_command([*compose, "logs", "--no-color", "--timestamps", "runtime"], env=environment, check=False)
    count = 0
    for line in logs.stdout.splitlines():
        if "POST /v1/jobs/run ->" not in line:
            continue
        match = re.search(r"(\d{4}-\d{2}-\d{2}T\S+Z)", line)
        if match is None:
            continue
        try:
            timestamp = datetime.fromisoformat(match.group(1).replace("Z", "+00:00"))
        except ValueError:
            continue
        timestamp_ns = int(timestamp.timestamp() * 1_000_000_000)
        if start_ns <= timestamp_ns <= end_ns:
            count += 1
    return count


def _build_harness_image(root: Path) -> str:
    harness_hash = _hash_paths(
        root,
        ("dify-agent/benchmarks", "dify-agent/pyproject.toml", "dify-agent/uv.lock"),
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


def _build_target_identity(
    root: Path,
    *,
    kind: TargetKind,
    profile: BenchmarkProfile,
    ref: str | None,
    pin_agent_ref: str | None,
    pin_runtime_ref: str | None,
) -> TargetIdentity:
    if kind == "baseline" and ref is None:
        raise ValueError("baseline ref is required")
    names = _PROFILE_PRIMARY_COMPONENTS[profile]
    components: dict[str, ComponentIdentity] = {}
    for name in names:
        component_ref = ref
        if profile == "capability" and name == "agent" and pin_agent_ref is not None:
            component_ref = pin_agent_ref
        if profile == "capability" and name == "runtime" and pin_runtime_ref is not None:
            component_ref = pin_runtime_ref
        components[name] = _build_component_image(
            root,
            kind=kind,
            name=cast(Literal["agent", "runtime"], name),
            ref=component_ref,
        )
    combined = hashlib.sha256(
        "\0".join(f"{name}:{components[name].content_hash}" for name in sorted(components)).encode()
    ).hexdigest()
    refs = sorted({component.ref for component in components.values()})
    return TargetIdentity(
        kind=kind,
        profile=profile,
        ref=refs[0]
        if len(refs) == 1
        else ", ".join(f"{name}={component.ref}" for name, component in components.items()),
        content_hash=combined,
        components=components,
    )


def _build_component_image(
    root: Path,
    *,
    kind: TargetKind,
    name: Literal["agent", "runtime"],
    ref: str | None,
) -> ComponentIdentity:
    inputs = _AGENT_INPUTS if name == "agent" else _RUNTIME_INPUTS
    if kind == "candidate" and ref is None:
        context_manager = _worktree_context(root, inputs)
    else:
        if ref is None:
            raise ValueError(f"{kind} {name} ref is required")
        context_manager = _archive_context(root, ref)
    with context_manager as (context, resolved_ref, commit, dirty):
        content_hash = _hash_paths(context, inputs)
        tag_suffix = f"{commit[:12]}-{content_hash[:12]}".lower()
        if name == "agent":
            tag = f"dify-agent-bench-{kind}:{tag_suffix}"
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
            runtime_version = _run_command(
                ["docker", "run", "--rm", "--entrypoint", "python", tag, "--version"]
            ).stdout.strip()
            lock_hash = _hash_file(context / "dify-agent" / "uv.lock")
            dependency_versions = {"python": runtime_version}
        else:
            base_tag = f"dify-agent-runtime-bench-base-{kind}:{tag_suffix}"
            tag = f"dify-agent-runtime-bench-{kind}:{tag_suffix}"
            _run_command(
                [
                    "docker",
                    "build",
                    "--progress=plain",
                    "-f",
                    "docker/Dockerfile",
                    "-t",
                    base_tag,
                    ".",
                ],
                cwd=context / "dify-agent-runtime",
            )
            _run_command(
                [
                    "docker",
                    "build",
                    "--progress=plain",
                    "-f",
                    "dify-agent/benchmarks/runtime.Dockerfile",
                    "--build-arg",
                    f"BENCH_RUNTIME_BASE_IMAGE={base_tag}",
                    "-t",
                    tag,
                    ".",
                ],
                cwd=root,
            )
            go_version = _go_module_version(context / "dify-agent-runtime" / "go.mod")
            python_version = _run_command(
                ["docker", "run", "--rm", "--entrypoint", "python", tag, "--version"]
            ).stdout.strip()
            runtime_version = go_version
            lock_hash = _hash_file(context / "dify-agent-runtime" / "go.sum")
            dependency_versions = {"go": go_version, "python": python_version}
        image = json.loads(_run_command(["docker", "image", "inspect", tag]).stdout)[0]
        return ComponentIdentity(
            name=name,
            ref=resolved_ref,
            commit=commit,
            dirty=dirty,
            content_hash=content_hash,
            lock_hash=lock_hash,
            image_tag=tag,
            image_id=str(image["Id"]),
            runtime_version=runtime_version,
            dependency_versions=dependency_versions,
        )


@contextmanager
def _worktree_context(
    root: Path,
    inputs: Sequence[str],
) -> Iterator[tuple[Path, str, str, bool]]:
    commit = _run_command(["git", "rev-parse", "HEAD"], cwd=root).stdout.strip()
    dirty = bool(_run_command(["git", "status", "--porcelain", "--", *inputs], cwd=root).stdout.strip())
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


def _prepare_base_images() -> str:
    image_ids: dict[str, str] = {}
    for image in (_PYTHON_BASE_IMAGE, _GO_BASE_IMAGE):
        pull = _run_command(["docker", "pull", "--quiet", image], check=False)
        inspect = _run_command(["docker", "image", "inspect", image], check=False)
        if inspect.returncode != 0:
            raise BenchmarkCommandError(f"could not pull or inspect base image {image}\n{pull.stderr}{inspect.stderr}")
        if pull.returncode != 0:
            logger.warning("could not refresh %s; using the local image", image)
        image_ids[image] = str(json.loads(inspect.stdout)[0]["Id"])
    return image_ids[_PYTHON_BASE_IMAGE]


def _capture_environment(
    root: Path,
    *,
    profile: BenchmarkProfile,
    python_base_image_id: str,
) -> EnvironmentFingerprint:
    docker_info = json.loads(_run_command(["docker", "info", "--format", "{{json .}}"]).stdout)
    docker_version = json.loads(_run_command(["docker", "version", "--format", "{{json .Server}}"]).stdout)
    compose_file = root / "dify-agent" / "benchmarks" / _PROFILE_COMPOSE[profile]
    manifest_name = {
        "agent": "scenarios.json",
        "runtime": "runtime_scenarios.json",
        "capability": "capability_scenarios.json",
        "e2b": "capability_scenarios.json",
    }[profile]
    manifest_file = root / "dify-agent" / "benchmarks" / manifest_name
    return EnvironmentFingerprint(
        profile=profile,
        captured_at=datetime.now(timezone.utc).isoformat(),
        os=str(docker_info.get("OperatingSystem", "")),
        architecture=str(docker_info.get("Architecture", "")),
        kernel=str(docker_info.get("KernelVersion", "")),
        cpu_model=_cpu_model(),
        docker_engine=str(docker_version.get("Version", "")),
        docker_compose=_run_command(["docker", "compose", "version", "--short"]).stdout.strip(),
        docker_desktop=str(docker_info.get("Name", "")),
        docker_cpus=int(docker_info.get("NCPU", 0)),
        docker_memory_bytes=int(docker_info.get("MemTotal", 0)),
        compose_hash=_hash_file(compose_file),
        harness_hash=_hash_paths(
            root,
            ("dify-agent/benchmarks", "dify-agent/pyproject.toml", "dify-agent/uv.lock"),
        ),
        redis_image=_REDIS_IMAGE if profile != "runtime" else "",
        redis_config_hash=hashlib.sha256(_REDIS_CONFIG.encode()).hexdigest() if profile != "runtime" else "",
        python_base_image_id=python_base_image_id,
        scenario_manifest_hash=_hash_file(manifest_file),
        resource_limits=_RESOURCE_LIMITS[profile],
    )


def _compatibility_errors(baseline: TargetResult, candidate: TargetResult) -> list[str]:
    errors: list[str] = []
    if baseline.schema_version != 3 or candidate.schema_version != 3:
        errors.append("only version 3 results can be compared")
    if baseline.profile != candidate.profile:
        errors.append("baseline and candidate profiles differ")
    if baseline.environment != candidate.environment:
        errors.append("baseline and candidate environment fingerprints differ")
    baseline_scenarios = {(block.profile, block.scenario_id, block.scenario_version) for block in baseline.blocks}
    candidate_scenarios = {(block.profile, block.scenario_id, block.scenario_version) for block in candidate.blocks}
    if baseline_scenarios != candidate_scenarios:
        errors.append("baseline and candidate scenario versions differ")
    if set(baseline.target.components) != set(candidate.target.components):
        errors.append("baseline and candidate component sets differ")
    return errors


def _write_invocation_artifacts(
    *,
    invocation_dir: Path,
    baseline_result: TargetResult,
    candidate_result: TargetResult,
    comparison: ComparisonReport,
) -> None:
    _write_json(invocation_dir / "baseline-result.json", baseline_result)
    _write_json(invocation_dir / "candidate-result.json", candidate_result)
    _write_json(invocation_dir / "comparison.json", comparison)
    with (invocation_dir / "samples.jsonl").open("w") as output:
        for block in [*baseline_result.blocks, *candidate_result.blocks]:
            for sample in block.samples:
                output.write(sample.model_dump_json())
                output.write("\n")
    (invocation_dir / "comparison.md").write_text(_render_markdown(comparison))


def _render_markdown(report: ComparisonReport) -> str:
    lines = [
        f"# Dify Agent `{report.profile}` local Docker A/B benchmark",
        "",
        f"- Overall: `{report.overall_verdict}`",
        f"- Baseline: `{report.baseline.ref}` (`{report.baseline.content_hash[:12]}`)",
        f"- Candidate: `{report.candidate.ref}` (`{report.candidate.content_hash[:12]}`)",
        f"- Environment: `{report.environment.os}` / `{report.environment.architecture}`",
        "",
        "## Primary metrics",
        "",
        "| Scenario | Workload | Success | Service mean | Start p95 | Overhead p95 | Ops/s | Payload MiB/s | CPU/op | GB-s/op |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for scenario in report.scenarios:
        lines.append(
            "| "
            + " | ".join(
                [
                    scenario.scenario_id,
                    "consistent" if scenario.workload_consistent else "invalid",
                    _format_metric(scenario.success_rate),
                    _format_metric(scenario.service_time_mean_ms),
                    _format_metric(scenario.start_delay_p95_ms),
                    _format_metric(scenario.runtime_overhead_p95_ms),
                    _format_metric(scenario.successful_operations_per_second),
                    _format_metric(scenario.useful_payload_mib_per_second),
                    _format_metric(scenario.total_cpu_seconds_per_successful_operation),
                    _format_metric(scenario.total_memory_gb_seconds_per_successful_operation),
                ]
            )
            + " |"
        )
    if report.profile == "capability":
        lines.extend(
            [
                "",
                "## Capability component costs",
                "",
                "| Scenario | Agent CPU/op | Runtime CPU/op | Agent GB-s/op | Runtime GB-s/op |",
                "|---|---:|---:|---:|---:|",
            ]
        )
        for scenario in report.scenarios:
            lines.append(
                "| "
                + " | ".join(
                    [
                        scenario.scenario_id,
                        _format_metric(scenario.component_cpu_seconds_per_successful_operation["agent"]),
                        _format_metric(scenario.component_cpu_seconds_per_successful_operation["runtime"]),
                        _format_metric(scenario.component_memory_gb_seconds_per_successful_operation["agent"]),
                        _format_metric(scenario.component_memory_gb_seconds_per_successful_operation["runtime"]),
                    ]
                )
                + " |"
            )
    lines.extend(
        [
            "",
            "## Diagnostics",
            "",
            "Behavior mix, Redis command mix, network, block I/O, PID, and peak-memory data remain in `comparison.json` "
            "and each block's `docker-stats.jsonl`; they do not determine the overall performance verdict.",
        ]
    )
    for scenario in report.scenarios:
        for reason in scenario.invalid_reasons:
            lines.append(f"- `{scenario.scenario_id}` invalid: {reason}")
    lines.extend(
        [
            "",
            "Performance classifications are report-only. Correctness, cleanup, and comparability failures make the command fail.",
            "",
        ]
    )
    return "\n".join(lines)


def _format_metric(metric: MetricComparison) -> str:
    if metric.baseline is None or metric.candidate is None:
        return "—"
    relative = "n/a" if metric.relative_change_percent is None else f"{metric.relative_change_percent:+.2f}%"
    return f"{metric.baseline:.4g} → {metric.candidate:.4g} ({relative}) `{metric.verdict}`"


def _decision_metrics(scenario: ScenarioComparison) -> tuple[MetricComparison, ...]:
    metrics = [
        scenario.runtime_overhead_p95_ms,
        scenario.successful_operations_per_second,
        scenario.total_cpu_seconds_per_successful_operation,
        scenario.total_memory_gb_seconds_per_successful_operation,
    ]
    if scenario.useful_payload_mib_per_second.verdict != "unavailable":
        metrics.append(scenario.useful_payload_mib_per_second)
    return tuple(metrics)


def _verify_docker_environment(
    root: Path,
    profile: BenchmarkProfile,
    *,
    environment_overrides: dict[str, str] | None = None,
) -> None:
    _ = _run_command(["docker", "info"])
    _ = _run_command(["docker", "compose", "version"])
    compose_file = root / "dify-agent" / "benchmarks" / _PROFILE_COMPOSE[profile]
    placeholders = {
        **os.environ,
        "BENCH_HARNESS_IMAGE": "benchmark-harness",
        "BENCH_AGENT_IMAGE": "benchmark-agent",
        "BENCH_RUNTIME_IMAGE": "benchmark-runtime",
        "BENCH_RESULTS_DIR": str(root / "dify-agent" / "benchmarks" / "results"),
        "BENCH_TARGET": "candidate",
        "BENCH_TARGET_ID": "environment-check",
        "BENCH_SCENARIO_ID": "environment-check",
        "BENCH_BLOCK_ID": "environment-check",
        "BENCH_PAIR_INDEX": "0",
    }
    if environment_overrides:
        placeholders.update(environment_overrides)
    _ = _run_command(["docker", "compose", "-f", str(compose_file), "config", "--quiet"], env=placeholders)


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


def _compose_project_name(
    invocation_id: str,
    profile: BenchmarkProfile,
    scenario_id: str,
    position: int,
    kind: TargetKind,
) -> str:
    scenario_hash = hashlib.sha256(scenario_id.encode()).hexdigest()[:8]
    project = f"dify-agent-bench-{profile}-{invocation_id}-{scenario_hash}-{position}-{kind}"
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


def _go_module_version(path: Path) -> str:
    for line in path.read_text().splitlines():
        if line.startswith("go "):
            return f"go {line.removeprefix('go ').strip()}"
    return "go unknown"


def _maximum_resource(
    blocks: Sequence[BlockResult],
    *,
    getter: Callable[[BlockResult], float | None],
) -> float | None:
    values = [value for block in blocks if (value := getter(block)) is not None]
    return max(values, default=None)


def _placeholder_component(name: Literal["agent", "runtime"]) -> ComponentIdentity:
    return ComponentIdentity(
        name=name,
        ref="unused",
        commit="unused",
        dirty=False,
        content_hash="unused",
        lock_hash="unused",
        image_tag=f"unused-{name}",
        image_id="unused",
        runtime_version="unused",
    )


def _write_json(path: Path, value: object) -> None:
    if hasattr(value, "model_dump_json"):
        path.write_text(value.model_dump_json(indent=2))  # pyright: ignore[reportAttributeAccessIssue]
    else:
        path.write_text(json.dumps(value, indent=2, sort_keys=True))


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
            f"command failed ({result.returncode}): {' '.join(command)}\n{result.stderr.decode(errors='replace')}"
        )
    return result.stdout


def _parse_args() -> tuple[str, RunOptions | CapacityOptions | E2BCapacityOptions]:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    smoke_parser = subparsers.add_parser("smoke")
    smoke_parser.add_argument("--profile", choices=("agent", "runtime", "capability"), default="agent")
    smoke_parser.add_argument("--keep-containers", action="store_true")
    smoke_parser.add_argument("--scenario")
    smoke_parser.add_argument("--full", action="store_true")
    smoke_parser.add_argument("--results-root", type=Path)
    ab_parser = subparsers.add_parser("ab")
    ab_parser.add_argument("--profile", choices=("agent", "runtime", "capability"), default="agent")
    ab_parser.add_argument("--baseline-ref", default=os.environ.get("BASE_REF", "origin/main"))
    ab_parser.add_argument("--candidate-ref", default=os.environ.get("CANDIDATE_REF") or None)
    ab_parser.add_argument("--pin-agent-ref", default=os.environ.get("PIN_AGENT_REF") or None)
    ab_parser.add_argument("--pin-runtime-ref", default=os.environ.get("PIN_RUNTIME_REF") or None)
    ab_parser.add_argument("--keep-containers", action="store_true", default=os.environ.get("KEEP_CONTAINERS") == "1")
    ab_parser.add_argument("--quick", action="store_true")
    ab_parser.add_argument("--scenario", action="append", dest="scenarios", default=[])
    ab_parser.add_argument("--results-root", type=Path)
    capacity_parser = subparsers.add_parser("capacity")
    capacity_parser.add_argument("--target-ref", default=os.environ.get("TARGET_REF", "1.16.1"))
    capacity_parser.add_argument(
        "--keep-containers",
        action="store_true",
        default=os.environ.get("KEEP_CONTAINERS") == "1",
    )
    capacity_parser.add_argument("--quick", action="store_true")
    capacity_parser.add_argument("--results-root", type=Path)
    e2b_capacity_parser = subparsers.add_parser("e2b-capacity")
    e2b_capacity_parser.add_argument("--target-ref", default=os.environ.get("TARGET_REF", "1.16.1"))
    e2b_capacity_parser.add_argument(
        "--keep-containers",
        action="store_true",
        default=os.environ.get("KEEP_CONTAINERS") == "1",
    )
    e2b_capacity_parser.add_argument("--quick", action="store_true")
    e2b_capacity_parser.add_argument("--capacity-results-dir", type=Path)
    e2b_capacity_parser.add_argument("--results-root", type=Path)
    args = parser.parse_args()
    if args.command == "capacity":
        return args.command, CapacityOptions(
            target_ref=args.target_ref,
            keep_containers=args.keep_containers,
            quick=args.quick,
            results_root=args.results_root,
        )
    if args.command == "e2b-capacity":
        return args.command, E2BCapacityOptions(
            target_ref=args.target_ref,
            api_key=_required_orchestrator_environment("BENCH_E2B_API_KEY"),
            template=_required_orchestrator_environment("BENCH_E2B_TEMPLATE"),
            max_concurrency=int(
                _required_orchestrator_environment("BENCH_E2B_MAX_CONCURRENCY")
            ),
            max_inventory=int(
                _required_orchestrator_environment("BENCH_E2B_MAX_INVENTORY")
            ),
            pilot_tenant_count=int(
                _required_orchestrator_environment("BENCH_PILOT_TENANT_COUNT")
            ),
            keep_containers=args.keep_containers,
            quick=args.quick,
            capacity_results_dir=args.capacity_results_dir,
            results_root=args.results_root,
        )
    options = RunOptions(
        profile=cast(BenchmarkProfile, args.profile),
        baseline_ref=getattr(args, "baseline_ref", "origin/main"),
        candidate_ref=getattr(args, "candidate_ref", None),
        pin_agent_ref=getattr(args, "pin_agent_ref", None),
        pin_runtime_ref=getattr(args, "pin_runtime_ref", None),
        keep_containers=args.keep_containers,
        quick=not args.full if args.command == "smoke" else args.quick,
        scenario_ids=tuple([args.scenario] if getattr(args, "scenario", None) else getattr(args, "scenarios", [])),
        results_root=args.results_root,
    )
    return args.command, options


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        command, options = _parse_args()
        if command == "smoke":
            assert isinstance(options, RunOptions)
            _ = run_smoke(
                profile=options.profile,
                keep_containers=options.keep_containers,
                results_root=options.results_root,
                scenario_id=options.scenario_ids[0] if options.scenario_ids else None,
                quick=options.quick,
            )
        elif command == "ab":
            assert isinstance(options, RunOptions)
            _ = run_ab(options)
        elif command == "capacity":
            assert isinstance(options, CapacityOptions)
            _ = run_local_capacity(options)
        else:
            assert isinstance(options, E2BCapacityOptions)
            _ = run_e2b_capacity(options)
    except (BenchmarkCommandError, ValueError):
        logger.exception("benchmark failed")
        return 1
    return 0


def _required_orchestrator_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required")
    return value


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "BenchmarkCommandError",
    "CapacityOptions",
    "E2BCapacityOptions",
    "RunOptions",
    "build_comparison",
    "repository_root",
    "run_ab",
    "run_e2b_capacity",
    "run_local_capacity",
    "run_smoke",
]
