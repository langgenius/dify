"""JSON artifact schemas for one local service benchmark run."""

from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field


TargetKind = Literal["baseline", "candidate"]
TerminalStatus = Literal["succeeded", "failed", "cancelled", "not_terminal"]
FailureKind = Literal["admission_error", "stream_error", "terminal_failed", "cancelled", "validation_error"]


class FakeDependencyLedger(BaseModel):
    """Observed fake dependency work for one benchmark run."""

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

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunSample(BaseModel):
    """Black-box measurements and correctness evidence for one completed run."""

    target: TargetKind
    scenario_id: str
    block_id: str
    pair_index: int = Field(ge=0)
    benchmark_run_id: str
    run_id: str | None = None
    admitted: bool = False
    create_run_http_ms: float | None = None
    time_to_first_event_ms: float | None = None
    terminal_e2e_ms: float | None = None
    runtime_overhead_ms: float | None = None
    event_count: int = 0
    terminal_status: TerminalStatus
    failure_kind: FailureKind | None = None
    ledger_valid: bool = False
    event_replay_valid: bool = False
    fake_model_start_elapsed_ms: list[float] = Field(default_factory=list)
    fake_tool_elapsed_ms: list[float] = Field(default_factory=list)
    error: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RedisSnapshot(BaseModel):
    """Relevant Redis counters before or after one measurement window."""

    total_net_input_bytes: int = 0
    total_net_output_bytes: int = 0
    evicted_keys: int = 0
    rejected_connections: int = 0
    command_calls: dict[str, int] = Field(default_factory=dict)
    storage_bytes: int = 0

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunOutcomeSummary(BaseModel):
    """Correctly separated run lifecycle counts and rates for one block."""

    attempted_runs: int = 0
    admitted_runs: int = 0
    terminal_runs: int = 0
    successful_runs: int = 0
    admission_rate: float = 0
    terminal_rate: float = 0
    success_rate: float = 0
    terminal_runs_per_second: float = 0
    successful_runs_per_second: float = 0
    events_per_successful_run: float = 0
    max_active_runs: int = 0

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StatsCoverage(BaseModel):
    """Boundary and density evidence for one Docker stats series."""

    sample_count: int = 0
    in_window_sample_count: int = 0
    start_gap_ms: float | None = None
    end_gap_ms: float | None = None
    window_covered: bool = False

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class ResourceSummary(BaseModel):
    """Cost-oriented resource deltas attributed to successful runs."""

    agent_cpu_seconds_per_successful_run: float | None = None
    agent_peak_memory_delta_bytes: int | None = None
    agent_memory_gb_seconds_per_successful_run: float | None = None
    agent_network_bytes_per_successful_run: float | None = None
    redis_cpu_seconds_per_successful_run: float | None = None
    redis_memory_gb_seconds_per_successful_run: float | None = None
    redis_commands_per_successful_run: float | None = None
    redis_command_calls_per_successful_run: dict[str, float] = Field(default_factory=dict)
    redis_network_bytes_per_successful_run: float | None = None
    redis_storage_bytes_per_successful_run: float | None = None
    fake_cpu_p95_percent: float | None = None
    fake_response_p99_ms: float | None = None
    agent_stats_coverage: StatsCoverage = Field(default_factory=StatsCoverage)
    redis_stats_coverage: StatsCoverage = Field(default_factory=StatsCoverage)
    fake_stats_coverage: StatsCoverage = Field(default_factory=StatsCoverage)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BlockResult(BaseModel):
    """Result emitted by one clean Compose project for one target/scenario block."""

    schema_version: int = 2
    harness_version: int = 2
    target: TargetKind
    target_id: str
    scenario_id: str
    scenario_version: int
    block_id: str
    pair_index: int = Field(ge=0)
    measurement_started_at_ns: int
    measurement_ended_at_ns: int
    outcomes: RunOutcomeSummary = Field(default_factory=RunOutcomeSummary)
    redis_before: RedisSnapshot
    redis_after: RedisSnapshot
    resources: ResourceSummary = Field(default_factory=ResourceSummary)
    samples: list[RunSample]
    valid: bool
    invalid_reasons: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class MetricComparison(BaseModel):
    """Relative candidate change with explicit statistical method metadata."""

    baseline: float | None
    candidate: float | None
    absolute_change: float | None
    relative_change_percent: float | None
    confidence_interval_percent: tuple[float, float] | None
    method: Literal["unpaired_bootstrap", "blocked_bootstrap", "paired_block_consistency", "unavailable"]
    pair_count: int = 0
    verdict: Literal["no_regression", "possible_regression", "behavior_change", "inconclusive", "unavailable"]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class ScenarioComparison(BaseModel):
    """A/B conclusion for one stable scenario."""

    scenario_id: str
    valid: bool
    invalid_reasons: list[str] = Field(default_factory=list)
    workload_consistent: bool
    admission_rate: MetricComparison
    terminal_rate: MetricComparison
    success_rate: MetricComparison
    events_per_successful_run: MetricComparison
    create_run_http_p95_ms: MetricComparison
    time_to_first_event_p95_ms: MetricComparison
    p50_terminal_e2e_ms: MetricComparison
    p95_terminal_e2e_ms: MetricComparison
    p50_runtime_overhead_ms: MetricComparison
    p95_runtime_overhead_ms: MetricComparison
    terminal_runs_per_second: MetricComparison
    successful_runs_per_second: MetricComparison
    max_active_runs: MetricComparison
    agent_cpu_seconds_per_successful_run: MetricComparison
    agent_peak_memory_delta_bytes: MetricComparison
    agent_memory_gb_seconds_per_successful_run: MetricComparison
    agent_network_bytes_per_successful_run: MetricComparison
    redis_cpu_seconds_per_successful_run: MetricComparison
    redis_memory_gb_seconds_per_successful_run: MetricComparison
    redis_commands_per_successful_run: MetricComparison
    redis_network_bytes_per_successful_run: MetricComparison
    redis_storage_bytes_per_successful_run: MetricComparison
    redis_command_mix: dict[str, MetricComparison] = Field(default_factory=dict)
    stats_coverage_valid: bool
    baseline_fake_cpu_p95_percent: float | None = None
    candidate_fake_cpu_p95_percent: float | None = None
    baseline_fake_response_p99_ms: float | None = None
    candidate_fake_response_p99_ms: float | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class TargetIdentity(BaseModel):
    """Source and image identity for one side of a local A/B comparison."""

    kind: TargetKind
    ref: str
    commit: str
    dirty: bool
    content_hash: str
    lock_hash: str
    image_tag: str
    image_id: str
    python_version: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class EnvironmentFingerprint(BaseModel):
    """Docker host and harness identity shared by one A/B invocation."""

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
    redis_image: str
    python_base_image_id: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class TargetResult(BaseModel):
    """All blocks produced for baseline or candidate."""

    schema_version: int = 2
    harness_version: int = 2
    target: TargetIdentity
    environment: EnvironmentFingerprint
    blocks: list[BlockResult]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class ComparisonReport(BaseModel):
    """Top-level report-only local A/B conclusion."""

    schema_version: int = 2
    harness_version: int = 2
    baseline: TargetIdentity
    candidate: TargetIdentity
    environment: EnvironmentFingerprint
    compatible: bool
    compatibility_errors: list[str] = Field(default_factory=list)
    overall_verdict: Literal["no_regression", "possible_regression", "inconclusive", "invalid"]
    scenarios: list[ScenarioComparison]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = [
    "BlockResult",
    "ComparisonReport",
    "EnvironmentFingerprint",
    "FailureKind",
    "FakeDependencyLedger",
    "MetricComparison",
    "RedisSnapshot",
    "ResourceSummary",
    "RunOutcomeSummary",
    "RunSample",
    "ScenarioComparison",
    "StatsCoverage",
    "TargetKind",
    "TargetIdentity",
    "TargetResult",
    "TerminalStatus",
]
