"""Secret-free references shared by execution, queueing and pause/resume boundaries."""

from pydantic import BaseModel, ConfigDict, Field, model_validator


class WorkspaceConnectionScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    installed_app_id: str
    tenant_id: str
    account_id: str


class ExecutionConnectionSelection(BaseModel):
    """One authorization root's choice; reuse is resolved from the Run's workflow."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    node_id: str
    provider: str
    connection_id: str | None


class ConnectionExecutionContext(BaseModel):
    """Internal references, never request authority or a credential-readiness certificate.

    Workspace execution identifies a Tenant Member rather than an EndUser row;
    end_user_id is empty only in that explicitly tagged namespace.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    tenant_id: str
    app_id: str
    end_user_id: str
    account_id: str | None
    workflow_id: str
    connection_revision: str
    selections: tuple[ExecutionConnectionSelection, ...]
    workspace: WorkspaceConnectionScope | None = Field(default=None, exclude_if=lambda value: value is None)

    @model_validator(mode="after")
    def validate_workspace_identity(self) -> "ConnectionExecutionContext":
        if self.workspace is not None and (
            self.end_user_id
            or self.account_id != self.workspace.account_id
            or self.tenant_id != self.workspace.tenant_id
        ):
            raise ValueError("Workspace Connection identity does not match its execution scope.")
        return self
