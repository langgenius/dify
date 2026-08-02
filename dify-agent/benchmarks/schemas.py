"""Version 1 artifacts for local Runtime capacity benchmarks."""

from __future__ import annotations

from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field

from benchmarks.scenario import BenchmarkMode, CapacityWorkload


TerminalStatus = Literal["succeeded", "failed", "cancelled", "not_terminal"]
FailureKind = Literal["admission_error", "stream_error", "terminal_failed", "validation_error"]
CapacityStatus = Literal["valid", "saturated", "invalid"]


class FakeDependencyLedger(BaseModel):
    """Observed deterministic model, shell, Config, and file work for one Run."""

    benchmark_run_id: str
    scenario_id: str
    scenario_version: int
    model_calls: int = 0
    tool_calls: int = 0
    text_chunks: int = 0
    model_stream_items: int = 0
    tool_response_bytes: int = 0
    dependency_budget_ms: float = 0
    model_start_elapsed_ms: list[float] = Field(default_factory=list)
    tool_elapsed_ms: list[float] = Field(default_factory=list)
    stub_calls: dict[str, int] = Field(default_factory=dict)
    stub_elapsed_ms: list[float] = Field(default_factory=list)
    payload_bytes: int = 0
    payload_sha256: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunSample(BaseModel):
    """Per-Run latency, lifecycle, and correctness evidence."""

    mode: BenchmarkMode
    scenario_id: str
    block_id: str
    benchmark_run_id: str
    worker_index: int = Field(ge=0)
    run_id: str | None = None
    admitted: bool = False
    create_run_http_ms: float | None = None
    time_to_first_event_ms: float | None = None
    terminal_e2e_ms: float | None = None
    e2b_active_seconds: float | None = Field(default=None, ge=0)
    e2b_vcpu_count: float | None = Field(default=None, gt=0)
    e2b_memory_mib: float | None = Field(default=None, gt=0)
    event_count: int = 0
    terminal_status: TerminalStatus = "not_terminal"
    failure_kind: FailureKind | None = None
    ledger_valid: bool = False
    event_replay_valid: bool = False
    cleanup_valid: bool = False
    payload_bytes: int = 0
    error: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RedisSnapshot(BaseModel):
    """Redis counters captured at the measurement boundaries."""

    total_net_input_bytes: int = 0
    total_net_output_bytes: int = 0
    evicted_keys: int = 0
    rejected_connections: int = 0
    command_calls: dict[str, int] = Field(default_factory=dict)
    storage_bytes: int = 0

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunOutcomeSummary(BaseModel):
    """Counts and rates for one measured concurrency point."""

    attempted_runs: int = 0
    admitted_runs: int = 0
    terminal_runs: int = 0
    successful_runs: int = 0
    timeout_runs: int = 0
    throttle_runs: int = 0
    success_rate: float = Field(default=0, ge=0, le=1)
    runs_per_second: float = Field(default=0, ge=0)
    observed_max_active: int = Field(default=0, ge=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StatsCoverage(BaseModel):
    """Whether Docker samples bracketed the complete measurement window."""

    sample_count: int = 0
    in_window_sample_count: int = 0
    start_gap_ms: float | None = None
    end_gap_ms: float | None = None
    window_covered: bool = False

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class ComponentResourceSummary(BaseModel):
    """Friendly per-Run units for one Docker service."""

    cpu_ms_per_run: float | None = Field(default=None, ge=0)
    memory_peak_mib: float | None = Field(default=None, ge=0)
    network_bytes_per_run: float | None = Field(default=None, ge=0)
    peak_pids: int | None = Field(default=None, ge=0)
    stats_coverage: StatsCoverage = Field(default_factory=StatsCoverage)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class ResourceSummary(BaseModel):
    """Measured Docker resources and Redis units for one block."""

    components: dict[str, ComponentResourceSummary] = Field(default_factory=dict)
    redis_commands_per_run: float | None = Field(default=None, ge=0)
    redis_network_bytes_per_run: float | None = Field(default=None, ge=0)
    fake_cpu_p95_percent: float | None = Field(default=None, ge=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BlockResult(BaseModel):
    """Driver output for one clean scenario/concurrency Compose project."""

    schema_version: int = 1
    mode: BenchmarkMode
    scenario_id: str
    scenario_version: int
    workload: CapacityWorkload
    requested_concurrency: int = Field(ge=1)
    block_id: str
    measurement_started_at_ns: int
    measurement_ended_at_ns: int
    elapsed_seconds: float = Field(gt=0)
    outcomes: RunOutcomeSummary
    redis_before: RedisSnapshot
    redis_after: RedisSnapshot
    resources: ResourceSummary = Field(default_factory=ResourceSummary)
    samples: list[RunSample]
    cleanup: dict[str, bool] = Field(default_factory=dict)
    valid: bool
    invalid_reasons: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CapacityPoint(BaseModel):
    """One report row using only directly measured capacity units."""

    mode: BenchmarkMode
    scenario_id: str
    workload: CapacityWorkload
    requested_concurrency: int = Field(ge=1)
    observed_max_active: int = Field(ge=0)
    attempted_runs: int = Field(ge=0)
    successful_runs: int = Field(ge=0)
    timeout_runs: int = Field(ge=0)
    throttle_runs: int = Field(ge=0)
    success_rate: float = Field(ge=0, le=1)
    terminal_p95_ms: float | None = Field(default=None, ge=0)
    runs_per_second: float = Field(ge=0)
    agent_cpu_ms_per_run: float | None = Field(default=None, ge=0)
    agent_memory_peak_mib: float | None = Field(default=None, ge=0)
    e2b_active_seconds_per_run: float | None = Field(default=None, ge=0)
    redis_commands_per_run: float | None = Field(default=None, ge=0)
    redis_network_kb_per_run: float | None = Field(default=None, ge=0)
    agent_network_kb_per_run: float | None = Field(default=None, ge=0)
    payload_mib_per_second: float | None = Field(default=None, ge=0)
    status: CapacityStatus
    reasons: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class TargetIdentity(BaseModel):
    """Current worktree and images used by one local capacity invocation."""

    commit: str
    dirty: bool
    content_hash: str
    agent_image_id: str
    runtime_image_id: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class EnvironmentFingerprint(BaseModel):
    """Local Docker host and immutable benchmark inputs."""

    captured_at: str
    os: str
    architecture: str
    kernel: str
    cpu_model: str
    docker_engine: str
    docker_compose: str
    docker_cpus: int
    docker_memory_bytes: int
    compose_hash: str
    harness_hash: str
    scenario_manifest_hash: str
    redis_image: str
    e2b_template: str | None = None
    resource_limits: dict[str, str]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CapacityResult(BaseModel):
    """Top-level local capacity result for exactly one Runtime backend."""

    schema_version: int = 1
    harness_version: int = 1
    mode: BenchmarkMode
    matrix_complete: bool
    agent_capacity_unit: dict[str, float | int]
    target: TargetIdentity
    environment: EnvironmentFingerprint
    points: list[CapacityPoint]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = [
    "BlockResult",
    "CapacityPoint",
    "CapacityResult",
    "CapacityStatus",
    "ComponentResourceSummary",
    "EnvironmentFingerprint",
    "FailureKind",
    "FakeDependencyLedger",
    "RedisSnapshot",
    "ResourceSummary",
    "RunOutcomeSummary",
    "RunSample",
    "StatsCoverage",
    "TargetIdentity",
    "TerminalStatus",
]
