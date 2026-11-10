"""Private DTOs for persistent Execution Binding lifecycle operations."""

from typing import ClassVar, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, SerializerFunctionWrapHandler, model_serializer, model_validator

from shellctl.shared.schemas import NativeScopeSpec

from dify_agent.protocol.native_testing import ID, AgentShellJobStatus, NativeDTO


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
    def serialize_binding(self, handler: SerializerFunctionWrapHandler):
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


class KeepAliveExecutionBindingRequest(BaseModel):
    binding_ref: str = Field(min_length=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class KeepAliveExecutionBindingResponse(BaseModel):
    supported: bool

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = [
    "CreateExecutionBindingRequest",
    "CreateExecutionBindingResponse",
    "DestroyExecutionBindingRequest",
    "KeepAliveExecutionBindingRequest",
    "KeepAliveExecutionBindingResponse",
    "ReadExecutionBindingJobRequest",
    "ReadExecutionBindingJobResponse",
]


class ReadExecutionBindingJobRequest(NativeDTO):
    binding_ref: ID
    job_id: ID


class ReadExecutionBindingJobResponse(AgentShellJobStatus):
    pass


class InspectExecutionBindingRequest(NativeDTO):
    """Select exact ordinary physical refs; caller assertions are never evidence."""

    binding_ref: ID
    workspace_ref: ID


class InspectExecutionBindingResponse(InspectExecutionBindingRequest):
    """Bounded adapter evidence; absence alone never authorizes recovery."""

    adapter: Literal["local", "enterprise", "unsupported"]
    state: Literal["usable", "definitively_gone", "uncertain", "unsupported"]
    evidence_code: Literal[
        "paths_present",
        "path_absent",
        "sandbox_not_found",
        "root_unavailable",
        "path_ambiguous",
        "identity_mismatch",
        "probe_unavailable",
        "invalid_probe",
        "health_ok",
        "health_unavailable",
        "backend_unsupported",
    ]

    @model_validator(mode="after")
    def coherent_evidence(self) -> Self:
        """Require evidence matching its state and source; reject invented absence."""
        valid = (
            (self.adapter == "local" and self.state == "usable" and self.evidence_code == "paths_present")
            or (self.adapter == "local" and self.state == "definitively_gone" and self.evidence_code == "path_absent")
            or (self.adapter == "enterprise" and self.state == "usable" and self.evidence_code == "health_ok")
            or (
                self.adapter == "enterprise"
                and self.state == "definitively_gone"
                and self.evidence_code == "sandbox_not_found"
            )
            or (
                self.adapter == "unsupported"
                and self.state == "unsupported"
                and self.evidence_code == "backend_unsupported"
            )
            or (
                self.state == "uncertain"
                and self.adapter in {"local", "enterprise"}
                and self.evidence_code
                in {
                    "root_unavailable",
                    "path_ambiguous",
                    "identity_mismatch",
                    "probe_unavailable",
                    "invalid_probe",
                    "health_unavailable",
                }
            )
        )
        if self.adapter == "enterprise" and self.state in {"usable", "definitively_gone"}:
            valid = valid and self.binding_ref == self.workspace_ref
        if not valid:
            raise ValueError("incoherent binding inspection evidence")
        return self


__all__ += ["InspectExecutionBindingRequest", "InspectExecutionBindingResponse"]
