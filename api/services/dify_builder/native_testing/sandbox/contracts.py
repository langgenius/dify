"""Immutable reference-only Code state. DTO validation never grants authority."""

from datetime import datetime
from typing import Annotated, Protocol, runtime_checkable
from uuid import UUID

from pydantic import AfterValidator, Field, StrictBool, model_validator
from shellctl.shared.schemas import NativeScopeSpec

from runtime_contracts.builder.execution import Digest
from runtime_contracts.builder.native.contracts import (
    Counter,
    FrozenDTO,
    NativeTestContextRef,
)


def canonical_uuid(value: str) -> str:
    if str(UUID(value)) != value:
        raise ValueError("canonical UUID required")
    return value


UUIDString = Annotated[str, Field(strict=True), AfterValidator(canonical_uuid)]
ScopeID = Annotated[str, Field(strict=True, pattern=r"^code_[0-9a-f]{32}$")]
JobID = Annotated[str, Field(strict=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")]
SnapshotID = Annotated[str, Field(strict=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$")]


class CodeAcquisitionRef(FrozenDTO):
    """Root acquisition reference; check_current must verify retained host identity."""

    ref: NativeTestContextRef
    root_dispatch_id: UUIDString
    generation: Counter
    acquisition_id: UUIDString


@runtime_checkable
class CodeAcquisitionOwner(Protocol):
    def check_current(self, acquisition: CodeAcquisitionRef) -> None:
        """Local retained-object/registry check, before and after every transaction."""
        ...


class CodeScopeSpec(FrozenDTO):
    """Reference-only admitted spec; snapshot qualification belongs to the future host."""

    native: NativeScopeSpec
    environment_digest: Digest
    base_snapshot_digest: Digest

    @model_validator(mode="after")
    def strict_fresh_scope(self):
        native = NativeScopeSpec.model_validate(self.native.model_dump(mode="python"), strict=True)
        if (
            not native.scope_id.startswith("code_")
            or len(native.scope_id) != 37
            or any(c not in "0123456789abcdef" for c in native.scope_id[5:])
            or native.generation != 1
            or native.input_file_refs
            or native.network_targets
            or native.deadline.tzinfo is None
        ):
            raise ValueError("fresh no-network Code scope required")
        return self


class CodePhysicalRef(FrozenDTO):
    id: UUIDString
    ref: NativeTestContextRef
    acquisition: CodeAcquisitionRef
    tenant_id: UUIDString
    actor_id: UUIDString
    operation_id: UUIDString
    attempt_id: UUIDString
    effect_claim_id: UUIDString
    invocation_generation: Counter
    native_execution_id: UUIDString
    operation_digest: Digest
    intent_digest: Digest
    scope_id: ScopeID
    scope_generation: Annotated[int, Field(strict=True, ge=1, le=1)]
    scope_spec_digest: Digest
    environment_digest: Digest
    payload_digest: Digest
    profile_digest: Digest
    base_snapshot_ref: SnapshotID
    base_snapshot_digest: Digest
    scope_expires_at: datetime
    scope_create_acked: StrictBool
    job_reserved: StrictBool
    job_id: JobID | None
    input_may_have_been_sent: StrictBool
    observed_output_offset: Counter
    ambiguous: StrictBool
    destroyed_at: datetime | None
