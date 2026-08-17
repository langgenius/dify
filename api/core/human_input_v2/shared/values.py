"""Primitive-independent identifiers, scopes, email, and time values."""

from __future__ import annotations

from dataclasses import dataclass
from typing import NewType, override

AccountId = NewType("AccountId", str)
ContactId = NewType("ContactId", str)
EndUserId = NewType("EndUserId", str)
PlatformEntryId = NewType("PlatformEntryId", str)
TenantId = NewType("TenantId", str)
AppId = NewType("AppId", str)
FormId = NewType("FormId", str)
ApproverGrantId = NewType("ApproverGrantId", str)
OTPChallengeId = NewType("OTPChallengeId", str)
DeliveryEndpointId = NewType("DeliveryEndpointId", str)
DeliveryAttemptId = NewType("DeliveryAttemptId", str)
SubmissionId = NewType("SubmissionId", str)
AuditEventId = NewType("AuditEventId", str)
EmailProviderId = NewType("EmailProviderId", str)
UploadCapabilityId = NewType("UploadCapabilityId", str)
UploadFileAssociationId = NewType("UploadFileAssociationId", str)
IntegrationId = NewType("IntegrationId", str)
IMIdentityId = NewType("IMIdentityId", str)
IMBindingId = NewType("IMBindingId", str)
IMReconciliationChangeId = NewType("IMReconciliationChangeId", str)
IMSyncRunId = NewType("IMSyncRunId", str)
IMSyncResultId = NewType("IMSyncResultId", str)


@dataclass(frozen=True, slots=True)
class NormalizedEmail:
    """Case-insensitive canonical email used for identity comparisons."""

    value: str

    def __post_init__(self) -> None:
        if not isinstance(self.value, str):
            raise ValueError("value must be a valid email")
        normalized = self.value.strip().casefold()
        local, separator, domain = normalized.partition("@")
        if not separator or not local or not domain or " " in normalized or "@" in domain:
            raise ValueError("value must be a valid email")
        object.__setattr__(self, "value", normalized)

    @override
    def __str__(self) -> str:
        return self.value

    def to_primitive(self) -> str:
        return self.value


@dataclass(frozen=True, slots=True)
class DeploymentScope:
    """Deployment-wide owner scope used by EE Organization contacts."""

    def to_primitive(self) -> dict[str, str]:
        return {"kind": "deployment"}


@dataclass(frozen=True, slots=True)
class WorkspaceScope:
    """Workspace scope whose id is the corresponding Dify Tenant.id."""

    id: TenantId

    def to_primitive(self) -> dict[str, str]:
        return {"kind": "workspace", "id": self.id}


type DirectoryScope = DeploymentScope | WorkspaceScope
