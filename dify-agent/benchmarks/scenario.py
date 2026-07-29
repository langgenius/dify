"""Versioned deterministic workload definitions shared by all benchmark services."""

from pathlib import Path
from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field, model_validator


class BenchmarkScenario(BaseModel):
    """One deterministic service workload and its expected fake dependency cost."""

    id: str
    version: int = Field(ge=1)
    model_rounds: int = Field(ge=1)
    text_chunks: int = Field(ge=1)
    concurrency: int = Field(ge=1)
    model_delay_ms: float = Field(ge=0)
    tool_delay_ms: float = Field(ge=0)
    chunk_interval_ms: float = Field(ge=0)
    tool_response_bytes: int = Field(ge=1)
    warmup_runs: int | None = Field(default=None, ge=0)
    trial_runs: int | None = Field(default=None, ge=1)
    warmup_seconds: float | None = Field(default=None, ge=0)
    duration_seconds: float | None = Field(default=None, gt=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    @model_validator(mode="after")
    def validate_execution_mode(self) -> "BenchmarkScenario":
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
    def tool_rounds(self) -> int:
        """Number of model responses that request a tool before final output."""
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


class ScenarioManifest(BaseModel):
    """Top-level versioned workload manifest."""

    schema_version: int = Field(ge=1)
    scenarios: list[BenchmarkScenario]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "ScenarioManifest":
        ids = [scenario.id for scenario in self.scenarios]
        if len(ids) != len(set(ids)):
            raise ValueError("scenario ids must be unique")
        return self

    def get(self, scenario_id: str) -> BenchmarkScenario:
        """Resolve a scenario by stable identifier."""
        for scenario in self.scenarios:
            if scenario.id == scenario_id:
                return scenario
        raise KeyError(f"unknown benchmark scenario: {scenario_id}")


def load_scenario_manifest(path: Path | None = None) -> ScenarioManifest:
    """Load the checked-in manifest used by the driver and fake dependency."""
    resolved_path = path or Path(__file__).with_name("scenarios.json")
    return ScenarioManifest.model_validate_json(resolved_path.read_text())


__all__ = ["BenchmarkScenario", "ScenarioManifest", "load_scenario_manifest"]
