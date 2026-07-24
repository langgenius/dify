"""Domain contracts for resolving configured recipient sources into runtime approvers.

This context is the only place where configuration-time RecipientConfig
objects become ApproverGrant and DeliveryEndpoint drafts. Persistence and
provider I/O are represented by narrow ports and remain outside the domain. The
resolution result is an ephemeral factory input, not a persisted plan or a
separate lifecycle object.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from core.human_input_v2.entities import (
    ContactId,
    HumanInputApproverGrantSubjectType,
    HumanInputDeliveryChannel,
    IMIdentityId,
    IMProvider,
)
from core.workflow.nodes.human_input_v2.entities import RecipientType

from domain_model.configuration.model import FormConfiguration
from domain_model.shared.identifiers import ApproverGrantKey
from domain_model.shared.value_objects import EmailAddress


class DebugRecipientSource(StrEnum):
    """Resolution source that has no persisted RecipientConfig equivalent."""

    DEBUGGER = "debugger"


type RecipientMatchSource = RecipientType | DebugRecipientSource


class ResolutionFailureCode(StrEnum):
    """Stable reasons retained when one configured source cannot be resolved."""

    INVALID_EMAIL = "invalid_email"
    UNSUPPORTED_TYPE = "unsupported_type"
    DUPLICATED_EMAIL = "duplicated_email"
    CONTACT_UNAVAILABLE = "contact_unavailable"
    INITIATOR_UNAVAILABLE = "initiator_unavailable"
    NO_DELIVERY_CHANNEL = "no_delivery_channel"


@dataclass(frozen=True, slots=True)
class ResolvedContact:
    """Current Contact Directory projection consumed during task creation."""

    contact_id: ContactId
    email: EmailAddress | None
    im_identity_id: IMIdentityId | None
    selectable: bool


@dataclass(frozen=True, slots=True)
class ResolvedInitiator:
    """Current run initiator after entry-point-specific identity resolution.

    Service API and CLI are invocation sources, not grant subject types. The result
    must therefore be a workspace user, end user, Contact, or unavailable.
    """

    subject_type: HumanInputApproverGrantSubjectType
    subject_id: str
    contact: ResolvedContact | None = None


@dataclass(frozen=True, slots=True)
class ApproverGrantDraft:
    """Canonical allowed-approver candidate produced for one form instance."""

    approver_grant_key: ApproverGrantKey
    subject_type: HumanInputApproverGrantSubjectType
    matched_sources: tuple[RecipientMatchSource, ...]
    contact_id: ContactId | None = None
    end_user_id: str | None = None
    normalized_email: EmailAddress | None = None

    def __post_init__(self) -> None:
        subject_values = (self.contact_id, self.end_user_id, self.normalized_email)
        if sum(value is not None for value in subject_values) != 1:
            raise ValueError("approver grant requires exactly one subject value")
        if (
            self.subject_type is HumanInputApproverGrantSubjectType.CONTACT
            and self.contact_id is None
        ):
            raise ValueError("contact approver grant requires contact_id")
        if (
            self.subject_type is HumanInputApproverGrantSubjectType.END_USER
            and self.end_user_id is None
        ):
            raise ValueError("end-user approver grant requires end_user_id")
        if (
            self.subject_type is HumanInputApproverGrantSubjectType.EMAIL_ADDRESS
            and self.normalized_email is None
        ):
            raise ValueError("email-address approver grant requires normalized_email")


@dataclass(frozen=True, slots=True)
class DeliveryEndpointDraft:
    """Concrete delivery target associated with exactly one approver grant draft."""

    endpoint_key: str
    approver_grant_key: ApproverGrantKey
    channel: HumanInputDeliveryChannel
    email: EmailAddress | None = None
    provider: IMProvider | None = None
    im_identity_id: IMIdentityId | None = None

    def __post_init__(self) -> None:
        if self.channel is HumanInputDeliveryChannel.EMAIL:
            if (
                self.email is None
                or self.provider is not None
                or self.im_identity_id is not None
            ):
                raise ValueError("email endpoint requires only an email address")
            return
        if self.channel is HumanInputDeliveryChannel.IM:
            if (
                self.provider is None
                or self.im_identity_id is None
                or self.email is not None
            ):
                raise ValueError("IM endpoint requires provider and IM identity")


@dataclass(frozen=True, slots=True)
class ResolutionFailure:
    """Auditable failure for one source value that did not become an approver grant."""

    source: RecipientMatchSource
    code: ResolutionFailureCode
    source_reference: str


@dataclass(frozen=True, slots=True)
class ResolvedRecipients:
    """Ephemeral, fully canonicalized result consumed during task creation.

    One approver grant may own many endpoints. Every endpoint must reference a
    known grant, preventing the v1 relationship where recipient and delivery rows
    could redundantly point at inconsistent form ownership. This object has no
    identity or lifecycle and must not be stored as an execution plan.
    """

    approver_grants: tuple[ApproverGrantDraft, ...]
    delivery_endpoints: tuple[DeliveryEndpointDraft, ...]
    failures: tuple[ResolutionFailure, ...]

    def __post_init__(self) -> None:
        approver_grant_keys = [
            grant.approver_grant_key for grant in self.approver_grants
        ]
        if len(approver_grant_keys) != len(set(approver_grant_keys)):
            raise ValueError(
                "approver grants must be canonicalized before creating a resolution"
            )
        known_approver_grant_keys = set(approver_grant_keys)
        if any(
            endpoint.approver_grant_key not in known_approver_grant_keys
            for endpoint in self.delivery_endpoints
        ):
            raise ValueError("delivery endpoint references an unknown approver grant")
        endpoint_keys = [endpoint.endpoint_key for endpoint in self.delivery_endpoints]
        if len(endpoint_keys) != len(set(endpoint_keys)):
            raise ValueError(
                "delivery endpoint keys must be unique within one resolution"
            )

    def require_waitable_task(self) -> None:
        """Fail fast when resolution cannot produce any allowed approver."""

        current_initiator_is_available = any(
            RecipientType.INITIATOR in grant.matched_sources
            for grant in self.approver_grants
        )
        if not self.approver_grants or (
            not self.delivery_endpoints and not current_initiator_is_available
        ):
            raise NoValidRecipientsError("No notified recipients available")


class NoValidRecipientsError(ValueError):
    """Raised when a waiting task would have no valid allowed approver."""


class ContactResolutionPort(Protocol):
    """Current Contact Directory queries required by recipient resolution."""

    def get_selectable_contact(self, contact_id: ContactId) -> ResolvedContact | None:
        """Return the current workspace-scoped Contact projection if selectable."""

        ...

    def find_by_normalized_email(self, email: EmailAddress) -> ResolvedContact | None:
        """Match within the current Organization boundary only."""

        ...


class VariableResolutionPort(Protocol):
    """Runtime variable reader used only for dynamic email specifications."""

    def read(self, selector: tuple[str, ...]) -> object:
        """Return the raw runtime value so the resolver can enforce string-only email rules."""

        ...


class InitiatorResolutionPort(Protocol):
    """Entry-point-aware resolver for current initiator identity."""

    def resolve_current_initiator(self) -> ResolvedInitiator | None:
        """Return a grant subject or None; never return an API credential holder."""

        ...


class RecipientResolver(Protocol):
    """Domain service boundary used internally by ``FormInstanceFactory``."""

    def resolve(
        self,
        *,
        configuration: FormConfiguration,
        contacts: ContactResolutionPort,
        variables: VariableResolutionPort,
        initiator: InitiatorResolutionPort,
        debug_run: bool,
    ) -> ResolvedRecipients:
        """Validate, resolve, canonicalize, and derive endpoint drafts.

        Implementations must resolve dynamic email in this order: type check,
        canonical email validation, Contact lookup, then task-scoped email fallback.
        Contact-backed grants use ``contact:<contact_id>`` as the canonical key;
        end-user grants use ``end_user:<end_user_id>``; email-address grants use
        ``email_address:<sha256(normalized_email)>``. Multiple sources and channels
        never duplicate the grant.
        """

        ...
