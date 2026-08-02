"""Wire types shared with the isolated Locust load process."""

from __future__ import annotations

from pathlib import Path
from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from benchmarks.scenario import BenchmarkMode


PhaseKind = Literal["warmup", "measurement", "resume-setup"]


class WorkerContext(BaseModel):
    worker_index: int = Field(ge=0)
    binding_ref: str | None = None
    session_snapshot: dict[str, object] | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class LoadPhaseRequest(BaseModel):
    mode: BenchmarkMode
    phase: PhaseKind
    agent_url: str
    fake_deps_url: str
    scenario_id: str
    block_id: str
    contexts_path: Path
    observations_path: Path
    active_runs_path: Path
    stats_path: Path
    result_path: Path
    duration_seconds: float | None = Field(default=None, gt=0)
    iterations_per_user: int | None = Field(default=None, ge=1)
    sequence_stride: int = Field(ge=1)
    suspend: bool = False
    spawn_rate: float = Field(default=200, gt=0)
    drain_timeout_seconds: float = Field(default=180, gt=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_phase_limit(self) -> "LoadPhaseRequest":
        if (self.duration_seconds is None) == (self.iterations_per_user is None):
            raise ValueError("exactly one phase limit must be configured")
        return self


class CompositeRequestStats(BaseModel):
    request_count: int = Field(ge=0)
    failure_count: int = Field(ge=0)
    total_response_time_ms: float = Field(ge=0)
    min_response_time_ms: float | None = Field(default=None, ge=0)
    max_response_time_ms: float = Field(ge=0)
    average_response_time_ms: float = Field(ge=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class LoadPhaseResult(BaseModel):
    phase: PhaseKind
    started_at_ns: int
    ended_at_ns: int
    elapsed_seconds: float = Field(gt=0)
    drain_seconds: float = Field(ge=0)
    requested_users: int = Field(ge=1)
    spawned_users: int = Field(ge=0)
    observed_max_active: int = Field(ge=0)
    observation_count: int = Field(ge=0)
    timed_out: bool = False
    fatal_errors: list[str] = Field(default_factory=list)
    locust_version: str
    composite_request: CompositeRequestStats | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = ["CompositeRequestStats", "LoadPhaseRequest", "LoadPhaseResult", "PhaseKind", "WorkerContext"]
