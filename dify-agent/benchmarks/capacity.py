"""Single-target capacity curves, unit consumption, and launch quota guidance."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
import math
from typing import ClassVar, Literal, Sequence

from pydantic import BaseModel, ConfigDict, Field

from benchmarks.schemas import BlockResult, ComponentResourceSummary


CapacityProfile = Literal["agent", "capability", "e2b"]
CapacityStatus = Literal["validated", "saturated", "invalid", "non_reference"]
QuotaStatus = Literal["recommended", "no_launch_recommendation"]

_CAPACITY_LEVELS = (1, 5, 10, 20)
_LOCAL_WORKLOADS: tuple[tuple[CapacityProfile, str, str, str], ...] = (
    ("agent", "single_1_chunk_c1", "single_1_chunk", "basic"),
    ("capability", "capability_shell_noop_c1", "capability_shell_noop", "shell"),
    ("capability", "capability_shell_resume_c1", "capability_shell_resume", "shell_resume"),
    ("capability", "capability_config_pull_c1", "capability_config_pull", "config_pull"),
    ("capability", "capability_drive_pull_c1", "capability_drive_pull", "drive_pull"),
    (
        "capability",
        "capability_file_roundtrip_16m_c1",
        "capability_file_roundtrip_16m",
        "file_roundtrip_16m",
    ),
)
_E2B_SERVICE_WORKLOADS: tuple[tuple[str, str, str], ...] = (
    ("capability_shell_noop_c1", "e2b_shell_noop", "shell"),
    ("capability_shell_resume_c1", "e2b_shell_resume", "shell_resume"),
    ("capability_config_pull_c1", "e2b_config_pull", "config_pull"),
    ("capability_drive_pull_c1", "e2b_drive_pull", "drive_pull"),
    ("capability_file_roundtrip_16m_c1", "e2b_file_roundtrip_16m", "file_roundtrip_16m"),
)


class CapacityMatrixPoint(BaseModel):
    """One requested workload/concurrency combination before execution."""

    profile: CapacityProfile
    workload: str
    source_scenario_id: str
    scenario_id: str
    requested_concurrency: int = Field(ge=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)


class LatencySummary(BaseModel):
    """Milliseconds at the fixed report percentiles."""

    p50: float | None = None
    p95: float | None = None
    p99: float | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CapacityPoint(BaseModel):
    """Aggregated evidence for one workload at one requested concurrency."""

    profile: CapacityProfile
    workload: str | None = None
    scenario_id: str
    requested_concurrency: int = Field(ge=1)
    observed_max_active: int = Field(ge=0)
    block_count: int = Field(ge=0)
    sample_count: int = Field(ge=0)
    attempted_operations: int = Field(ge=0)
    successful_operations: int = Field(ge=0)
    terminal_operations: int = Field(ge=0)
    success_rate: float = Field(ge=0, le=1)
    timeout_rate: float = Field(ge=0, le=1)
    throttle_rate: float = Field(ge=0, le=1)
    operations_per_second: float = Field(ge=0)
    create_http_ms: LatencySummary = Field(default_factory=LatencySummary)
    first_event_ms: LatencySummary = Field(default_factory=LatencySummary)
    terminal_e2e_ms: LatencySummary = Field(default_factory=LatencySummary)
    agent_cpu_seconds_per_operation: float | None = Field(default=None, ge=0)
    agent_memory_gb_seconds_per_operation: float | None = Field(default=None, ge=0)
    agent_peak_memory_bytes: int | None = Field(default=None, ge=0)
    redis_commands_per_operation: float | None = Field(default=None, ge=0)
    redis_storage_bytes_per_operation: float | None = Field(default=None, ge=0)
    redis_network_bytes_per_operation: float | None = Field(default=None, ge=0)
    agent_network_bytes_per_operation: float | None = Field(default=None, ge=0)
    useful_payload_mib_per_second: float | None = Field(default=None, ge=0)
    e2b_create_pause_ms: LatencySummary = Field(default_factory=LatencySummary)
    e2b_connect_acquire_ms: LatencySummary = Field(default_factory=LatencySummary)
    e2b_first_output_ms: LatencySummary = Field(default_factory=LatencySummary)
    e2b_release_pause_ms: LatencySummary = Field(default_factory=LatencySummary)
    e2b_destroy_kill_ms: LatencySummary = Field(default_factory=LatencySummary)
    e2b_active_window_seconds_per_operation: float | None = Field(default=None, ge=0)
    e2b_create_calls_per_operation: float = Field(default=0, ge=0)
    e2b_resume_calls_per_operation: float = Field(default=0, ge=0)
    e2b_pause_calls_per_operation: float = Field(default=0, ge=0)
    e2b_kill_calls_per_operation: float = Field(default=0, ge=0)
    e2b_transfer_bytes_per_operation: float = Field(default=0, ge=0)
    e2b_throttle_errors: int = Field(default=0, ge=0)
    e2b_quota_errors: int = Field(default=0, ge=0)
    e2b_not_found_errors: int = Field(default=0, ge=0)
    e2b_cleanup_errors: int = Field(default=0, ge=0)
    reference_valid: bool
    status: CapacityStatus
    reasons: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class E2BLifecycleSample(BaseModel):
    """One direct real-E2B lifecycle probe with explicit cleanup evidence."""

    block_id: str
    worker_index: int = Field(ge=0)
    wave_index: int = Field(ge=0)
    create_pause_ms: float | None = Field(default=None, ge=0)
    connect_acquire_ms: float | None = Field(default=None, ge=0)
    first_output_ms: float | None = Field(default=None, ge=0)
    release_pause_ms: float | None = Field(default=None, ge=0)
    destroy_kill_ms: float | None = Field(default=None, ge=0)
    active_window_seconds: float | None = Field(default=None, ge=0)
    success: bool = False
    throttle: bool = False
    quota: bool = False
    not_found: bool = False
    cleanup_error: bool = False
    error: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class UnitConsumption(BaseModel):
    """Portable resource units normalized to one thousand successful runs."""

    profile: CapacityProfile
    scenario_id: str
    requested_concurrency: int
    agent_vcpu_seconds_per_1000_runs: float | None = None
    agent_gb_seconds_per_1000_runs: float | None = None
    redis_commands_per_1000_runs: float | None = None
    redis_network_gib_per_1000_runs: float | None = None
    agent_network_gib_per_1000_runs: float | None = None
    e2b_active_seconds_per_1000_runs: float | None = None
    e2b_create_calls_per_1000_runs: float = 0
    e2b_resume_calls_per_1000_runs: float = 0
    e2b_transfer_gib_per_1000_runs: float = 0
    e2b_inventory_units_per_1000_bindings: int | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class QuotaRecommendation(BaseModel):
    """Conservative launch quotas derived from validated evidence and vendor limits."""

    status: QuotaStatus
    reference_valid: bool
    local_stable_concurrency: int
    e2b_stable_concurrency: int
    vendor_max_concurrency: int
    launch_global_concurrency: int | None
    launch_tenant_concurrency: int | None
    global_binding_quota: int
    tenant_binding_quota: int
    suggested_create_operations_per_second: float | None = None
    reasons: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


def build_local_capacity_matrix() -> list[CapacityMatrixPoint]:
    """Expand the checked-in compact launch matrix without mutating A/B manifests."""
    return [
        CapacityMatrixPoint(
            profile=profile,
            workload=workload,
            source_scenario_id=source_scenario_id,
            scenario_id=f"{scenario_stem}_c{concurrency}",
            requested_concurrency=concurrency,
        )
        for profile, source_scenario_id, scenario_stem, workload in _LOCAL_WORKLOADS
        for concurrency in _CAPACITY_LEVELS
    ]


def build_e2b_service_capacity_matrix() -> list[CapacityMatrixPoint]:
    """Expand Agent-through-E2B service workloads; lifecycle create is measured separately."""
    return [
        CapacityMatrixPoint(
            profile="e2b",
            workload=workload,
            source_scenario_id=source_scenario_id,
            scenario_id=f"{scenario_stem}_c{concurrency}",
            requested_concurrency=concurrency,
        )
        for source_scenario_id, scenario_stem, workload in _E2B_SERVICE_WORKLOADS
        for concurrency in _CAPACITY_LEVELS
    ]


def aggregate_e2b_lifecycle_point(
    *,
    requested_concurrency: int,
    samples: Sequence[E2BLifecycleSample],
    block_count: int,
    elapsed_seconds: float,
    observed_max_active: int,
    reference_valid: bool,
    expected_blocks: int = 2,
    waves_per_block: int = 5,
) -> CapacityPoint:
    """Convert direct lifecycle samples into the same capacity curve contract."""
    attempted = len(samples)
    successful = sum(sample.success for sample in samples)
    throttle = sum(sample.throttle for sample in samples)
    quota = sum(sample.quota for sample in samples)
    not_found = sum(sample.not_found for sample in samples)
    cleanup_errors = sum(sample.cleanup_error for sample in samples)
    expected_samples = requested_concurrency * waves_per_block * expected_blocks
    enough_concurrency = observed_max_active >= math.ceil(0.9 * requested_concurrency)
    phases_complete = all(
        sample.create_pause_ms is not None
        and sample.connect_acquire_ms is not None
        and sample.first_output_ms is not None
        and sample.release_pause_ms is not None
        and sample.destroy_kill_ms is not None
        and sample.active_window_seconds is not None
        for sample in samples
        if sample.success
    )
    correctness_valid = (
        block_count >= expected_blocks
        and attempted >= expected_samples
        and successful == attempted
        and phases_complete
        and throttle == 0
        and cleanup_errors == 0
    )
    measurement_valid = correctness_valid and enough_concurrency
    reasons: list[str] = []
    if not reference_valid:
        reasons.append("quick or smoke measurement is not capacity evidence")
    if block_count < expected_blocks:
        reasons.append(f"expected {expected_blocks} real E2B lifecycle blocks but found {block_count}")
    if attempted < expected_samples:
        reasons.append(f"expected {expected_samples} lifecycle samples but found {attempted}")
    if not enough_concurrency:
        reasons.append(
            f"observed max active {observed_max_active} was below 90% of requested concurrency {requested_concurrency}"
        )
    if successful != attempted:
        reasons.append("not every E2B lifecycle operation succeeded")
    if not phases_complete:
        reasons.append("one or more successful E2B lifecycle samples lacked phase timings")
    if throttle:
        reasons.append("E2B throttle or quota responses were observed")
    if cleanup_errors:
        reasons.append("one or more E2B resources failed explicit cleanup")
    status: CapacityStatus
    if reference_valid and measurement_valid:
        status = "validated"
    elif not reference_valid and correctness_valid:
        status = "non_reference"
    elif requested_concurrency == 1 or cleanup_errors:
        status = "invalid"
    else:
        status = "saturated"
    return CapacityPoint(
        profile="e2b",
        workload="binding_create_pause",
        scenario_id=f"e2b_binding_create_pause_c{requested_concurrency}",
        requested_concurrency=requested_concurrency,
        observed_max_active=observed_max_active,
        block_count=block_count,
        sample_count=attempted,
        attempted_operations=attempted,
        successful_operations=successful,
        terminal_operations=successful,
        success_rate=successful / attempted if attempted else 0,
        timeout_rate=sum(sample.error is not None and "timeout" in sample.error.lower() for sample in samples)
        / attempted
        if attempted
        else 0,
        throttle_rate=throttle / attempted if attempted else 0,
        operations_per_second=successful / elapsed_seconds if elapsed_seconds else 0,
        e2b_create_pause_ms=_latency([sample.create_pause_ms for sample in samples]),
        e2b_connect_acquire_ms=_latency([sample.connect_acquire_ms for sample in samples]),
        e2b_first_output_ms=_latency([sample.first_output_ms for sample in samples]),
        e2b_release_pause_ms=_latency([sample.release_pause_ms for sample in samples]),
        e2b_destroy_kill_ms=_latency([sample.destroy_kill_ms for sample in samples]),
        e2b_active_window_seconds_per_operation=_mean([sample.active_window_seconds for sample in samples]),
        e2b_create_calls_per_operation=1,
        e2b_resume_calls_per_operation=1,
        e2b_pause_calls_per_operation=2,
        e2b_kill_calls_per_operation=1,
        e2b_throttle_errors=throttle,
        e2b_quota_errors=quota,
        e2b_not_found_errors=not_found,
        e2b_cleanup_errors=cleanup_errors,
        reference_valid=reference_valid,
        status=status,
        reasons=reasons,
    )


def build_unit_consumption(points: Sequence[CapacityPoint]) -> list[UnitConsumption]:
    gib = float(1024**3)
    return [
        UnitConsumption(
            profile=point.profile,
            scenario_id=point.scenario_id,
            requested_concurrency=point.requested_concurrency,
            agent_vcpu_seconds_per_1000_runs=_scale(point.agent_cpu_seconds_per_operation, 1000),
            agent_gb_seconds_per_1000_runs=_scale(point.agent_memory_gb_seconds_per_operation, 1000),
            redis_commands_per_1000_runs=_scale(point.redis_commands_per_operation, 1000),
            redis_network_gib_per_1000_runs=_scale(point.redis_network_bytes_per_operation, 1000 / gib),
            agent_network_gib_per_1000_runs=_scale(point.agent_network_bytes_per_operation, 1000 / gib),
            e2b_active_seconds_per_1000_runs=_scale(
                point.e2b_active_window_seconds_per_operation,
                1000,
            ),
            e2b_create_calls_per_1000_runs=point.e2b_create_calls_per_operation * 1000,
            e2b_resume_calls_per_1000_runs=point.e2b_resume_calls_per_operation * 1000,
            e2b_transfer_gib_per_1000_runs=point.e2b_transfer_bytes_per_operation * 1000 / gib,
            e2b_inventory_units_per_1000_bindings=1000 if point.profile == "e2b" else None,
        )
        for point in points
    ]


def aggregate_local_capacity_point(
    *,
    profile: CapacityProfile,
    workload: str | None = None,
    scenario_id: str,
    requested_concurrency: int,
    blocks: Sequence[BlockResult],
    reference_valid: bool,
    expected_blocks: int = 3,
    minimum_samples: int = 300,
) -> CapacityPoint:
    """Aggregate Local Docker blocks without treating expected saturation as a harness failure."""
    samples = [sample for block in blocks for sample in block.samples]
    attempted = sum(block.outcomes.attempted_runs for block in blocks)
    successful = sum(block.outcomes.successful_runs for block in blocks)
    terminal = sum(block.outcomes.terminal_runs for block in blocks)
    elapsed_seconds = sum(
        max(0, block.measurement_ended_at_ns - block.measurement_started_at_ns) / 1_000_000_000 for block in blocks
    )
    timeout_count = sum(1 for sample in samples if sample.error and "timeout" in sample.error.lower())
    throttle_count = sum(
        1
        for sample in samples
        if sample.error and any(token in sample.error.lower() for token in ("throttle", "quota", "429"))
    )
    reasons = list(dict.fromkeys(reason for block in blocks for reason in block.invalid_reasons))
    fatal = any(
        token in reason.lower()
        for reason in reasons
        for token in (
            "ledger",
            "sse",
            "cleanup",
            "remained",
            "docker stats",
            "measurement boundaries",
            "redis evicted",
            "redis rejected",
        )
    )
    observed = max((block.outcomes.max_active_runs for block in blocks), default=0)
    enough_concurrency = observed >= math.ceil(0.9 * requested_concurrency)
    enough_samples = len(samples) >= minimum_samples
    minimum_samples_per_block = math.ceil(minimum_samples / expected_blocks)
    blocks_have_enough_samples = all(len(block.samples) >= minimum_samples_per_block for block in blocks)
    complete = attempted > 0 and successful == attempted and terminal == attempted
    correctness_valid = (
        len(blocks) >= expected_blocks and enough_samples and blocks_have_enough_samples and complete and not reasons
    )
    measurement_valid = correctness_valid and enough_concurrency
    if reference_valid and measurement_valid:
        status: CapacityStatus = "validated"
    elif not reference_valid and correctness_valid:
        status = "non_reference"
    elif requested_concurrency == 1 or fatal:
        status = "invalid"
    else:
        status = "saturated"
    if not reference_valid:
        reasons.append("quick or smoke measurement is not capacity evidence")
    if len(blocks) < expected_blocks:
        reasons.append(f"expected {expected_blocks} blocks but found {len(blocks)}")
    if not enough_samples:
        reasons.append(f"expected at least {minimum_samples} samples but found {len(samples)}")
    if not blocks_have_enough_samples:
        reasons.append(f"each block must contain at least {minimum_samples_per_block} samples")
    if not enough_concurrency:
        reasons.append(f"observed max active {observed} was below 90% of requested concurrency {requested_concurrency}")
    if not complete:
        reasons.append("not every attempted operation completed successfully")
    agent_resources = [(block.resources.components.get("agent"), block.outcomes.successful_runs) for block in blocks]
    redis_resources = [(block.resources.components.get("redis"), block.outcomes.successful_runs) for block in blocks]
    return CapacityPoint(
        profile=profile,
        workload=workload,
        scenario_id=scenario_id,
        requested_concurrency=requested_concurrency,
        observed_max_active=observed,
        block_count=len(blocks),
        sample_count=len(samples),
        attempted_operations=attempted,
        successful_operations=successful,
        terminal_operations=terminal,
        success_rate=successful / attempted if attempted else 0,
        timeout_rate=timeout_count / attempted if attempted else 0,
        throttle_rate=throttle_count / attempted if attempted else 0,
        operations_per_second=successful / elapsed_seconds if elapsed_seconds else 0,
        create_http_ms=_latency([sample.create_run_http_ms for sample in samples]),
        first_event_ms=_latency([sample.time_to_first_event_ms for sample in samples]),
        terminal_e2e_ms=_latency([sample.terminal_e2e_ms for sample in samples]),
        agent_cpu_seconds_per_operation=_weighted_component_metric(
            agent_resources,
            "cpu_seconds_per_successful_operation",
        ),
        agent_memory_gb_seconds_per_operation=_weighted_component_metric(
            agent_resources,
            "memory_gb_seconds_per_successful_operation",
        ),
        agent_peak_memory_bytes=max(
            (
                resource.peak_memory_delta_bytes
                for resource, _ in agent_resources
                if resource is not None and resource.peak_memory_delta_bytes is not None
            ),
            default=None,
        ),
        redis_commands_per_operation=_weighted_block_metric(
            blocks,
            lambda block: block.resources.redis_commands_per_successful_run,
        ),
        redis_storage_bytes_per_operation=_weighted_block_metric(
            blocks,
            lambda block: block.resources.redis_storage_bytes_per_successful_run,
        ),
        redis_network_bytes_per_operation=_weighted_component_metric(
            redis_resources,
            "network_bytes_per_successful_operation",
        ),
        agent_network_bytes_per_operation=_weighted_component_metric(
            agent_resources,
            "network_bytes_per_successful_operation",
        ),
        useful_payload_mib_per_second=_weighted_block_metric(
            blocks,
            lambda block: block.outcomes.useful_payload_mib_per_second,
        ),
        reference_valid=reference_valid,
        status=status,
        reasons=list(dict.fromkeys(reasons)),
    )


def enrich_e2b_service_point(
    point: CapacityPoint,
    *,
    workload: str,
    blocks: Sequence[BlockResult],
) -> CapacityPoint:
    """Add E2B lifecycle and transfer units observable at the Agent service boundary."""
    if point.profile != "e2b":
        raise ValueError("only E2B service points can be enriched")
    successful_samples = [
        sample for block in blocks for sample in block.samples if sample.terminal_status == "succeeded"
    ]
    successful = len(successful_samples)
    transfer_multiplier = 2 if workload == "file_roundtrip_16m" else 1
    updated = point.model_copy(deep=True)
    updated.workload = workload
    updated.e2b_active_window_seconds_per_operation = _mean(
        [sample.terminal_e2e_ms / 1000 for sample in successful_samples if sample.terminal_e2e_ms is not None]
    )
    updated.e2b_create_calls_per_operation = 0
    updated.e2b_resume_calls_per_operation = 1 if successful else 0
    updated.e2b_pause_calls_per_operation = 1 if successful else 0
    updated.e2b_kill_calls_per_operation = 0
    updated.e2b_transfer_bytes_per_operation = (
        sum(sample.payload_bytes for sample in successful_samples) * transfer_multiplier / successful
        if successful
        else 0
    )
    updated.e2b_not_found_errors = sum(
        sample.error is not None
        and any(token in sample.error.lower() for token in ("notfound", "not found", "no longer exists"))
        for block in blocks
        for sample in block.samples
    )
    updated.e2b_throttle_errors = sum(
        sample.error is not None and any(token in sample.error.lower() for token in ("throttle", "429"))
        for block in blocks
        for sample in block.samples
    )
    updated.e2b_quota_errors = sum(
        sample.error is not None and "quota" in sample.error.lower() for block in blocks for sample in block.samples
    )
    updated.e2b_cleanup_errors = sum(not sample.cleanup_valid for block in blocks for sample in block.samples)
    return updated


def build_quota_recommendation(
    *,
    local_points: Sequence[CapacityPoint],
    e2b_points: Sequence[CapacityPoint],
    e2b_max_concurrency: int,
    e2b_max_inventory: int,
    pilot_tenant_count: int,
) -> QuotaRecommendation:
    """Apply the fixed 50% launch-headroom policy from the capacity plan."""
    if e2b_max_concurrency < 1 or e2b_max_inventory < 1 or pilot_tenant_count < 1:
        raise ValueError("vendor limits and pilot tenant count must be positive")
    all_points = [*local_points, *e2b_points]
    reference_valid = bool(all_points) and all(point.reference_valid for point in all_points)
    local_stable = _stable_concurrency(local_points)
    e2b_stable = _stable_concurrency(e2b_points)
    global_binding_quota = math.floor(0.5 * e2b_max_inventory)
    tenant_binding_quota = max(1, math.floor(global_binding_quota / pilot_tenant_count))
    reasons: list[str] = []
    launch_global: int | None = None
    launch_tenant: int | None = None
    if not reference_valid:
        reasons.append("quick or smoke capacity evidence cannot produce a launch recommendation")
    else:
        candidate = math.floor(0.5 * min(local_stable, e2b_stable, e2b_max_concurrency))
        if candidate < 1:
            reasons.append("validated concurrency was too low to preserve 50% launch headroom")
        else:
            launch_global = candidate
            launch_tenant = max(1, math.floor(candidate / min(pilot_tenant_count, 10)))
    create_rates = [
        point.operations_per_second
        for point in e2b_points
        if point.status == "validated"
        and point.requested_concurrency <= e2b_stable
        and "binding_create_pause" in point.scenario_id
    ]
    suggested_create_rate = 0.5 * max(create_rates) if create_rates else None
    return QuotaRecommendation(
        status="recommended" if launch_global is not None else "no_launch_recommendation",
        reference_valid=reference_valid,
        local_stable_concurrency=local_stable,
        e2b_stable_concurrency=e2b_stable,
        vendor_max_concurrency=e2b_max_concurrency,
        launch_global_concurrency=launch_global,
        launch_tenant_concurrency=launch_tenant,
        global_binding_quota=global_binding_quota,
        tenant_binding_quota=tenant_binding_quota,
        suggested_create_operations_per_second=suggested_create_rate,
        reasons=reasons,
    )


def render_capacity_markdown(
    *,
    target_ref: str,
    local_points: Sequence[CapacityPoint],
    e2b_points: Sequence[CapacityPoint],
    quota: QuotaRecommendation | None,
) -> str:
    """Render the compact operator-facing parameter and quota report."""
    lines = [
        "# Dify Agent V2 capacity reference",
        "",
        f"- Target: `{target_ref}`",
        "- Scope: deterministic reference parameters; no production latency SLO",
        "- Local Runtime resource use is diagnostic and is not converted into E2B cost",
        "",
        "## Local Docker capacity curve",
        "",
        "| Scenario | Concurrency requested/observed | Status | Samples | Success | E2E p50/p95/p99 ms | Ops/s | Agent CPU-s/op | Agent GB-s/op | Redis cmds/op | Payload MiB/s |",
        "|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    lines.extend(_point_row(point) for point in local_points)
    lines.extend(
        [
            "",
            "## E2B capacity curve",
            "",
        ]
    )
    if e2b_points:
        lines.extend(
            [
                "| Scenario | Concurrency requested/observed | Status | Samples | Success | E2E p50/p95/p99 ms | Ops/s | Active s/op | Agent CPU-s/op | Redis cmds/op | Payload MiB/s |",
                "|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|",
                *(_e2b_point_row(point) for point in e2b_points),
            ]
        )
        lifecycle_points = [point for point in e2b_points if point.workload == "binding_create_pause"]
        if lifecycle_points:
            lines.extend(
                [
                    "",
                    "### E2B lifecycle p95",
                    "",
                    "| Concurrency | Create + initial pause ms | Connect/acquire ms | First shell output ms | Release/pause ms | Destroy/kill ms |",
                    "|---:|---:|---:|---:|---:|---:|",
                    *(_e2b_lifecycle_row(point) for point in lifecycle_points),
                ]
            )
    else:
        lines.append("Pending real E2B calibration; no E2B or launch quota recommendation is available.")
    lines.extend(["", "## Initial quota recommendation", ""])
    if quota is None:
        lines.append("Unavailable until Local and real E2B capacity evidence are both present.")
    else:
        lines.extend(
            [
                f"- Status: `{quota.status}`",
                f"- Local stable concurrency: `{quota.local_stable_concurrency}`",
                f"- E2B stable concurrency: `{quota.e2b_stable_concurrency}`",
                f"- Global Active Run / E2B concurrency: `{quota.launch_global_concurrency or 'unavailable'}`",
                f"- Tenant Active Run concurrency: `{quota.launch_tenant_concurrency or 'unavailable'}`",
                f"- Global Binding inventory: `{quota.global_binding_quota}`",
                f"- Tenant Binding inventory: `{quota.tenant_binding_quota}`",
                (
                    f"- Suggested Binding creates/s: `{quota.suggested_create_operations_per_second:.3f}`"
                    if quota.suggested_create_operations_per_second is not None
                    else "- Suggested Binding creates/s: `unavailable`"
                ),
            ]
        )
        if quota.reasons:
            lines.extend(["", *[f"- Reason: {reason}" for reason in quota.reasons]])
    units = build_unit_consumption([*local_points, *e2b_points])
    lines.extend(
        [
            "",
            "## Unit consumption per 1,000 successful Runs",
            "",
            "| Profile / scenario / concurrency | Agent vCPU-s | Agent GB-s | Redis commands | Redis network GiB | Agent network GiB | E2B active s | E2B create/resume calls | E2B transfer GiB |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
            *(_unit_row(unit) for unit in units),
        ]
    )
    lines.extend(
        [
            "",
            "## Interpretation",
            "",
            "- `validated` means correctness, sample coverage, actual concurrency, environment, and cleanup checks passed.",
            "- `non_reference` is a correct quick/smoke run that cannot support a launch quota.",
            "- `saturated` is a measured capacity boundary, not a harness correctness failure.",
            "- Quick and smoke measurements never produce launch quotas.",
            "- E2B active window is measured wall time and is not vendor billed time.",
            "",
        ]
    )
    return "\n".join(lines)


def _stable_concurrency(points: Sequence[CapacityPoint]) -> int:
    if not points:
        return 0
    by_scenario: dict[str, dict[int, CapacityPoint]] = defaultdict(dict)
    for point in points:
        scenario_family = point.workload or _scenario_family(point.scenario_id)
        by_scenario[scenario_family][point.requested_concurrency] = point
    common_levels = set.intersection(*(set(levels) for levels in by_scenario.values()))
    stable = 0
    for level in sorted(common_levels):
        lower_levels = [candidate for candidate in sorted(common_levels) if candidate <= level]
        if all(
            by_scenario[scenario_id][candidate].status == "validated"
            for scenario_id in by_scenario
            for candidate in lower_levels
        ):
            stable = level
        else:
            break
    return stable


def _scenario_family(scenario_id: str) -> str:
    for suffix in ("_c1", "_c5", "_c10", "_c20"):
        if scenario_id.endswith(suffix):
            return scenario_id.removesuffix(suffix)
    return scenario_id


def _scale(value: float | None, multiplier: float) -> float | None:
    return value * multiplier if value is not None else None


def _mean(values: Sequence[float | None]) -> float | None:
    observed = [value for value in values if value is not None]
    return sum(observed) / len(observed) if observed else None


def _point_row(point: CapacityPoint) -> str:
    return (
        f"| `{point.scenario_id}` | {point.requested_concurrency}/{point.observed_max_active} "
        f"| `{point.status}` | {point.sample_count} | {point.success_rate:.3f} "
        f"| {_latency_text(point.terminal_e2e_ms)} | {point.operations_per_second:.3f} "
        f"| {_number(point.agent_cpu_seconds_per_operation)} "
        f"| {_number(point.agent_memory_gb_seconds_per_operation)} "
        f"| {_number(point.redis_commands_per_operation)} "
        f"| {_number(point.useful_payload_mib_per_second)} |"
    )


def _e2b_point_row(point: CapacityPoint) -> str:
    return (
        f"| `{point.scenario_id}` | {point.requested_concurrency}/{point.observed_max_active} "
        f"| `{point.status}` | {point.sample_count} | {point.success_rate:.3f} "
        f"| {_latency_text(point.terminal_e2e_ms)} | {point.operations_per_second:.3f} "
        f"| {_number(point.e2b_active_window_seconds_per_operation)} "
        f"| {_number(point.agent_cpu_seconds_per_operation)} "
        f"| {_number(point.redis_commands_per_operation)} "
        f"| {_number(point.useful_payload_mib_per_second)} |"
    )


def _e2b_lifecycle_row(point: CapacityPoint) -> str:
    return (
        f"| {point.requested_concurrency} | {_number(point.e2b_create_pause_ms.p95)} "
        f"| {_number(point.e2b_connect_acquire_ms.p95)} "
        f"| {_number(point.e2b_first_output_ms.p95)} "
        f"| {_number(point.e2b_release_pause_ms.p95)} "
        f"| {_number(point.e2b_destroy_kill_ms.p95)} |"
    )


def _unit_row(unit: UnitConsumption) -> str:
    return (
        f"| `{unit.profile}/{unit.scenario_id}/c{unit.requested_concurrency}` "
        f"| {_number(unit.agent_vcpu_seconds_per_1000_runs)} "
        f"| {_number(unit.agent_gb_seconds_per_1000_runs)} "
        f"| {_number(unit.redis_commands_per_1000_runs)} "
        f"| {_number(unit.redis_network_gib_per_1000_runs)} "
        f"| {_number(unit.agent_network_gib_per_1000_runs)} "
        f"| {_number(unit.e2b_active_seconds_per_1000_runs)} "
        f"| {_number(unit.e2b_create_calls_per_1000_runs)}/"
        f"{_number(unit.e2b_resume_calls_per_1000_runs)} "
        f"| {_number(unit.e2b_transfer_gib_per_1000_runs)} |"
    )


def _latency_text(value: LatencySummary) -> str:
    return f"{_number(value.p50)}/{_number(value.p95)}/{_number(value.p99)}"


def _number(value: float | None) -> str:
    return "—" if value is None else f"{value:.4g}"


def _latency(values: Sequence[float | None]) -> LatencySummary:
    observed = sorted(value for value in values if value is not None)
    return LatencySummary(
        p50=_percentile(observed, 0.50),
        p95=_percentile(observed, 0.95),
        p99=_percentile(observed, 0.99),
    )


def _percentile(values: Sequence[float], quantile: float) -> float | None:
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    position = (len(values) - 1) * quantile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return values[lower]
    fraction = position - lower
    return values[lower] + (values[upper] - values[lower]) * fraction


def _weighted_component_metric(
    resources: Sequence[tuple[ComponentResourceSummary | None, int]],
    attribute: str,
) -> float | None:
    values: list[tuple[float, int]] = []
    for resource, weight in resources:
        if resource is None or weight <= 0:
            continue
        value = getattr(resource, attribute, None)
        if isinstance(value, (float, int)):
            values.append((float(value), weight))
    return _weighted_mean(values)


def _weighted_block_metric(
    blocks: Sequence[BlockResult],
    getter: Callable[[BlockResult], float | None],
) -> float | None:
    values: list[tuple[float, int]] = []
    for block in blocks:
        value = getter(block)
        if value is not None and block.outcomes.successful_runs > 0:
            values.append((float(value), block.outcomes.successful_runs))
    return _weighted_mean(values)


def _weighted_mean(values: Sequence[tuple[float, int]]) -> float | None:
    if not values:
        return None
    total_weight = sum(weight for _, weight in values)
    return sum(value * weight for value, weight in values) / total_weight


__all__ = [
    "CapacityMatrixPoint",
    "CapacityPoint",
    "CapacityProfile",
    "CapacityStatus",
    "E2BLifecycleSample",
    "LatencySummary",
    "QuotaRecommendation",
    "UnitConsumption",
    "aggregate_e2b_lifecycle_point",
    "aggregate_local_capacity_point",
    "build_e2b_service_capacity_matrix",
    "build_local_capacity_matrix",
    "build_quota_recommendation",
    "build_unit_consumption",
    "enrich_e2b_service_point",
    "render_capacity_markdown",
]
