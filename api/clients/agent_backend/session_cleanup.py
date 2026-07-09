"""Shared API-side helper for Agent backend lifecycle-only session cleanup.

Product code owns local row retirement and background-task dispatch. This module
only adapts persisted cleanup inputs into the public ``dify-agent`` run
protocol, performs the synchronous ``create_run + wait_run`` loop used by Celery
workers, and reports whether the backend cleanup succeeded, was skipped, or
failed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import ClassVar, Literal

from agenton.compositor import CompositorSessionSnapshot
from dify_agent.protocol import RuntimeLayerSpec
from pydantic import BaseModel, ConfigDict, Field, JsonValue

from clients.agent_backend.client import AgentBackendRunClient
from clients.agent_backend.errors import AgentBackendError
from clients.agent_backend.request_builder import AgentBackendRunRequestBuilder


class AgentBackendSessionCleanupPayload(BaseModel):
    """Serialized cleanup inputs preserved across API and Celery boundaries."""

    session_snapshot: CompositorSessionSnapshot | None = None
    runtime_layer_specs: list[RuntimeLayerSpec] = Field(default_factory=list)
    idempotency_key: str | None = None
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    timeout_seconds: float = 30.0

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


@dataclass(frozen=True, slots=True)
class AgentBackendSessionCleanupResult:
    """Terminal outcome of one backend cleanup attempt."""

    status: Literal["succeeded", "skipped", "failed"]
    reason: str | None = None
    cleanup_run_id: str | None = None

    @classmethod
    def succeeded(cls, cleanup_run_id: str) -> AgentBackendSessionCleanupResult:
        return cls(status="succeeded", cleanup_run_id=cleanup_run_id)

    @classmethod
    def skipped(cls, reason: str) -> AgentBackendSessionCleanupResult:
        return cls(status="skipped", reason=reason)

    @classmethod
    def failed(cls, reason: str, cleanup_run_id: str | None = None) -> AgentBackendSessionCleanupResult:
        return cls(status="failed", reason=reason, cleanup_run_id=cleanup_run_id)


def cleanup_agent_backend_session(
    *,
    payload: AgentBackendSessionCleanupPayload,
    client: AgentBackendRunClient | None,
    request_builder: AgentBackendRunRequestBuilder | None = None,
) -> AgentBackendSessionCleanupResult:
    """Run lifecycle-only cleanup against the Agent backend and report status."""
    if client is None:
        return AgentBackendSessionCleanupResult.skipped("no_agent_backend_client")
    if payload.session_snapshot is None:
        return AgentBackendSessionCleanupResult.skipped("missing_session_snapshot")
    if not payload.runtime_layer_specs:
        return AgentBackendSessionCleanupResult.skipped("missing_runtime_layer_specs")

    builder = request_builder or AgentBackendRunRequestBuilder()
    request = builder.build_cleanup_request(
        session_snapshot=payload.session_snapshot,
        runtime_layer_specs=payload.runtime_layer_specs,
        idempotency_key=payload.idempotency_key,
        metadata=payload.metadata,
    )

    try:
        response = client.create_run(request)
    except AgentBackendError as exc:
        return AgentBackendSessionCleanupResult.failed(str(exc))

    try:
        status_response = client.wait_run(response.run_id, timeout_seconds=payload.timeout_seconds)
    except AgentBackendError as exc:
        return AgentBackendSessionCleanupResult.failed(str(exc), cleanup_run_id=response.run_id)

    if status_response.status != "succeeded":
        reason = status_response.error or f"cleanup run ended with status {status_response.status}"
        return AgentBackendSessionCleanupResult.failed(reason, cleanup_run_id=response.run_id)

    return AgentBackendSessionCleanupResult.succeeded(response.run_id)


__all__ = [
    "AgentBackendSessionCleanupPayload",
    "AgentBackendSessionCleanupResult",
    "cleanup_agent_backend_session",
]
