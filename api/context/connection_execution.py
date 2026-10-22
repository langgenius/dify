"""Secret-free references shared by execution, queueing and pause/resume boundaries."""

from pydantic import BaseModel, ConfigDict


class ExecutionConnectionSelection(BaseModel):
    """One authorization root's choice; reuse is resolved from the Run's workflow."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    node_id: str
    provider: str
    connection_id: str | None


class ConnectionExecutionContext(BaseModel):
    """Internal references, never request authority or a credential-readiness certificate."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    tenant_id: str
    app_id: str
    end_user_id: str
    account_id: str | None
    workflow_id: str
    # None until a Chatflow Conversation exists, or for a plain Workflow.
    conversation_id: str | None
    selections: tuple[ExecutionConnectionSelection, ...]
