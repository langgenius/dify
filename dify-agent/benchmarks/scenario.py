"""Deterministic workloads shared by both local capacity modes."""

from __future__ import annotations

import json
from pathlib import Path
from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


BenchmarkMode = Literal["local-runtime", "local-e2b"]
CapacityWorkload = Literal["basic", "shell", "resume", "config", "file"]


class CapacityScenario(BaseModel):
    """One deterministic Agent workload independent of the Runtime backend."""

    id: str
    version: int = Field(ge=1)
    workload: CapacityWorkload
    model_rounds: int = Field(ge=1)
    text_chunks: int = Field(ge=1)
    model_delay_ms: float = Field(ge=0)
    chunk_interval_ms: float = Field(ge=0)
    config_skill_count: int = Field(default=0, ge=0)
    config_file_count: int = Field(default=0, ge=0)
    item_bytes: int = Field(default=4096, ge=1)
    payload_bytes: int = Field(default=0, ge=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    @property
    def tool_rounds(self) -> int:
        return 1 if self.workload in {"shell", "resume", "file"} else 0

    @property
    def expected_model_stream_items(self) -> int:
        return self.text_chunks + self.tool_rounds

    @model_validator(mode="after")
    def validate_workload(self) -> "CapacityScenario":
        expected_model_rounds = self.tool_rounds + 1
        if self.model_rounds != expected_model_rounds:
            raise ValueError(f"{self.workload} requires {expected_model_rounds} model rounds")
        if self.workload == "config" and (self.config_skill_count <= 0 or self.config_file_count <= 0):
            raise ValueError("config requires skill and file counts")
        if self.workload == "file" and self.payload_bytes <= 0:
            raise ValueError("file requires payload_bytes")
        return self


class ScenarioManifest(BaseModel):
    """Checked-in workload manifest used by every capacity point."""

    schema_version: int = Field(ge=1)
    scenarios: list[CapacityScenario]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "ScenarioManifest":
        ids = [scenario.id for scenario in self.scenarios]
        if len(ids) != len(set(ids)):
            raise ValueError("scenario ids must be unique")
        return self

    def get(self, scenario_id: str) -> CapacityScenario:
        for scenario in self.scenarios:
            if scenario.id == scenario_id:
                return scenario
        raise KeyError(f"unknown capacity scenario: {scenario_id}")


def load_scenario_manifest(path: Path | None = None) -> ScenarioManifest:
    resolved_path = path or Path(__file__).with_name("capacity_scenarios.json")
    return ScenarioManifest.model_validate(json.loads(resolved_path.read_text()))


__all__ = [
    "BenchmarkMode",
    "CapacityScenario",
    "CapacityWorkload",
    "ScenarioManifest",
    "load_scenario_manifest",
]
