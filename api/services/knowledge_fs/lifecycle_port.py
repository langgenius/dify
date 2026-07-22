"""Remote port for the KnowledgeFS lifecycle data-plane."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal, NamedTuple, Protocol

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from models.knowledge_fs import KnowledgeFSModelSelectionIntentPayload, KnowledgeFSRetrievalProfileIntentPayload


class KnowledgeFSRemoteSpace(NamedTuple):
    namespace_id: str
    knowledge_space_id: str
    provisioning_key: str
    revision: int


class KnowledgeFSIntegratedProvisionRequest(NamedTuple):
    namespace_id: str
    control_space_id: str
    operation_id: str
    idempotency_key: str
    provisioning_key: str
    name: str
    slug: str
    icon: str | None
    description: str | None
    model_intent: KnowledgeFSModelSelectionIntentPayload
    profile_intent: KnowledgeFSRetrievalProfileIntentPayload


class KnowledgeFSIntegratedDeletionRequest(NamedTuple):
    namespace_id: str
    control_space_id: str
    operation_id: str
    idempotency_key: str
    knowledge_space_id: str | None
    provisioning_key: str
    expected_revision: int


class KnowledgeFSCapabilityGrantRevokeRequest(NamedTuple):
    namespace_id: str
    control_space_id: str
    operation_id: str
    idempotency_key: str
    knowledge_space_id: str
    grant_id: str
    event_id: str
    reason_code: str
    revoke_sequence: int
    expected_revision: int


class KnowledgeFSCapabilityGrantRevokeAck(NamedTuple):
    applied: bool
    highest_revoke_sequence: int
    state: Literal["active", "revoked"]


class _StrictLifecycleModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class KnowledgeFSDifyIntegrationFreezeRequest(_StrictLifecycleModel):
    """Tenant-scoped monotonic freeze command sent before final-delta capture."""

    namespace_id: str = Field(min_length=1, max_length=255)
    control_space_id: str = Field(min_length=1, max_length=255)
    freeze_id: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    freeze_revision: int = Field(ge=1, le=9_007_199_254_740_991)
    source_revision_digest: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    source_task_watermark: int = Field(ge=0, le=9_007_199_254_740_991)

    @field_validator("namespace_id", "control_space_id", "freeze_id")
    @classmethod
    def validate_normalized_identifier(cls, value: str) -> str:
        if value.strip() != value:
            raise ValueError("freeze identifiers must be normalized")
        return value


class KnowledgeFSDifyIntegrationFreezeAck(_StrictLifecycleModel):
    """Exact durable KnowledgeFS acknowledgement required before local freeze publication."""

    namespace_id: str = Field(min_length=1, max_length=255)
    freeze_id: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    freeze_revision: int = Field(ge=1, le=9_007_199_254_740_991)
    source_revision_digest: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    source_task_watermark: int = Field(ge=0, le=9_007_199_254_740_991)
    frozen_at: datetime
    updated_at: datetime
    frozen: Literal[True]
    applied: bool
    replayed: bool

    @field_validator("namespace_id", "freeze_id")
    @classmethod
    def validate_normalized_identifier(cls, value: str) -> str:
        if value.strip() != value:
            raise ValueError("freeze identifiers must be normalized")
        return value

    @field_validator("frozen_at", "updated_at")
    @classmethod
    def validate_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("freeze timestamps must include a timezone")
        return value

    @model_validator(mode="after")
    def validate_outcome(self) -> KnowledgeFSDifyIntegrationFreezeAck:
        if self.applied is self.replayed:
            raise ValueError("freeze acknowledgement must be either applied or replayed")
        return self


class KnowledgeFSDifyIntegrationActivationRequest(_StrictLifecycleModel):
    """Tenant-scoped monotonic activation command sent only after local cutover gates pass."""

    namespace_id: str = Field(min_length=1, max_length=255)
    control_space_id: str = Field(min_length=1, max_length=255)
    activation_id: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    activation_revision: int = Field(ge=1, le=9_007_199_254_740_991)
    source_revision_digest: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")

    @field_validator("namespace_id", "control_space_id", "activation_id")
    @classmethod
    def validate_normalized_identifier(cls, value: str) -> str:
        if value.strip() != value:
            raise ValueError("activation identifiers must be normalized")
        return value


class KnowledgeFSDifyIntegrationActivationAck(_StrictLifecycleModel):
    """Exact durable KnowledgeFS acknowledgement required before local routes are enabled."""

    namespace_id: str = Field(min_length=1, max_length=255)
    activation_id: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    activation_revision: int = Field(ge=1, le=9_007_199_254_740_991)
    source_revision_digest: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    activated_at: datetime
    updated_at: datetime
    active: Literal[True]
    applied: bool
    replayed: bool

    @field_validator("namespace_id", "activation_id")
    @classmethod
    def validate_normalized_identifier(cls, value: str) -> str:
        if value.strip() != value:
            raise ValueError("activation identifiers must be normalized")
        return value

    @field_validator("activated_at", "updated_at")
    @classmethod
    def validate_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("activation timestamps must include a timezone")
        return value

    @model_validator(mode="after")
    def validate_outcome(self) -> KnowledgeFSDifyIntegrationActivationAck:
        if self.applied is self.replayed:
            raise ValueError("activation acknowledgement must be either applied or replayed")
        return self


class KnowledgeFSDeletionPhase(StrEnum):
    ACCEPTED = "accepted"
    IRREVERSIBLE = "irreversible"
    COMPLETED = "completed"


class KnowledgeFSDeletionProgress(NamedTuple):
    phase: KnowledgeFSDeletionPhase
    revision: int
    irreversible_at: datetime | None


class KnowledgeFSLifecycleRemotePort(Protocol):
    """Explicit hexagonal boundary; tests inject a fake with no HTTP dependency."""

    def provision_integrated_space(self, request: KnowledgeFSIntegratedProvisionRequest) -> KnowledgeFSRemoteSpace: ...

    def request_integrated_deletion(
        self, request: KnowledgeFSIntegratedDeletionRequest
    ) -> KnowledgeFSDeletionProgress: ...

    def revoke_capability_grant(
        self, request: KnowledgeFSCapabilityGrantRevokeRequest
    ) -> KnowledgeFSCapabilityGrantRevokeAck: ...

    def activate_dify_workspace_integration(
        self, request: KnowledgeFSDifyIntegrationActivationRequest
    ) -> KnowledgeFSDifyIntegrationActivationAck: ...

    def freeze_dify_workspace_integration(
        self, request: KnowledgeFSDifyIntegrationFreezeRequest
    ) -> KnowledgeFSDifyIntegrationFreezeAck: ...

    def find_by_provisioning_key(
        self,
        *,
        provisioning_key: str,
        control_space_id: str,
    ) -> KnowledgeFSRemoteSpace | None: ...

    def list_spaces(
        self,
        *,
        namespace_id: str,
        control_space_id: str,
    ) -> tuple[KnowledgeFSRemoteSpace, ...]: ...


class KnowledgeFSLifecycleRemoteError(RuntimeError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


__all__ = [
    "KnowledgeFSCapabilityGrantRevokeAck",
    "KnowledgeFSCapabilityGrantRevokeRequest",
    "KnowledgeFSDeletionPhase",
    "KnowledgeFSDeletionProgress",
    "KnowledgeFSDifyIntegrationActivationAck",
    "KnowledgeFSDifyIntegrationActivationRequest",
    "KnowledgeFSDifyIntegrationFreezeAck",
    "KnowledgeFSDifyIntegrationFreezeRequest",
    "KnowledgeFSIntegratedDeletionRequest",
    "KnowledgeFSIntegratedProvisionRequest",
    "KnowledgeFSLifecycleRemoteError",
    "KnowledgeFSLifecycleRemotePort",
    "KnowledgeFSRemoteSpace",
]
