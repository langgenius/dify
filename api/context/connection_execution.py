"""Secret-free references shared by execution, queueing and pause/resume boundaries."""

from pydantic import BaseModel, ConfigDict, model_validator


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
    selections: tuple[ExecutionConnectionSelection, ...]

    @model_validator(mode="before")
    @classmethod
    def discard_legacy_conversation_id(cls, value: object) -> object:
        # Queued and paused executions may still contain the former duplicate.
        if isinstance(value, dict) and "conversation_id" in value:
            return {key: item for key, item in value.items() if key != "conversation_id"}
        return value
