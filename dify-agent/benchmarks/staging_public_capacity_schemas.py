"""Schema v6 for directional public Staging scaling observations.

The schema deliberately keeps one load block per replica/scenario/concurrency
point.  It records only count-level E2B evidence; secrets and private resource
identifiers never belong in public benchmark artifacts.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated, ClassVar, Literal, cast

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from benchmarks.staging_public_schemas import (
    StagingPublicEnvironment,
    StagingPublicRunSample,
    StagingPublicScenarioId,
)


StagingPublicCapacityConcurrency = Annotated[int, Field(ge=1, le=160)]
StagingPublicCapacityReplicaCount = Literal[1, 2, 4]
StagingPublicCapacityPhase = Literal["initial"]
StagingPublicCapacityPointStatus = Literal[
    "valid_scaling",
    "saturated",
    "e2b_limited",
    "e2b_inventory_limited",
    "invalid",
    "skipped",
]
StagingPublicCapacityStatus = Literal["passed", "degraded", "failed"]
StagingPublicCapacityConclusion = Literal[
    "directional_scaling_observed",
    "partial_scaling_observed",
    "no_clear_scaling_gain",
    "e2b_limited",
    "e2b_inventory_limited",
    "load_ceiling_insufficient",
    "invalid",
]
STAGING_PUBLIC_CAPACITY_SCENARIOS: tuple[StagingPublicScenarioId, ...] = ("basic", "shell", "config")
STAGING_PUBLIC_CAPACITY_CONCURRENCY: tuple[int, ...] = (1, 10, 20, 30, 40, 60, 80, 120, 160)
STAGING_PUBLIC_CAPACITY_RUNTIME_CONCURRENCY: tuple[int, ...] = (1, 10, 20)
STAGING_PUBLIC_CAPACITY_REPLICAS: tuple[StagingPublicCapacityReplicaCount, ...] = (1, 2, 4)
STAGING_PUBLIC_CAPACITY_SCALE_OUT_REPLICAS: tuple[StagingPublicCapacityReplicaCount, ...] = (2, 4)
_BASIC: StagingPublicScenarioId = "basic"
_RUNTIME_SCENARIOS: tuple[StagingPublicScenarioId, ...] = ("shell", "config")
STAGING_PUBLIC_CAPACITY_MATRIX = cast(
    tuple[tuple[StagingPublicScenarioId, int], ...],
    (
        tuple((_BASIC, concurrency) for concurrency in STAGING_PUBLIC_CAPACITY_CONCURRENCY)
        + tuple(
            (scenario_id, concurrency)
            for scenario_id in _RUNTIME_SCENARIOS
            for concurrency in STAGING_PUBLIC_CAPACITY_RUNTIME_CONCURRENCY
        )
    ),
)
STAGING_PUBLIC_CAPACITY_SCALING_MATRIX = cast(
    tuple[tuple[StagingPublicCapacityReplicaCount, StagingPublicScenarioId, int], ...],
    (
        tuple((1, scenario_id, concurrency) for scenario_id, concurrency in STAGING_PUBLIC_CAPACITY_MATRIX)
        + tuple(
            (backend_replicas, _BASIC, concurrency)
            for backend_replicas in STAGING_PUBLIC_CAPACITY_SCALE_OUT_REPLICAS
            for concurrency in STAGING_PUBLIC_CAPACITY_CONCURRENCY
        )
        + tuple(
            (backend_replicas, scenario_id, 10)
            for backend_replicas in STAGING_PUBLIC_CAPACITY_SCALE_OUT_REPLICAS
            for scenario_id in _RUNTIME_SCENARIOS
        )
    ),
)


class StagingPublicCapacityPointRequest(BaseModel):
    """Secret-free wire request for one isolated sustained-load block."""

    invocation_id: str = Field(min_length=1, max_length=120)
    service_api_base_url: str
    config_expected_sha256: str
    scenario_id: StagingPublicScenarioId
    requested_concurrency: StagingPublicCapacityConcurrency
    expected_backend_replicas: StagingPublicCapacityReplicaCount = 1
    block_index: int = Field(default=1, ge=1, le=1)
    phase: StagingPublicCapacityPhase = "initial"
    setup_timeout_seconds: float = Field(gt=0)
    warmup_seconds: float = Field(default=15, gt=0)
    measurement_seconds: float = Field(default=60, gt=0)
    drain_timeout_seconds: float = Field(default=180, gt=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)


class StagingPublicCapacitySetupResult(BaseModel):
    attempted_users: int = Field(default=0, ge=0)
    allocated_users: int = Field(default=0, ge=0)
    successful_users: int = Field(default=0, ge=0)
    complete: bool = False
    e2b_inventory_limited: bool = False
    errors: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _users_follow_setup_lifecycle(self) -> StagingPublicCapacitySetupResult:
        if self.successful_users > self.allocated_users:
            raise ValueError("successful_users cannot exceed allocated_users")
        if self.allocated_users > self.attempted_users:
            raise ValueError("allocated_users cannot exceed attempted_users")
        return self


class StagingPublicCapacityUserCleanup(BaseModel):
    """Sanitized cleanup evidence for one load User."""

    worker_index: int = Field(ge=0)
    attempted: bool = False
    http_status_code: int | None = Field(default=None, ge=100, le=599)
    conversation_deleted: bool = False
    complete: bool = False
    recovered_by_parent: bool = False
    error: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StagingPublicCapacityE2BObservation(BaseModel):
    """Count-only E2B evidence captured at one-second cadence."""

    running_max: int = Field(default=0, ge=0)
    paused_max: int = Field(default=0, ge=0)
    running_limit: int = Field(default=20, gt=0)
    running_limit_consecutive_seconds: int = Field(default=0, ge=0)
    limit_reached: bool = False
    vendor_throttle_observed: bool = False
    observation_complete: bool = False
    sample_count: int = Field(default=0, ge=0)
    successful_sample_count: int = Field(default=0, ge=0)
    api_error_count: int = Field(default=0, ge=0)
    error: Literal["observer_unavailable", "incomplete_samples", "api_errors"] | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _validate_counts_and_limit_signal(self) -> StagingPublicCapacityE2BObservation:
        if self.successful_sample_count > self.sample_count:
            raise ValueError("successful_sample_count cannot exceed sample_count")
        if self.api_error_count > self.sample_count:
            raise ValueError("api_error_count cannot exceed sample_count")
        expected_limit_reached = self.running_limit_consecutive_seconds >= 3
        if self.limit_reached != expected_limit_reached:
            raise ValueError("limit_reached must match three consecutive seconds at the running limit")
        return self


class StagingPublicCapacityPhysicalCleanupEvidence(BaseModel):
    """Count-only proof that logical cleanup reached physical resources."""

    checked: bool = False
    target_conversations: int = Field(default=0, ge=0)
    target_sandboxes: int = Field(default=0, ge=0)
    db_workspaces_remaining: int = Field(default=0, ge=0)
    db_bindings_remaining: int = Field(default=0, ge=0)
    vendor_sandboxes_remaining: int = Field(default=0, ge=0)
    consecutive_zero_checks: int = Field(default=0, ge=0)
    interval_seconds: float = Field(default=0, ge=0)
    complete: bool = False
    errors: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StagingPublicCapacityObservation(BaseModel):
    """One measurement transaction plus timing needed for window analysis."""

    worker_index: int = Field(ge=0)
    turn_index: int = Field(ge=0)
    admitted_offset_seconds: float = Field(ge=0)
    terminal_offset_seconds: float | None = Field(default=None, ge=0)
    completed_after_admission_window: bool = False
    sample: StagingPublicRunSample

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StagingPublicCapacityLoadResult(BaseModel):
    """Sanitized phase and load-engine evidence for one sustained block."""

    requested_users: StagingPublicCapacityConcurrency
    spawned_users: int = Field(default=0, ge=0)
    setup_ready_users: int = Field(default=0, ge=0)
    warmup_attempted: int = Field(default=0, ge=0)
    warmup_completed: int = Field(default=0, ge=0)
    warmup_operational_failures: int = Field(default=0, ge=0)
    warmup_correctness_failures: int = Field(default=0, ge=0)
    warmup_e2b_limit_failures: int = Field(default=0, ge=0)
    warmup_peak_consecutive_operational_failures: int = Field(default=0, ge=0)
    attempted: int = Field(default=0, ge=0)
    admitted: int = Field(default=0, ge=0)
    terminal: int = Field(default=0, ge=0)
    successful: int = Field(default=0, ge=0)
    observed_max_active: int = Field(default=0, ge=0)
    active_integral_seconds: float = Field(default=0, ge=0)
    active_mean: float = Field(default=0, ge=0)
    setup_duration_seconds: float = Field(default=0, ge=0)
    warmup_duration_seconds: float = Field(default=0, ge=0)
    warmup_started_at: datetime | None = None
    warmup_ended_at: datetime | None = None
    admission_duration_seconds: float = Field(default=0, ge=0)
    measurement_duration_seconds: float = Field(default=0, ge=0)
    drain_duration_seconds: float = Field(default=0, ge=0)
    drained_runs: int = Field(default=0, ge=0)
    timed_out: bool = False
    throttled_requests: int = Field(default=0, ge=0)
    timeout_requests: int = Field(default=0, ge=0)
    http_failure_requests: int = Field(default=0, ge=0)
    sse_failure_requests: int = Field(default=0, ge=0)
    correctness_failures: int = Field(default=0, ge=0)
    measurement_started_at: datetime | None = None
    measurement_ended_at: datetime | None = None
    fatal_errors: list[str] = Field(default_factory=list)
    stats: dict[str, object] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _validate_measurement_window(self) -> StagingPublicCapacityLoadResult:
        if self.warmup_e2b_limit_failures > self.warmup_operational_failures:
            raise ValueError("warmup_e2b_limit_failures cannot exceed warmup_operational_failures")
        if self.warmup_peak_consecutive_operational_failures > self.warmup_operational_failures:
            raise ValueError("warmup_peak_consecutive_operational_failures cannot exceed warmup_operational_failures")
        if (
            self.warmup_completed + self.warmup_operational_failures + self.warmup_correctness_failures
            > self.warmup_attempted
        ):
            raise ValueError("warmup outcomes cannot exceed warmup attempts")
        if self.measurement_started_at is None and any(
            (
                self.attempted,
                self.admitted,
                self.terminal,
                self.successful,
                self.observed_max_active,
                self.active_integral_seconds,
                self.active_mean,
                self.admission_duration_seconds,
                self.measurement_duration_seconds,
                self.drained_runs,
            )
        ):
            raise ValueError("measurement counters require a measurement start timestamp")
        for value in (
            self.warmup_started_at,
            self.warmup_ended_at,
            self.measurement_started_at,
            self.measurement_ended_at,
        ):
            if value is not None and (value.tzinfo is None or value.utcoffset() != timedelta(0)):
                raise ValueError("measurement timestamps must use UTC")
        if (
            self.warmup_started_at is not None
            and self.warmup_ended_at is not None
            and self.warmup_ended_at < self.warmup_started_at
        ):
            raise ValueError("warmup_ended_at cannot precede warmup_started_at")
        if (self.warmup_started_at is None) != (self.warmup_ended_at is None):
            raise ValueError("warmup timestamps must be both present or both absent")
        if (
            self.measurement_started_at is not None
            and self.measurement_ended_at is not None
            and self.measurement_ended_at < self.measurement_started_at
        ):
            raise ValueError("measurement_ended_at cannot precede measurement_started_at")
        return self


class StagingPublicCapacityExecution(BaseModel):
    """Sanitized child-process result enriched with parent-observed evidence."""

    scenario_id: StagingPublicScenarioId
    requested_concurrency: StagingPublicCapacityConcurrency
    backend_replicas: StagingPublicCapacityReplicaCount | None = None
    block_index: int = Field(default=1, ge=1, le=1)
    phase: StagingPublicCapacityPhase = "initial"
    setup: StagingPublicCapacitySetupResult
    warmup_samples: list[StagingPublicRunSample] = Field(default_factory=list)
    observations: list[StagingPublicCapacityObservation]
    cleanup: list[StagingPublicCapacityUserCleanup]
    load: StagingPublicCapacityLoadResult
    e2b_observation: StagingPublicCapacityE2BObservation | None = None
    physical_cleanup: StagingPublicCapacityPhysicalCleanupEvidence = Field(
        default_factory=StagingPublicCapacityPhysicalCleanupEvidence
    )

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StagingPublicCapacityPercentiles(BaseModel):
    p50_ms: float | None = Field(default=None, ge=0)
    p95_ms: float | None = Field(default=None, ge=0)
    p99_ms: float | None = Field(default=None, ge=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StagingPublicCapacityBucket(BaseModel):
    start_seconds: int = Field(ge=0)
    end_seconds: int = Field(gt=0)
    attempted: int = Field(default=0, ge=0)
    successful: int = Field(default=0, ge=0)
    runs_per_second: float = Field(default=0, ge=0)
    terminal_p95_ms: float | None = Field(default=None, ge=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StagingPublicCapacityMetrics(BaseModel):
    attempted: int = Field(default=0, ge=0)
    admitted: int = Field(default=0, ge=0)
    terminal: int = Field(default=0, ge=0)
    successful: int = Field(default=0, ge=0)
    success_rate: float = Field(default=0, ge=0, le=1)
    timeout_rate: float = Field(default=0, ge=0, le=1)
    throttle_rate: float = Field(default=0, ge=0, le=1)
    http_failure_rate: float = Field(default=0, ge=0, le=1)
    sse_failure_rate: float = Field(default=0, ge=0, le=1)
    # These are intentionally absent when warmup itself establishes a
    # suspected boundary. A zero would incorrectly look like measured
    # throughput even though the formal measurement window never opened.
    admission_runs_per_second: float | None = Field(default=None, ge=0)
    terminal_runs_per_second: float | None = Field(default=None, ge=0)
    active_mean: float = Field(default=0, ge=0)
    active_max: int = Field(default=0, ge=0)
    drain_duration_seconds: float = Field(default=0, ge=0)
    drained_runs: int = Field(default=0, ge=0)
    response_headers: StagingPublicCapacityPercentiles = Field(default_factory=StagingPublicCapacityPercentiles)
    first_sse: StagingPublicCapacityPercentiles = Field(default_factory=StagingPublicCapacityPercentiles)
    first_answer: StagingPublicCapacityPercentiles = Field(default_factory=StagingPublicCapacityPercentiles)
    terminal_e2e: StagingPublicCapacityPercentiles = Field(default_factory=StagingPublicCapacityPercentiles)
    buckets: list[StagingPublicCapacityBucket] = Field(default_factory=list)
    early_terminal_p95_ms: float | None = Field(default=None, ge=0)
    late_terminal_p95_ms: float | None = Field(default=None, ge=0)
    terminal_p95_change_ratio: float | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StagingPublicCapacityPoint(BaseModel):
    """Finalized evidence for one single-block scaling point."""

    scenario_id: StagingPublicScenarioId
    requested_concurrency: StagingPublicCapacityConcurrency
    backend_replicas: StagingPublicCapacityReplicaCount | None = None
    block_index: int = Field(default=1, ge=1, le=1)
    phase: StagingPublicCapacityPhase = "initial"
    status: StagingPublicCapacityPointStatus
    low_confidence: Literal[True] = True
    setup: StagingPublicCapacitySetupResult
    observations: list[StagingPublicCapacityObservation]
    cleanup: list[StagingPublicCapacityUserCleanup]
    load: StagingPublicCapacityLoadResult
    metrics: StagingPublicCapacityMetrics
    e2b_observation: StagingPublicCapacityE2BObservation | None = None
    physical_cleanup: StagingPublicCapacityPhysicalCleanupEvidence
    errors: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StagingPublicCapacityPointAggregate(BaseModel):
    """Single-block public summary retained as the report point interface."""

    scenario_id: StagingPublicScenarioId
    requested_concurrency: StagingPublicCapacityConcurrency
    backend_replicas: StagingPublicCapacityReplicaCount | None = None
    block_count: int = Field(default=1, ge=1)
    status: StagingPublicCapacityPointStatus
    low_confidence: Literal[True] = True
    terminal_runs_per_second: float | None = Field(default=None, ge=0)
    terminal_p95_ms: float | None = Field(default=None, ge=0)
    errors: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StagingPublicCapacityScenarioAssessment(BaseModel):
    scenario_id: StagingPublicScenarioId
    backend_replicas: StagingPublicCapacityReplicaCount
    correctness_status: Literal["passed", "invalid"]
    runtime_limit_signal: Literal["none", "e2b_limited"] = "none"
    suspected_boundary_lower: StagingPublicCapacityConcurrency | None = None
    suspected_boundary_upper: StagingPublicCapacityConcurrency | None = None
    validated_through: StagingPublicCapacityConcurrency | None = None
    terminal_runs_per_second_lower_bound: float | None = Field(default=None, ge=0)
    e2b_limited: bool = False
    e2b_inventory_limited: bool = False
    errors: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _runtime_scenarios_do_not_claim_capacity(self) -> StagingPublicCapacityScenarioAssessment:
        if self.scenario_id in {"shell", "config"}:
            if any(
                value is not None
                for value in (
                    self.suspected_boundary_lower,
                    self.suspected_boundary_upper,
                    self.validated_through,
                    self.terminal_runs_per_second_lower_bound,
                )
            ):
                raise ValueError("Runtime scenario assessments cannot claim a capacity boundary")
            expected_signal = "e2b_limited" if self.e2b_limited else "none"
            if self.runtime_limit_signal != expected_signal:
                raise ValueError("Runtime limit signal must match E2B limit evidence")
        elif self.runtime_limit_signal != "none":
            raise ValueError("Basic assessment cannot report a Runtime limit signal")
        return self


class StagingPublicCapacityBoundaryCandidate(BaseModel):
    scenario_id: StagingPublicScenarioId
    backend_replicas: StagingPublicCapacityReplicaCount
    lower_concurrency: StagingPublicCapacityConcurrency | None = None
    higher_concurrency: StagingPublicCapacityConcurrency
    e2b_limited: bool = False
    reasons: list[str]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)


class StagingPublicCapacityScalingAssessment(BaseModel):
    scenario_id: StagingPublicScenarioId
    replica_1_terminal_runs_per_second: float | None = Field(default=None, ge=0)
    replica_2_terminal_runs_per_second: float | None = Field(default=None, ge=0)
    replica_4_terminal_runs_per_second: float | None = Field(default=None, ge=0)
    replica_2_over_1_gain: float | None = Field(default=None, ge=0)
    replica_4_over_2_gain: float | None = Field(default=None, ge=0)
    conclusion: StagingPublicCapacityConclusion
    errors: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StagingPublicCapacityResult(BaseModel):
    schema_version: Literal[6] = 6
    harness_version: Literal[6] = 6
    mode: Literal["staging-public-e2e-scaling"] = "staging-public-e2e-scaling"
    confidence: Literal["single_block_shared_traffic"] = "single_block_shared_traffic"
    matrix_complete: bool
    status: StagingPublicCapacityStatus
    conclusion: StagingPublicCapacityConclusion
    environment: StagingPublicEnvironment
    blocks: list[StagingPublicCapacityPoint]
    points: list[StagingPublicCapacityPointAggregate]
    assessments: list[StagingPublicCapacityScenarioAssessment]
    scaling_assessments: list[StagingPublicCapacityScalingAssessment]
    errors: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StagingPublicCapacityStageResult(BaseModel):
    """One independently executed 1-, 2-, or 4-replica stage."""

    schema_version: Literal[6] = 6
    harness_version: Literal[6] = 6
    mode: Literal["staging-public-e2e-scaling-stage"] = "staging-public-e2e-scaling-stage"
    confidence: Literal["single_block_shared_traffic"] = "single_block_shared_traffic"
    backend_replicas: StagingPublicCapacityReplicaCount
    matrix_complete: bool
    status: StagingPublicCapacityStatus
    environment: StagingPublicEnvironment
    deployment_before: dict[str, object]
    deployment_after: dict[str, object]
    blocks: list[StagingPublicCapacityPoint]
    points: list[StagingPublicCapacityPointAggregate]
    assessments: list[StagingPublicCapacityScenarioAssessment]
    errors: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @field_validator("deployment_before", "deployment_after")
    @classmethod
    def _deployment_evidence_is_public(cls, value: dict[str, object]) -> dict[str, object]:
        pending: list[object] = [value]
        forbidden = {
            "authorization",
            "api_key",
            "token",
            "secret",
            "password",
            "conversation_id",
            "binding_id",
            "sandbox_id",
            "snapshot_id",
        }
        while pending:
            current = pending.pop()
            if isinstance(current, dict):
                for key, nested in current.items():
                    normalized = str(key).lower().replace("-", "_")
                    if normalized in forbidden or normalized.endswith(("_api_key", "_token", "_secret", "_password")):
                        raise ValueError("deployment evidence contained a private field")
                    pending.append(nested)
            elif isinstance(current, (list, tuple)):
                pending.extend(current)
        return value


__all__ = [
    name for name in globals() if name.startswith("StagingPublicCapacity") or name.startswith("STAGING_PUBLIC_CAPACITY")
]
