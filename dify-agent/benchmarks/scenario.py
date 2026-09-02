"""Deterministic workloads shared by both local capacity modes."""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
import re
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
        return 1 if self.uses_runtime else 0

    @property
    def uses_runtime(self) -> bool:
        return self.workload != "basic"

    @property
    def is_file_workload(self) -> bool:
        return self.workload == "file"

    @property
    def prepares_warm_binding(self) -> bool:
        return self.workload == "resume"

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
        if self.is_file_workload and self.payload_bytes <= 0:
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


@lru_cache(maxsize=16)
def deterministic_file_payload_sha256(payload_bytes: int) -> str:
    """Return the SHA256 for the fixed byte-pattern File workload."""
    if payload_bytes < 1:
        raise ValueError("payload_bytes must be positive")
    pattern_block = bytes(range(256)) * 4096
    full_blocks, remainder = divmod(payload_bytes, len(pattern_block))
    digest = hashlib.sha256()
    for _ in range(full_blocks):
        digest.update(pattern_block)
    digest.update(pattern_block[:remainder])
    return digest.hexdigest()


def config_skill_name(benchmark_run_id: str, index: int) -> str:
    """Return a run-unique Config skill name safe for a URL and Workspace path."""
    candidate = f"skill-{index}-{benchmark_run_id}"
    if re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", candidate) is not None:
        return candidate
    digest = hashlib.sha256(f"{index}:{benchmark_run_id}".encode()).hexdigest()[:32]
    return f"skill-{index}-{digest}"


def config_file_name(benchmark_run_id: str, index: int) -> str:
    """Return a run-unique Config file name safe for a URL and Workspace path."""
    return f"file-{index}-{benchmark_run_id}.bin"


__all__ = [
    "BenchmarkMode",
    "CapacityScenario",
    "CapacityWorkload",
    "ScenarioManifest",
    "config_file_name",
    "config_skill_name",
    "deterministic_file_payload_sha256",
    "load_scenario_manifest",
]
