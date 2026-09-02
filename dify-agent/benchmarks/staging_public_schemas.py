"""Schema v3 for the local-to-public Staging Agent smoke benchmark.

This schema deliberately models only behavior observable by a real Service API
caller.  Internal Agent Run identifiers, Kubernetes resources, Redis metrics,
E2B lifecycle details, and cost or capacity claims do not belong here.
"""

from __future__ import annotations

from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field

from benchmarks.staging_plugin.models.llm.contract import FILE_EXPECTED_SHA256, FILE_PAYLOAD_BYTES


StagingPublicScenarioId = Literal["basic", "shell", "config", "file"]
STAGING_PUBLIC_SCENARIO_SEQUENCE: tuple[StagingPublicScenarioId, ...] = ("basic", "shell", "config")
StagingPublicTerminalStatus = Literal["succeeded", "failed", "not_terminal"]
StagingPublicSmokeStatus = Literal["passed", "failed"]
_CONFIG_ITEM_COUNT = 13
_CONFIG_TOTAL_BYTES = 53_248


class StagingPublicRunSample(BaseModel):
    """Sanitized evidence for one public ``POST /v1/chat-messages`` stream."""

    scenario_id: StagingPublicScenarioId
    benchmark_run_id: str = Field(min_length=1, max_length=200)
    admitted: bool = False
    http_status_code: int | None = Field(default=None, ge=100, le=599)
    conversation_reused: bool = False
    response_headers_ms: float | None = Field(default=None, ge=0)
    time_to_first_sse_ms: float | None = Field(default=None, ge=0)
    time_to_first_answer_ms: float | None = Field(default=None, ge=0)
    terminal_e2e_ms: float | None = Field(default=None, ge=0)
    event_count: int = Field(default=0, ge=0)
    answer_bytes: int = Field(default=0, ge=0)
    edge_version: str | None = None
    edge_server: str | None = None
    terminal_status: StagingPublicTerminalStatus = "not_terminal"
    error_type: str | None = None
    error: str | None = None
    deterministic_markers_valid: bool = False
    shell_evidence_valid: bool = False
    config_materialized_item_count: int = Field(default=0, ge=0)
    config_materialized_bytes: int = Field(default=0, ge=0)
    config_materialized_sha256: str | None = None
    config_sha_valid: bool = False
    file_payload_bytes: int = Field(default=0, ge=0)
    file_payload_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    file_integrity_valid: bool = False

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @property
    def succeeded(self) -> bool:
        """Return whether the public transaction and scenario evidence passed."""

        if (
            not self.admitted
            or self.http_status_code != 200
            or self.response_headers_ms is None
            or self.time_to_first_sse_ms is None
            or self.time_to_first_answer_ms is None
            or self.terminal_e2e_ms is None
            or self.event_count == 0
            or self.terminal_status != "succeeded"
            or not self.deterministic_markers_valid
        ):
            return False
        if self.scenario_id == "shell":
            return self.shell_evidence_valid
        if self.scenario_id == "config":
            return (
                self.config_materialized_item_count == _CONFIG_ITEM_COUNT
                and self.config_materialized_bytes == _CONFIG_TOTAL_BYTES
                and self.config_materialized_sha256 is not None
                and self.config_sha_valid
            )
        if self.scenario_id == "file":
            return (
                self.file_payload_bytes == FILE_PAYLOAD_BYTES
                and self.file_payload_sha256 == FILE_EXPECTED_SHA256
                and self.file_integrity_valid
            )
        return True


class StagingPublicEdgeProbeEvidence(BaseModel):
    """Sanitized headers from one read-only public-edge probe."""

    method: Literal["OPTIONS"] = "OPTIONS"
    relative_path: Literal["chat-messages"] = "chat-messages"
    http_status_code: int = Field(ge=100, le=599)
    edge_version: str = Field(min_length=1, max_length=120)
    edge_server: str | None = Field(default=None, max_length=120)
    proxy_mode: Literal["disabled"] = "disabled"

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)


class StagingPublicCleanupResult(BaseModel):
    """Public conversation cleanup evidence without exposing its identifier."""

    attempted: bool = False
    http_status_code: int | None = Field(default=None, ge=100, le=599)
    conversation_deleted: bool = False
    complete: bool = False
    error: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StagingPublicEnvironment(BaseModel):
    """Non-secret local load-generator and public endpoint fingerprint."""

    captured_at: str
    invocation_id: str = Field(min_length=1, max_length=120)
    service_api_base_url: str
    harness_commit: str
    harness_dirty: bool
    target_commit: str
    target_commit_evidence: Literal["operator_asserted"] = "operator_asserted"
    scenario_manifest_sha256: str
    deterministic_plugin_version: str
    deterministic_plugin_package_sha256: str
    deterministic_plugin_package_evidence: Literal["local_expected_package"] = "local_expected_package"
    config_expected_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    e2b_observer_mode: Literal["local"] = "local"
    benchmark_scope_fingerprint: str | None = Field(
        default=None,
        pattern=r"^hmac-sha256:[0-9a-f]{64}$",
    )
    python_version: str
    locust_version: str
    load_generator: Literal["local"] = "local"
    network_path: Literal["local_to_public_edge"] = "local_to_public_edge"
    environment_proxy_disabled: Literal[True] = True
    api_key_source: Literal["environment"] = "environment"
    traffic_isolation: Literal[False] = False
    resource_attribution: Literal["none"] = "none"
    sandbox_cleanup: Literal["not_observable"] = "not_observable"
    edge_version: str | None = None
    edge_server: str | None = None
    # Scaling Stages probe the edge independently of load so that a rollout
    # after the last measurement transaction is still observable. Smoke keeps
    # using the legacy single-value fields above and may omit these fields.
    edge_version_before: str | None = Field(default=None, max_length=120)
    edge_version_after: str | None = Field(default=None, max_length=120)
    edge_server_before: str | None = Field(default=None, max_length=120)
    edge_server_after: str | None = Field(default=None, max_length=120)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StagingPublicLoadResult(BaseModel):
    """Sanitized Locust library-mode diagnostics for the single smoke User."""

    requested_users: Literal[1] = 1
    spawned_users: int = Field(default=0, ge=0, le=1)
    observed_max_active: int = Field(default=0, ge=0, le=1)
    elapsed_seconds: float = Field(ge=0)
    timed_out: bool = False
    fatal_errors: list[str] = Field(default_factory=list)
    locust_version: str
    stats: dict[str, object] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StagingPublicWorkerRequest(BaseModel):
    """Secret-free wire request consumed by the isolated Locust process."""

    invocation_id: str = Field(min_length=1, max_length=120)
    service_api_base_url: str
    config_expected_sha256: str
    timeout_seconds: float = Field(gt=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)


class StagingPublicSmokeExecution(BaseModel):
    """Sanitized Locust output returned across the subprocess boundary."""

    samples: list[StagingPublicRunSample]
    cleanup: StagingPublicCleanupResult
    load: StagingPublicLoadResult

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StagingPublicSmokeResult(BaseModel):
    """Top-level public E2E smoke artifact."""

    schema_version: Literal[3] = 3
    harness_version: Literal[3] = 3
    mode: Literal["staging-public-e2e"] = "staging-public-e2e"
    smoke_only: Literal[True] = True
    requested_concurrency: Literal[1] = 1
    confidence: Literal["low_confidence"] = "low_confidence"
    capacity_assessment: Literal["not_applicable"] = "not_applicable"
    status: StagingPublicSmokeStatus
    scenario_sequence: tuple[Literal["basic"], Literal["shell"], Literal["config"]] = (
        "basic",
        "shell",
        "config",
    )
    environment: StagingPublicEnvironment
    samples: list[StagingPublicRunSample]
    cleanup: StagingPublicCleanupResult
    load: StagingPublicLoadResult
    errors: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = [
    "StagingPublicCleanupResult",
    "StagingPublicEdgeProbeEvidence",
    "StagingPublicEnvironment",
    "StagingPublicLoadResult",
    "StagingPublicRunSample",
    "StagingPublicScenarioId",
    "StagingPublicSmokeExecution",
    "StagingPublicSmokeResult",
    "StagingPublicSmokeStatus",
    "StagingPublicTerminalStatus",
    "StagingPublicWorkerRequest",
    "STAGING_PUBLIC_SCENARIO_SEQUENCE",
]
