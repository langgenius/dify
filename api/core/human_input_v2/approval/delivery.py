"""Frozen delivery, provider, endpoint-token, and upload facts.

Endpoints describe where a form can be delivered or interacted with. Their
tokens are scoped capabilities only; this module deliberately exposes no actor
or verified-proof conversion. Delivery attempts are append-only diagnostics and
cannot mutate :class:`HumanInputForm` lifecycle state.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from typing import assert_never

from core.human_input_v2.entities import (
    EmailProviderType,
    HumanInputDeliveryAttemptStatus,
    HumanInputDeliveryChannel,
    IMProvider,
)
from core.human_input_v2.shared import (
    AccountId,
    AppId,
    DeliveryAttemptId,
    DeliveryEndpointId,
    EmailProviderId,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    NormalizedEmail,
    UploadCapabilityId,
    UploadFileAssociationId,
    UtcTimestamp,
    WorkspaceId,
)

from .frozen_values import FrozenJSONObject
from .grants import ApproverGrantRef, DeliveryEndpointRef
from .recipient_resolution import (
    ConsoleEndpointPlan,
    DeliveryEndpointPlan,
    EmailEndpointPlan,
    IMEndpointPlan,
    WebEndpointPlan,
)


def _validate_sha256(value: str, *, label: str) -> None:
    if len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
        raise ValueError(f"{label} must be a lower-case SHA-256 digest")


@dataclass(frozen=True, slots=True)
class EndpointAccessCapability:
    """Hashed endpoint interaction capability that carries no identity proof."""

    endpoint_ref: DeliveryEndpointRef
    token_hash: str

    def __post_init__(self) -> None:
        _validate_sha256(self.token_hash, label="endpoint access token hash")


@dataclass(frozen=True, slots=True)
class EmailEndpointConfiguration:
    """Frozen Email delivery address."""

    email_address: NormalizedEmail

    @property
    def channel(self) -> HumanInputDeliveryChannel:
        return HumanInputDeliveryChannel.EMAIL


@dataclass(frozen=True, slots=True)
class IMEndpointConfiguration:
    """Credential-free IM interaction snapshot owned by one integration."""

    integration_id: IntegrationId
    provider: IMProvider
    provider_tenant_id: str
    identity_id: IMIdentityId
    binding_id: IMBindingId | None
    provider_user_id: str

    def __post_init__(self) -> None:
        if not self.provider_tenant_id or not self.provider_user_id:
            raise ValueError("IM endpoint provider identities must not be blank")

    @property
    def channel(self) -> HumanInputDeliveryChannel:
        return HumanInputDeliveryChannel.IM


@dataclass(frozen=True, slots=True)
class WebEndpointConfiguration:
    """Public or trusted-app web interaction surface."""

    @property
    def channel(self) -> HumanInputDeliveryChannel:
        return HumanInputDeliveryChannel.WEB


@dataclass(frozen=True, slots=True)
class ConsoleEndpointConfiguration:
    """Authenticated console interaction surface."""

    @property
    def channel(self) -> HumanInputDeliveryChannel:
        return HumanInputDeliveryChannel.CONSOLE


type DeliveryEndpointConfiguration = (
    EmailEndpointConfiguration | IMEndpointConfiguration | WebEndpointConfiguration | ConsoleEndpointConfiguration
)


@dataclass(frozen=True, slots=True)
class DeliveryEndpoint:
    """Historical endpoint snapshot distinct from its approver grant."""

    ref: DeliveryEndpointRef
    configuration: DeliveryEndpointConfiguration
    address_hash: str
    access_capability: EndpointAccessCapability | None
    created_at: UtcTimestamp
    updated_at: UtcTimestamp

    def __post_init__(self) -> None:
        _validate_sha256(self.address_hash, label="endpoint address hash")
        if self.access_capability is not None and self.access_capability.endpoint_ref != self.ref:
            raise ValueError("endpoint access capability owner does not match the endpoint")

    @property
    def id(self) -> DeliveryEndpointId:
        return self.ref.endpoint_id

    @property
    def grant_ref(self) -> ApproverGrantRef:
        return self.ref.grant_ref

    @property
    def channel(self) -> HumanInputDeliveryChannel:
        return self.configuration.channel

    @classmethod
    def from_plan(
        cls,
        *,
        endpoint_id: DeliveryEndpointId,
        grant_ref: ApproverGrantRef,
        endpoint_plan: DeliveryEndpointPlan,
        access_capability: EndpointAccessCapability | None,
        now: UtcTimestamp,
    ) -> DeliveryEndpoint:
        endpoint_ref = grant_ref.endpoint(endpoint_id)
        configuration: DeliveryEndpointConfiguration
        canonical_address: str
        match endpoint_plan:
            case EmailEndpointPlan(email_address=email_address):
                configuration = EmailEndpointConfiguration(email_address)
                canonical_address = f"email:{email_address}"
            case IMEndpointPlan(
                integration_id=integration_id,
                provider=provider,
                provider_tenant_id=provider_tenant_id,
                identity_id=identity_id,
                binding_id=binding_id,
                provider_user_id=provider_user_id,
            ):
                configuration = IMEndpointConfiguration(
                    integration_id=integration_id,
                    provider=provider,
                    provider_tenant_id=provider_tenant_id,
                    identity_id=identity_id,
                    binding_id=binding_id,
                    provider_user_id=provider_user_id,
                )
                canonical_address = f"im:{integration_id}:{provider.value}:{provider_user_id}"
            case WebEndpointPlan():
                configuration = WebEndpointConfiguration()
                canonical_address = "web"
            case ConsoleEndpointPlan():
                configuration = ConsoleEndpointConfiguration()
                canonical_address = "console"
            case _:
                assert_never(endpoint_plan)
        return cls(
            ref=endpoint_ref,
            configuration=configuration,
            address_hash=sha256(canonical_address.encode()).hexdigest(),
            access_capability=access_capability,
            created_at=now,
            updated_at=now,
        )


@dataclass(frozen=True, slots=True)
class DeliveryAttempt:
    """Append-only provider delivery outcome scoped to one endpoint."""

    id: DeliveryAttemptId
    endpoint_ref: DeliveryEndpointRef
    attempt_number: int
    status: HumanInputDeliveryAttemptStatus
    scheduled_at: UtcTimestamp
    started_at: UtcTimestamp | None
    finished_at: UtcTimestamp | None
    provider_message_id: str | None
    failure_code: str | None
    failure_reason: str | None
    provider_response: FrozenJSONObject | None
    created_at: UtcTimestamp
    updated_at: UtcTimestamp

    def __post_init__(self) -> None:
        if self.attempt_number < 1:
            raise ValueError("delivery attempt number must be positive")
        if self.status is HumanInputDeliveryAttemptStatus.FAILED:
            if self.finished_at is None:
                raise ValueError("failed delivery attempt requires finished_at")
            has_failure_code = self.failure_code is not None and bool(self.failure_code.strip())
            has_failure_reason = self.failure_reason is not None and bool(self.failure_reason.strip())
            if not has_failure_code and not has_failure_reason and self.provider_response is None:
                raise ValueError("failed delivery attempt requires a failure diagnostic")
        if self.status is not HumanInputDeliveryAttemptStatus.FAILED and (
            self.failure_code is not None or self.failure_reason is not None
        ):
            raise ValueError("only failed delivery attempts may contain failure diagnostics")


@dataclass(frozen=True, slots=True)
class EmailProviderConfiguration:
    """Workspace provider configuration kept outside the form domain lifecycle."""

    id: EmailProviderId
    workspace_id: WorkspaceId
    provider: EmailProviderType
    sender_email: NormalizedEmail
    sender_name: str
    encrypted_credentials: FrozenJSONObject
    configured_by_account_id: AccountId | None
    created_at: UtcTimestamp
    updated_at: UtcTimestamp


@dataclass(frozen=True, slots=True)
class UploadCapabilityRef:
    """Upload capability reference carrying the complete endpoint owner chain."""

    endpoint_ref: DeliveryEndpointRef
    capability_id: UploadCapabilityId
    app_id: AppId


@dataclass(frozen=True, slots=True)
class UploadCapability:
    """Hashed upload capability scoped to exactly one form endpoint."""

    id: UploadCapabilityId
    endpoint_ref: DeliveryEndpointRef
    app_id: AppId
    token_hash: str
    created_at: UtcTimestamp
    updated_at: UtcTimestamp

    def __post_init__(self) -> None:
        _validate_sha256(self.token_hash, label="upload token hash")

    @property
    def ref(self) -> UploadCapabilityRef:
        return UploadCapabilityRef(self.endpoint_ref, self.id, self.app_id)


@dataclass(frozen=True, slots=True)
class UploadFileAssociation:
    """Durable file fact whose scope is inherited from its upload capability."""

    id: UploadFileAssociationId
    capability_ref: UploadCapabilityRef
    upload_file_id: str
    created_at: UtcTimestamp
    updated_at: UtcTimestamp

    def __post_init__(self) -> None:
        if not self.upload_file_id.strip():
            raise ValueError("upload file id must not be blank")
