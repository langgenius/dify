"""Secret-free references shared by execution, queueing and pause/resume boundaries."""

from pydantic import BaseModel, ConfigDict, Field


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


class RuntimeConnectionReference(BaseModel):
    """Non-secret provenance of the credentials actually loaded for a tool call."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    connection_id: str
    provider: str
    credential_type: str
    revision: int
    oauth_client_source: str | None
    oauth_client_configuration_id: str | None
    oauth_client_id: str | None = Field(repr=False)
