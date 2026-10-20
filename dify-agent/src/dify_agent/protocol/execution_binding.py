"""Private DTOs for persistent Execution Binding lifecycle operations."""

from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field, model_serializer, model_validator

from shellctl.shared.schemas import NativeScopeSpec


class CreateExecutionBindingRequest(BaseModel):
    tenant_id: str = Field(min_length=1)
    agent_id: str = Field(min_length=1)
    binding_id: str = Field(min_length=1)
    workspace_id: str = Field(min_length=1)
    existing_workspace_ref: str | None = None
    home_snapshot_ref: str | None = Field(default=None, min_length=1)
    native_test_scope: NativeScopeSpec | None = None
    native_scope_reconcile: bool = False

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_serializer(mode="wrap")
    def serialize_binding(self, handler):
        value = handler(self)
        if self.native_test_scope is None:
            value.pop("native_test_scope", None)
            value.pop("native_scope_reconcile", None)
        return value

    @model_validator(mode="after")
    def validate_native_reconciliation(self):
        if self.native_scope_reconcile and self.native_test_scope is None:
            raise ValueError("native reconciliation requires its immutable scope")
        return self


class CreateExecutionBindingResponse(BaseModel):
    binding_ref: str = Field(min_length=1)
    workspace_ref: str = Field(min_length=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DestroyExecutionBindingRequest(BaseModel):
    binding_ref: str = Field(min_length=1)
    destroy_workspace: bool
    workspace_ref: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_workspace_ref(self) -> "DestroyExecutionBindingRequest":
        if self.destroy_workspace and not self.workspace_ref:
            raise ValueError("workspace_ref is required when destroy_workspace is true")
        return self


__all__ = [
    "CreateExecutionBindingRequest",
    "CreateExecutionBindingResponse",
    "DestroyExecutionBindingRequest",
]
