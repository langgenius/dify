"""Records of Agent trace collection and its settings.

Agent apps and workflows with Agent nodes produce spans that the Dify Agent
runtime reports separately. A run freezes the app's destination and capture
policy when its execution starts, collects runtime batches in a ledger, and
is exported once its business terminal and every invocation are complete.
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

from domain.tracing.sources import SourceNodeExecution, SourceWorkflowRun
from domain.tracing.trace_run_agg import TraceRunState, TraceSourceKind
from domain.workflow.agent_node import is_dify_agent_node_data
from services.tracing.providers import TraceProviderSupport


def workflow_has_agent_v2(graph: object) -> bool:
    """Scope Agent trace collection to graphs containing the Dify Agent v2 node."""
    if isinstance(graph, str):
        try:
            graph = json.loads(graph)
        except ValueError:
            return False
    if not isinstance(graph, Mapping) or not isinstance(graph.get("nodes"), list):
        return False
    return any(
        isinstance(node, Mapping) and isinstance(node.get("data"), Mapping) and is_dify_agent_node_data(node["data"])
        for node in graph["nodes"]
    )


class TraceAppMode(StrEnum):
    """The app modes collection distinguishes; every other mode is ``OTHER``."""

    AGENT = "agent"
    ADVANCED_CHAT = "advanced-chat"
    WORKFLOW = "workflow"
    OTHER = "other"


@dataclass(frozen=True, slots=True)
class TraceRun:
    id: str
    tenant_id: str
    app_id: str
    source_kind: TraceSourceKind
    source_id: str
    provider: str
    """``""`` when the run froze no destination."""
    config_revision: str
    """``""`` when the run froze no destination."""
    provider_config: Mapping[str, Any]
    """The frozen stored configuration, secrets still encrypted."""
    trace_id: str
    root_span_id: str
    session_id: str
    capture_content: bool
    capture_agent: bool
    state: TraceRunState
    outer_trace: Mapping[str, Any] | None
    """The captured business terminal; ``None`` until it is captured."""
    span_count: int
    attempts: int
    error_code: str | None
    """``None`` unless the run failed or its export outcome is uncertain."""
    trace_url: str | None
    """``None`` until the destination accepts the trace with a link."""
    provider_trace_id: str | None
    """``None`` until the destination accepts the trace."""
    span_urls: Mapping[str, str]
    accepted_at: datetime | None
    """``None`` until the destination accepts the trace."""


@dataclass(frozen=True, slots=True)
class TraceApp:
    id: str
    tenant_id: str
    mode: TraceAppMode
    workflow_id: str | None
    """``None`` for apps without a published workflow."""


@dataclass(frozen=True, slots=True)
class SourceMessage:
    id: str
    conversation_id: str
    workflow_run_id: str | None
    """``None`` until a chatflow run is linked to the message."""
    agent_stop_requested: bool
    """Whether the consumer asked to stop the Agent; it does not say whether the stop won."""


type TraceSource = SourceMessage | SourceWorkflowRun | SourceNodeExecution


@dataclass(frozen=True, slots=True)
class AppTracingSnapshot:
    """What a run freezes from its app: the stored tracing policy and the provider configuration it names."""

    policy: Mapping[str, Any]
    """The stored policy as written; empty when it is missing or unreadable."""
    config: Mapping[str, Any] | None
    """The stored configuration of the provider the policy names, secrets still encrypted.

    ``None`` when the policy names no provider or that provider has no stored configuration.
    """


@dataclass(frozen=True, slots=True)
class TraceRunStatus:
    """The delivery state of a source's frozen run.

    Every field after ``source_id`` is ``None`` when nothing was collected.
    """

    status: TraceRunState
    source_kind: TraceSourceKind
    source_id: str
    provider: str | None
    trace_id: str | None
    """The destination's trace ID once accepted, otherwise the run's own."""
    trace_url: str | None
    span_url: str | None
    """The link of the selected node's Agent span; ``None`` when no node is selected."""
    project_url: str | None
    """The frozen destination's project link; never resolved from the app's current configuration."""
    config_revision: str | None
    capture_content: bool | None
    capture_agent: bool | None
    span_count: int | None
    attempts: int | None
    error_code: str | None
    accepted_at: datetime | None
    capabilities: TraceProviderSupport | None
    """``None`` when the frozen provider is not installed here."""


@dataclass(frozen=True, slots=True)
class AgentTraceSettings:
    enabled: bool
    max_spans: int
    max_bytes: int
    collection_timeout_seconds: int
    export_lease_seconds: int
    max_export_attempts: int
    retention_days: int
