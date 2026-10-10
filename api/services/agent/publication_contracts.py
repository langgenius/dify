"""Detached inputs to Agent publication validation, independent of persistence models."""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AgentPublicationBinding:
    tenant_id: str
    node_id: str
    binding_type: str
    agent_id: str | None
    bound_snapshot_id: str | None
    snapshot_id: str | None
    node_job_config: dict[str, Any]
    soul_config: dict[str, Any] | None


type AgentPublicationState = tuple[AgentPublicationBinding, ...]
