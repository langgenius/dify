"""Shared KnowledgeFS contracts consumed by workflow nodes and application services."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class KnowledgeResourceRef(BaseModel):
    """A typed app configuration reference to one Dify-owned KnowledgeFS control-space."""

    kind: Literal["knowledge_fs"]
    control_space_id: str = Field(min_length=1, max_length=1_000)

    model_config = ConfigDict(extra="forbid", frozen=True)

    @field_validator("control_space_id")
    @classmethod
    def normalize_control_space_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("KnowledgeFS control-space reference is required")
        return normalized
