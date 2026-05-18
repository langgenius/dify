from __future__ import annotations

from enum import StrEnum

from pydantic import Field

from clients.agent_backend.dto import AgentBackendBaseModel, AgentExecutionContext, CompositorConfig


class AgentLifecycleEvent(StrEnum):
    CREATE = "create"
    TMP_LEAVE = "tmp_leave"
    REENTER = "reenter"
    DELETE = "delete"


class AgentLifecycleReason(StrEnum):
    WORKFLOW_RUN_START = "workflow_run_start"
    WORKFLOW_RUN_FINISH = "workflow_run_finish"
    SINGLE_STEP_START = "single_step_start"
    BABYSIT_START = "babysit_start"
    HUMAN_HANDOFF = "human_handoff"
    WORKFLOW_HANDOFF = "workflow_handoff"
    RESUME = "resume"
    FASTEN_PREVIEW = "fasten_preview"
    CANCEL = "cancel"


class AgentBackendLifecycleSignal(AgentBackendBaseModel):
    event: AgentLifecycleEvent
    reason: AgentLifecycleReason
    execution_context: AgentExecutionContext
    target_layer_ids: list[str] | None = None
    idempotency_key: str


class AgentBackendInvokeRequest(AgentBackendBaseModel):
    compositor_config: CompositorConfig
    lifecycle_signals: list[AgentBackendLifecycleSignal] = Field(default_factory=list)
    idempotency_key: str
    stream: bool = True


class AgentBackendLifecycleRequest(AgentBackendBaseModel):
    signal: AgentBackendLifecycleSignal


class AgentBackendLifecycleAck(AgentBackendBaseModel):
    accepted: bool
    event: AgentLifecycleEvent
    reason: AgentLifecycleReason
    idempotency_key: str
    message: str | None = None
