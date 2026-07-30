"""Version 3 JSON artifacts shared by all local Docker benchmark profiles."""

from __future__ import annotations

from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field

from benchmarks.scenario import BenchmarkProfile


TargetKind = Literal["baseline", "candidate"]
TerminalStatus = Literal["succeeded", "failed", "cancelled", "not_terminal"]
FailureKind = Literal["admission_error", "stream_error", "terminal_failed", "cancelled", "validation_error"]
MetricVerdict = Literal[
    "no_regression",
    "possible_regression",
    "behavior_change",
    "inconclusive",
    "unavailable",
]


class FakeDependencyLedger(BaseModel):
    """Observed fake model, tool, Agent Stub, and data-plane work for one operation."""

    profile: BenchmarkProfile = "agent"
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
    """Black-box timing and correctness evidence for one Agent run or shellctl job."""

    profile: BenchmarkProfile = "agent"
    target: TargetKind
    scenario_id: str
    block_id: str
    pair_index: int = Field(ge=0)
    benchmark_run_id: str
    run_id: str | None = None
    operation_id: str | None = None
    admitted: bool = False
    create_run_http_ms: float | None = None
    time_to_first_event_ms: float | None = None
    first_output_ms: float | None = None
    terminal_e2e_ms: float | None = None
    runtime_overhead_ms: float | None = None
    event_count: int = 0
    terminal_status: TerminalStatus
    failure_kind: FailureKind | None = None
    ledger_valid: bool = False
    event_replay_valid: bool = False
    output_bytes: int = 0
    output_sha256: str | None = None
    payload_bytes: int = 0
    exit_code: int | None = None
    delete_ms: float | None = None
    cleanup_valid: bool = False
    fake_model_start_elapsed_ms: list[float] = Field(default_factory=list)
    fake_tool_elapsed_ms: list[float] = Field(default_factory=list)
    fake_stub_elapsed_ms: list[float] = Field(default_factory=list)
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
    """Operation lifecycle, throughput, and useful-payload summary for one block."""

    attempted_runs: int = 0
    admitted_runs: int = 0
    terminal_runs: int = 0
    successful_runs: int = 0
    admission_rate: float = 0
    terminal_rate: float = 0
    success_rate: float = 0
    terminal_runs_per_second: float = 0
    successful_runs_per_second: float = 0
    successful_operations_per_second: float = 0
    service_time_mean_ms: float | None = None
    useful_payload_mib_per_second: float | None = None
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


class ComponentResourceSummary(BaseModel):
    """Normalized resource efficiency plus retained raw diagnostics."""

    cpu_seconds_per_successful_operation: float | None = None
    peak_memory_delta_bytes: int | None = None
    memory_gb_seconds_per_successful_operation: float | None = None
    network_bytes_per_successful_operation: float | None = None
    block_read_bytes_per_successful_operation: float | None = None
    block_write_bytes_per_successful_operation: float | None = None
    peak_pids: int | None = None
    stats_coverage: StatsCoverage = Field(default_factory=StatsCoverage)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class ResourceSummary(BaseModel):
    """Per-component and total resource cost for one measured block."""

    components: dict[str, ComponentResourceSummary] = Field(default_factory=dict)
    total_cpu_seconds_per_successful_operation: float | None = None
    total_memory_gb_seconds_per_successful_operation: float | None = None
    redis_commands_per_successful_run: float | None = None
    redis_command_calls_per_successful_run: dict[str, float] = Field(default_factory=dict)
    redis_storage_bytes_per_successful_run: float | None = None
    fake_cpu_p95_percent: float | None = None
    fake_response_p99_ms: float | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BlockResult(BaseModel):
    """Result emitted by one clean Compose project for one target/scenario block."""

    schema_version: int = 3
    harness_version: int = 3
    profile: BenchmarkProfile = "agent"
    target: TargetKind
    target_id: str
    scenario_id: str
    scenario_version: int
    block_id: str
    pair_index: int = Field(ge=0)
    measurement_started_at_ns: int
    measurement_ended_at_ns: int
    outcomes: RunOutcomeSummary = Field(default_factory=RunOutcomeSummary)
    redis_before: RedisSnapshot | None = None
    redis_after: RedisSnapshot | None = None
    resources: ResourceSummary = Field(default_factory=ResourceSummary)
    samples: list[RunSample]
    behavior_counts: dict[str, float] = Field(default_factory=dict)
    cleanup: dict[str, bool] = Field(default_factory=dict)
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
    verdict: MetricVerdict

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class ScenarioComparison(BaseModel):
    """A/B conclusion for one stable profile scenario."""

    profile: BenchmarkProfile
    scenario_id: str
    valid: bool
    invalid_reasons: list[str] = Field(default_factory=list)
    workload_consistent: bool
    success_rate: MetricComparison
    service_time_mean_ms: MetricComparison
    start_delay_p95_ms: MetricComparison
    runtime_overhead_p95_ms: MetricComparison
    successful_operations_per_second: MetricComparison
    useful_payload_mib_per_second: MetricComparison
    component_cpu_seconds_per_successful_operation: dict[str, MetricComparison] = Field(default_factory=dict)
    component_memory_gb_seconds_per_successful_operation: dict[str, MetricComparison] = Field(default_factory=dict)
    total_cpu_seconds_per_successful_operation: MetricComparison
    total_memory_gb_seconds_per_successful_operation: MetricComparison
    behavior_changes: dict[str, MetricComparison] = Field(default_factory=dict)
    redis_command_mix: dict[str, MetricComparison] = Field(default_factory=dict)
    stats_coverage_valid: bool
    baseline_fake_cpu_p95_percent: float | None = None
    candidate_fake_cpu_p95_percent: float | None = None
    baseline_fake_response_p99_ms: float | None = None
    candidate_fake_response_p99_ms: float | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class ComponentIdentity(BaseModel):
    """Source, image, and dependency identity for one benchmarked component."""

    name: Literal["agent", "runtime"]
    ref: str
    commit: str
    dirty: bool
    content_hash: str
    lock_hash: str
    image_tag: str
    image_id: str
    runtime_version: str
    dependency_versions: dict[str, str] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class TargetIdentity(BaseModel):
    """The component set used by one side of an A/B comparison."""

    kind: TargetKind
    profile: BenchmarkProfile
    ref: str
    content_hash: str
    components: dict[str, ComponentIdentity]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class EnvironmentFingerprint(BaseModel):
    """Docker host and immutable harness inputs shared by one A/B invocation."""

    profile: BenchmarkProfile
    captured_at: str
    os: str
    architecture: str
    kernel: str
    cpu_model: str
    docker_engine: str
    docker_compose: str
    docker_desktop: str
    docker_cpus: int
    docker_memory_bytes: int
    compose_hash: str
    harness_hash: str
    redis_image: str
    redis_config_hash: str
    python_base_image_id: str
    scenario_manifest_hash: str
    resource_limits: dict[str, str] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class TargetResult(BaseModel):
    """All blocks produced for baseline or candidate."""

    schema_version: int = 3
    harness_version: int = 3
    profile: BenchmarkProfile
    target: TargetIdentity
    environment: EnvironmentFingerprint
    blocks: list[BlockResult]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class ComparisonReport(BaseModel):
    """Top-level report-only local A/B conclusion."""

    schema_version: int = 3
    harness_version: int = 3
    profile: BenchmarkProfile
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
    "ComponentIdentity",
    "ComponentResourceSummary",
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
