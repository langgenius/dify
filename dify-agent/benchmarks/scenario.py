"""Versioned deterministic workload definitions for every benchmark profile."""

from __future__ import annotations

import json
from pathlib import Path
from typing import ClassVar, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, model_validator


BenchmarkProfile = Literal["agent", "runtime", "capability", "e2b"]
ScenarioExecutionMode = Literal["fixed", "timed"]


class _ExecutionScenario(BaseModel):
    """Shared fixed-trial or duration-based execution settings."""

    id: str
    version: int = Field(ge=1)
    concurrency: int = Field(ge=1)
    warmup_runs: int | None = Field(default=None, ge=0)
    trial_runs: int | None = Field(default=None, ge=1)
    warmup_seconds: float | None = Field(default=None, ge=0)
    duration_seconds: float | None = Field(default=None, gt=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    @model_validator(mode="after")
    def validate_execution_mode(self) -> "_ExecutionScenario":
        fixed_trials = self.trial_runs is not None
        timed = self.duration_seconds is not None
        if fixed_trials == timed:
            raise ValueError("scenario must define exactly one of trial_runs or duration_seconds")
        if fixed_trials and self.warmup_seconds is not None:
            raise ValueError("fixed-trial scenario cannot define warmup_seconds")
        if timed and self.warmup_runs is not None:
            raise ValueError("timed scenario cannot define warmup_runs")
        return self

    @property
    def execution_mode(self) -> ScenarioExecutionMode:
        return "fixed" if self.trial_runs is not None else "timed"


class AgentBenchmarkScenario(_ExecutionScenario):
    """One deterministic Agent Service workload and its fake dependency cost."""

    model_rounds: int = Field(ge=1)
    text_chunks: int = Field(ge=1)
    model_delay_ms: float = Field(ge=0)
    tool_delay_ms: float = Field(ge=0)
    chunk_interval_ms: float = Field(ge=0)
    tool_response_bytes: int = Field(ge=1)

    @property
    def tool_rounds(self) -> int:
        """Number of model responses that request a plugin tool before final output."""
        return self.model_rounds - 1

    @property
    def expected_model_stream_items(self) -> int:
        """Expected daemon LLM stream items, including tool-call responses."""
        return self.text_chunks + self.tool_rounds

    @property
    def dependency_budget_ms(self) -> float:
        """Configured fake dependency time on one run's critical path."""
        return (
            self.model_rounds * self.model_delay_ms
            + self.tool_rounds * self.tool_delay_ms
            + (self.text_chunks - 1) * self.chunk_interval_ms
        )


RuntimeWorkload = Literal["noop", "output", "many_files", "file"]


class RuntimeBenchmarkScenario(_ExecutionScenario):
    """One direct shellctl HTTP workload."""

    workload: RuntimeWorkload
    output_bytes: int = Field(default=0, ge=0)
    file_count: int = Field(default=0, ge=0)
    file_bytes: int = Field(default=0, ge=0)
    payload_bytes: int = Field(default=0, ge=0)

    @property
    def dependency_budget_ms(self) -> float:
        return 0.0

    @model_validator(mode="after")
    def validate_workload_shape(self) -> "RuntimeBenchmarkScenario":
        if self.workload == "output" and self.output_bytes <= 0:
            raise ValueError("output workload requires output_bytes")
        if self.workload == "many_files" and (self.file_count <= 0 or self.file_bytes <= 0):
            raise ValueError("many_files workload requires file_count and file_bytes")
        if self.workload == "file" and self.payload_bytes <= 0:
            raise ValueError("file workload requires payload_bytes")
        return self


CapabilityWorkload = Literal["shell", "shell_resume", "config_pull", "drive_pull", "file_roundtrip"]


class CapabilityBenchmarkScenario(_ExecutionScenario):
    """One Agent-to-Runtime capability workload."""

    workload: CapabilityWorkload
    model_rounds: int = Field(ge=1)
    text_chunks: int = Field(ge=1)
    model_delay_ms: float = Field(ge=0)
    chunk_interval_ms: float = Field(ge=0)
    config_skill_count: int = Field(default=0, ge=0)
    config_file_count: int = Field(default=0, ge=0)
    drive_file_count: int = Field(default=0, ge=0)
    item_bytes: int = Field(default=4096, ge=1)
    payload_bytes: int = Field(default=0, ge=0)

    @property
    def tool_rounds(self) -> int:
        return self.model_rounds - 1

    @property
    def expected_model_stream_items(self) -> int:
        return self.text_chunks + self.tool_rounds

    @property
    def dependency_budget_ms(self) -> float:
        return self.model_rounds * self.model_delay_ms + (self.text_chunks - 1) * self.chunk_interval_ms

    @model_validator(mode="after")
    def validate_workload_shape(self) -> "CapabilityBenchmarkScenario":
        tool_workload = self.workload in {"shell", "shell_resume", "file_roundtrip"}
        if tool_workload != (self.tool_rounds == 1):
            raise ValueError("shell and file capability workloads require exactly one model tool round")
        if self.workload == "config_pull" and (self.config_skill_count <= 0 or self.config_file_count <= 0):
            raise ValueError("config_pull requires config_skill_count and config_file_count")
        if self.workload == "drive_pull" and self.drive_file_count <= 0:
            raise ValueError("drive_pull requires drive_file_count")
        if self.workload == "file_roundtrip" and self.payload_bytes <= 0:
            raise ValueError("file_roundtrip requires payload_bytes")
        return self


ScenarioT = TypeVar(
    "ScenarioT",
    AgentBenchmarkScenario,
    RuntimeBenchmarkScenario,
    CapabilityBenchmarkScenario,
)


class ScenarioManifest(BaseModel):
    """Top-level versioned workload manifest for one profile."""

    schema_version: int = Field(ge=1)
    profile: BenchmarkProfile
    scenarios: list[AgentBenchmarkScenario | RuntimeBenchmarkScenario | CapabilityBenchmarkScenario]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    @model_validator(mode="after")
    def validate_manifest(self) -> "ScenarioManifest":
        ids = [scenario.id for scenario in self.scenarios]
        if len(ids) != len(set(ids)):
            raise ValueError("scenario ids must be unique")
        expected_type: type[_ExecutionScenario] = {
            "agent": AgentBenchmarkScenario,
            "runtime": RuntimeBenchmarkScenario,
            "capability": CapabilityBenchmarkScenario,
            "e2b": CapabilityBenchmarkScenario,
        }[self.profile]
        if any(not isinstance(scenario, expected_type) for scenario in self.scenarios):
            raise ValueError(f"{self.profile} manifest contains a scenario for another profile")
        return self

    def get(self, scenario_id: str) -> AgentBenchmarkScenario | RuntimeBenchmarkScenario | CapabilityBenchmarkScenario:
        """Resolve a scenario by stable identifier."""
        for scenario in self.scenarios:
            if scenario.id == scenario_id:
                return scenario
        raise KeyError(f"unknown {self.profile} benchmark scenario: {scenario_id}")


def load_scenario_manifest(
    path: Path | None = None,
    *,
    profile: BenchmarkProfile = "agent",
) -> ScenarioManifest:
    """Load one checked-in profile manifest."""
    manifest_name = {
        "agent": "scenarios.json",
        "runtime": "runtime_scenarios.json",
        "capability": "capability_scenarios.json",
        "e2b": "capability_scenarios.json",
    }[profile]
    resolved_path = path or Path(__file__).with_name(manifest_name)
    payload = json.loads(resolved_path.read_text())
    if path is None and profile == "e2b" and isinstance(payload, dict):
        payload["profile"] = "e2b"
    return ScenarioManifest.model_validate(payload)


# Compatibility name retained for existing Agent benchmark imports.
BenchmarkScenario = AgentBenchmarkScenario


__all__ = [
    "AgentBenchmarkScenario",
    "BenchmarkProfile",
    "BenchmarkScenario",
    "CapabilityBenchmarkScenario",
    "RuntimeBenchmarkScenario",
    "ScenarioManifest",
    "load_scenario_manifest",
]
