"""Canonical approval plan values and single-entry recipient resolution.

``RecipientResolver.resolve`` is the only public operation that converts saved
recipient specifications into approvers. Validation, Contact upgrade, subject
deduplication, matched-source aggregation, debug replacement, and endpoint
planning stay behind that interface so callers cannot apply them inconsistently.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from hashlib import sha256

from core.human_input_v2.contact_directory import (
    Contact,
    ContactDirectoryError,
    ContactDirectoryPolicy,
    ContactDirectorySnapshot,
    ContactResolution,
)
from core.human_input_v2.entities import HumanInputApproverGrantSubjectType, HumanInputDeliveryChannel, IMProvider
from core.human_input_v2.im_integration import EffectiveIMBindingSnapshot
from core.human_input_v2.shared import (
    ContactId,
    EndUserId,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    NormalizedEmail,
)

from .recipient_specifications import (
    ContactRecipientSpecification,
    DynamicEmailRecipientSpecification,
    DynamicRecipientValue,
    OneTimeEmailRecipientSpecification,
    RecipientSpecification,
    UnsupportedDynamicRecipientValue,
)


@dataclass(frozen=True, slots=True)
class CanonicalSubjectKey:
    """Portable form-scoped deduplication key, not an authorization identity."""

    value: str

    def __post_init__(self) -> None:
        namespace, separator, identity = self.value.partition(":")
        valid_named_identity = namespace in {"contact", "end_user"} and bool(identity)
        valid_email_digest = (
            namespace == "email_address"
            and len(identity) == 64
            and all(character in "0123456789abcdef" for character in identity)
        )
        if not separator or not (valid_named_identity or valid_email_digest):
            raise ValueError("canonical subject key has an invalid portable format")

    @classmethod
    def for_contact(cls, contact_id: ContactId) -> CanonicalSubjectKey:
        return cls(f"contact:{contact_id}")

    @classmethod
    def for_end_user(cls, end_user_id: EndUserId) -> CanonicalSubjectKey:
        return cls(f"end_user:{end_user_id}")

    @classmethod
    def for_email(cls, normalized_email: NormalizedEmail) -> CanonicalSubjectKey:
        digest = sha256(normalized_email.value.encode()).hexdigest()
        return cls(f"email_address:{digest}")


@dataclass(frozen=True, slots=True)
class ContactApprovalSubject:
    """Approval authority backed by one canonical Contact."""

    contact_id: ContactId

    @property
    def subject_type(self) -> HumanInputApproverGrantSubjectType:
        return HumanInputApproverGrantSubjectType.CONTACT

    def to_primitive(self) -> dict[str, object]:
        return {"type": self.subject_type.value, "contact_id": self.contact_id.to_primitive()}


@dataclass(frozen=True, slots=True)
class EndUserApprovalSubject:
    """Approval authority backed by one app-scoped EndUser."""

    end_user_id: EndUserId

    @property
    def subject_type(self) -> HumanInputApproverGrantSubjectType:
        return HumanInputApproverGrantSubjectType.END_USER

    def to_primitive(self) -> dict[str, object]:
        return {"type": self.subject_type.value, "end_user_id": self.end_user_id.to_primitive()}


@dataclass(frozen=True, slots=True)
class EmailAddressApprovalSubject:
    """Task-scoped approval authority backed by one normalized Email address."""

    normalized_email: NormalizedEmail

    @property
    def subject_type(self) -> HumanInputApproverGrantSubjectType:
        return HumanInputApproverGrantSubjectType.EMAIL_ADDRESS

    def to_primitive(self) -> dict[str, object]:
        return {"type": self.subject_type.value, "normalized_email": self.normalized_email.to_primitive()}


type ApprovalSubject = ContactApprovalSubject | EndUserApprovalSubject | EmailAddressApprovalSubject


class RecipientSourceKind(StrEnum):
    """Stable source discriminator retained after canonicalization."""

    STATIC_CONTACT = "static_contact"
    ONE_TIME_EMAIL = "one_time_email"
    DYNAMIC_EMAIL = "dynamic_email"
    CURRENT_INITIATOR = "current_initiator"
    DEBUG_REPLACEMENT = "debug_replacement"


@dataclass(frozen=True, slots=True)
class MatchedRecipientSource:
    """One ordered configured or request-scoped source of an approver."""

    kind: RecipientSourceKind
    position: int
    reference: str | None

    def __post_init__(self) -> None:
        if self.position < 0:
            raise ValueError("recipient source position must not be negative")

    def to_primitive(self) -> dict[str, object]:
        return {"kind": self.kind.value, "position": self.position, "reference": self.reference}


@dataclass(frozen=True, slots=True)
class SubjectSnapshot:
    """Display-only identity facts captured by resolution."""

    display_name: str | None
    email: str | None

    def to_primitive(self) -> dict[str, object]:
        return {"display_name": self.display_name, "email": self.email}


@dataclass(frozen=True, slots=True)
class EmailEndpointPlan:
    """Email delivery destination for one canonical approver."""

    email_address: NormalizedEmail

    @property
    def channel(self) -> HumanInputDeliveryChannel:
        return HumanInputDeliveryChannel.EMAIL

    def to_primitive(self) -> dict[str, object]:
        return {"channel": self.channel.value, "email_address": self.email_address.to_primitive()}


@dataclass(frozen=True, slots=True)
class IMEndpointPlan:
    """Credential-free IM delivery destination frozen from an effective binding."""

    integration_id: IntegrationId
    provider: IMProvider
    provider_tenant_id: str
    identity_id: IMIdentityId
    binding_id: IMBindingId | None
    provider_user_id: str

    @property
    def channel(self) -> HumanInputDeliveryChannel:
        return HumanInputDeliveryChannel.IM

    def to_primitive(self) -> dict[str, object]:
        return {
            "channel": self.channel.value,
            "integration_id": self.integration_id.to_primitive(),
            "provider": self.provider.value,
            "provider_tenant_id": self.provider_tenant_id,
            "identity_id": self.identity_id.to_primitive(),
            "binding_id": self.binding_id.to_primitive() if self.binding_id is not None else None,
            "provider_user_id": self.provider_user_id,
        }


@dataclass(frozen=True, slots=True)
class WebEndpointPlan:
    """Public or trusted-app web interaction surface without a saved token."""

    @property
    def channel(self) -> HumanInputDeliveryChannel:
        return HumanInputDeliveryChannel.WEB

    def to_primitive(self) -> dict[str, object]:
        return {"channel": self.channel.value}


@dataclass(frozen=True, slots=True)
class ConsoleEndpointPlan:
    """Authenticated console interaction surface without a notification address."""

    @property
    def channel(self) -> HumanInputDeliveryChannel:
        return HumanInputDeliveryChannel.CONSOLE

    def to_primitive(self) -> dict[str, object]:
        return {"channel": self.channel.value}


type DeliveryEndpointPlan = EmailEndpointPlan | IMEndpointPlan | WebEndpointPlan | ConsoleEndpointPlan


class RecipientRejectionReason(StrEnum):
    """Transport-neutral reason for rejecting one recipient source."""

    INVALID_CONTACT_ID = "invalid_contact_id"
    CONTACT_UNAVAILABLE = "contact_unavailable"
    INVALID_DYNAMIC_SELECTOR = "invalid_dynamic_selector"
    DYNAMIC_VALUE_UNAVAILABLE = "dynamic_value_unavailable"
    UNSUPPORTED_DYNAMIC_TYPE = "unsupported_dynamic_type"
    INVALID_EMAIL = "invalid_email"
    INITIATOR_UNAVAILABLE = "initiator_unavailable"
    NO_USABLE_ENDPOINT = "no_usable_endpoint"


@dataclass(frozen=True, slots=True)
class RejectedRecipient:
    """Machine-readable source failure retained alongside valid approvers."""

    source: MatchedRecipientSource
    reason: RecipientRejectionReason
    rejected_value: str | None

    def to_primitive(self) -> dict[str, object]:
        return {
            "source": self.source.to_primitive(),
            "reason": self.reason.value,
            "rejected_value": self.rejected_value,
        }


@dataclass(frozen=True, slots=True)
class ResolvedApprover:
    """One canonical subject with all matched sources and usable endpoints."""

    subject: ApprovalSubject
    subject_key: CanonicalSubjectKey
    matched_sources: tuple[MatchedRecipientSource, ...]
    subject_snapshot: SubjectSnapshot
    endpoints: tuple[DeliveryEndpointPlan, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.matched_sources, tuple) or not isinstance(self.endpoints, tuple):
            raise TypeError("resolved approver collections must be immutable tuples")
        if self.subject_key != _canonical_key_for_subject(self.subject):
            raise ValueError("resolved approver subject key does not match its subject")

    def to_primitive(self) -> dict[str, object]:
        return {
            "subject": self.subject.to_primitive(),
            "subject_key": self.subject_key.value,
            "matched_sources": [source.to_primitive() for source in self.matched_sources],
            "subject_snapshot": self.subject_snapshot.to_primitive(),
            "endpoints": [endpoint.to_primitive() for endpoint in self.endpoints],
        }


class RecipientResolutionFailureReason(StrEnum):
    """Stable whole-plan failure independent from HTTP or provider semantics."""

    NO_VALID_RECIPIENTS = "no_valid_recipients"


@dataclass(frozen=True, slots=True)
class ResolvedApprovalPlan:
    """Immutable complete output of one recipient resolution request."""

    approvers: tuple[ResolvedApprover, ...]
    rejected_recipients: tuple[RejectedRecipient, ...]
    failure_reason: RecipientResolutionFailureReason | None

    def __post_init__(self) -> None:
        if not isinstance(self.approvers, tuple) or not isinstance(self.rejected_recipients, tuple):
            raise TypeError("approval plan collections must be immutable tuples")
        if self.approvers and self.failure_reason is not None:
            raise ValueError("a plan with approvers cannot have a failure reason")
        if not self.approvers and self.failure_reason is None:
            raise ValueError("a plan without approvers must have a failure reason")

    def to_primitive(self) -> dict[str, object]:
        return {
            "approvers": [approver.to_primitive() for approver in self.approvers],
            "rejected_recipients": [rejection.to_primitive() for rejection in self.rejected_recipients],
            "failure_reason": self.failure_reason.value if self.failure_reason is not None else None,
        }


@dataclass(frozen=True, slots=True)
class ContactInitiatorSnapshot:
    """Current request initiator resolved to a canonical Contact reference."""

    contact_id: ContactId


@dataclass(frozen=True, slots=True)
class EndUserInitiatorSnapshot:
    """Current request initiator resolved to one app-scoped EndUser."""

    end_user_id: EndUserId
    display_name: str | None
    email: str | None


type InitiatorSnapshot = ContactInitiatorSnapshot | EndUserInitiatorSnapshot


@dataclass(frozen=True, slots=True)
class DebugRecipientReplacement:
    """Valid debug actor that replaces saved recipients for one request only."""

    subject: InitiatorSnapshot


@dataclass(frozen=True, slots=True)
class DeliveryCapabilitySnapshot:
    """Request-scoped effective delivery and interaction capabilities.

    IM values are already resolved by the IM control plane; this domain never
    sees credentials, raw provider clients, or invalid binding candidates.
    Explicit Web/Console sets prevent recipient resolution from inventing
    interaction surfaces that the current runtime cannot actually expose.
    """

    im_bindings: tuple[EffectiveIMBindingSnapshot, ...] = ()
    contact_web_ids: frozenset[ContactId] = frozenset()
    contact_console_ids: frozenset[ContactId] = frozenset()
    end_user_web_ids: frozenset[EndUserId] = frozenset()
    email_address_web_available: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.im_bindings, tuple):
            raise TypeError("effective IM bindings must be an immutable tuple")
        if not all(
            isinstance(values, frozenset)
            for values in (self.contact_web_ids, self.contact_console_ids, self.end_user_web_ids)
        ):
            raise TypeError("interaction capability identifiers must be immutable frozensets")


@dataclass(slots=True)
class _PendingApprover:
    """Private mutable accumulator hidden behind the immutable resolver result."""

    subject: ApprovalSubject
    subject_key: CanonicalSubjectKey
    subject_snapshot: SubjectSnapshot
    first_source_position: int
    matched_sources: list[MatchedRecipientSource] = field(default_factory=list)
    endpoints: list[DeliveryEndpointPlan] = field(default_factory=list)


class RecipientResolver:
    """Resolve all recipient semantics through one deterministic domain entry."""

    @staticmethod
    def resolve(
        *,
        specifications: tuple[RecipientSpecification, ...],
        directory: ContactDirectorySnapshot,
        dynamic_values: tuple[DynamicRecipientValue, ...],
        initiator: InitiatorSnapshot | None,
        capabilities: DeliveryCapabilitySnapshot,
        debug_replacement: DebugRecipientReplacement | None = None,
    ) -> ResolvedApprovalPlan:
        """Resolve immutable request inputs into one complete approval plan.

        Invalid or unavailable sources are returned as typed rejection facts;
        the method raises only when a caller violates an immutable input shape.
        No database, provider, transport, or mutation side effects occur.
        """
        if not isinstance(specifications, tuple) or not isinstance(dynamic_values, tuple):
            raise TypeError("recipient resolution inputs must be immutable tuples")

        pending_approvers: dict[CanonicalSubjectKey, _PendingApprover] = {}
        rejected_recipients: list[RejectedRecipient] = []
        dynamic_values_by_selector: dict[tuple[str, ...], DynamicRecipientValue] = {}
        for dynamic_value in dynamic_values:
            dynamic_values_by_selector.setdefault(dynamic_value.selector, dynamic_value)

        if debug_replacement is not None:
            source = MatchedRecipientSource(RecipientSourceKind.DEBUG_REPLACEMENT, 0, None)
            RecipientResolver._resolve_initiator(
                debug_replacement.subject,
                source,
                directory,
                capabilities,
                pending_approvers,
                rejected_recipients,
            )
        else:
            for position, specification in enumerate(specifications):
                RecipientResolver._resolve_specification(
                    specification,
                    position,
                    directory,
                    dynamic_values_by_selector,
                    initiator,
                    capabilities,
                    pending_approvers,
                    rejected_recipients,
                )

        approvers: list[ResolvedApprover] = []
        for pending in sorted(
            pending_approvers.values(),
            key=lambda candidate: (candidate.first_source_position, candidate.subject_key.value),
        ):
            matched_sources = tuple(sorted(pending.matched_sources, key=_source_sort_key))
            endpoints = tuple(sorted(pending.endpoints, key=_endpoint_sort_key))
            if not endpoints:
                rejected_recipients.extend(
                    RejectedRecipient(
                        source=source,
                        reason=RecipientRejectionReason.NO_USABLE_ENDPOINT,
                        rejected_value=pending.subject_key.value,
                    )
                    for source in matched_sources
                )
                continue
            approvers.append(
                ResolvedApprover(
                    subject=pending.subject,
                    subject_key=pending.subject_key,
                    matched_sources=matched_sources,
                    subject_snapshot=pending.subject_snapshot,
                    endpoints=endpoints,
                )
            )

        ordered_rejections = tuple(sorted(rejected_recipients, key=_rejection_sort_key))
        failure_reason = None if approvers else RecipientResolutionFailureReason.NO_VALID_RECIPIENTS
        return ResolvedApprovalPlan(tuple(approvers), ordered_rejections, failure_reason)

    @staticmethod
    def _resolve_specification(
        specification: RecipientSpecification,
        position: int,
        directory: ContactDirectorySnapshot,
        dynamic_values_by_selector: dict[tuple[str, ...], DynamicRecipientValue],
        initiator: InitiatorSnapshot | None,
        capabilities: DeliveryCapabilitySnapshot,
        pending_approvers: dict[CanonicalSubjectKey, _PendingApprover],
        rejected_recipients: list[RejectedRecipient],
    ) -> None:
        if isinstance(specification, ContactRecipientSpecification):
            source = MatchedRecipientSource(
                RecipientSourceKind.STATIC_CONTACT,
                position,
                specification.contact_id,
            )
            try:
                contact_id = ContactId(specification.contact_id)
            except ValueError:
                rejected_recipients.append(
                    RejectedRecipient(source, RecipientRejectionReason.INVALID_CONTACT_ID, specification.contact_id)
                )
                return
            RecipientResolver._resolve_contact(
                contact_id,
                source,
                directory,
                capabilities,
                pending_approvers,
                rejected_recipients,
            )
            return

        if isinstance(specification, OneTimeEmailRecipientSpecification):
            source = MatchedRecipientSource(
                RecipientSourceKind.ONE_TIME_EMAIL,
                position,
                specification.email,
            )
            RecipientResolver._resolve_email(
                specification.email,
                source,
                directory,
                capabilities,
                pending_approvers,
                rejected_recipients,
            )
            return

        if isinstance(specification, DynamicEmailRecipientSpecification):
            selector_reference = ".".join(specification.selector)
            source = MatchedRecipientSource(
                RecipientSourceKind.DYNAMIC_EMAIL,
                position,
                selector_reference,
            )
            if not specification.selector or any(not component.strip() for component in specification.selector):
                rejected_recipients.append(
                    RejectedRecipient(source, RecipientRejectionReason.INVALID_DYNAMIC_SELECTOR, selector_reference)
                )
                return
            dynamic_value = dynamic_values_by_selector.get(specification.selector)
            if dynamic_value is None:
                rejected_recipients.append(
                    RejectedRecipient(source, RecipientRejectionReason.DYNAMIC_VALUE_UNAVAILABLE, selector_reference)
                )
                return
            if isinstance(dynamic_value.value, UnsupportedDynamicRecipientValue):
                rejected_recipients.append(
                    RejectedRecipient(
                        source,
                        RecipientRejectionReason.UNSUPPORTED_DYNAMIC_TYPE,
                        dynamic_value.value.value_type,
                    )
                )
                return
            RecipientResolver._resolve_email(
                dynamic_value.value,
                source,
                directory,
                capabilities,
                pending_approvers,
                rejected_recipients,
            )
            return

        source = MatchedRecipientSource(RecipientSourceKind.CURRENT_INITIATOR, position, None)
        if initiator is None:
            rejected_recipients.append(RejectedRecipient(source, RecipientRejectionReason.INITIATOR_UNAVAILABLE, None))
            return
        RecipientResolver._resolve_initiator(
            initiator,
            source,
            directory,
            capabilities,
            pending_approvers,
            rejected_recipients,
        )

    @staticmethod
    def _resolve_initiator(
        initiator: InitiatorSnapshot,
        source: MatchedRecipientSource,
        directory: ContactDirectorySnapshot,
        capabilities: DeliveryCapabilitySnapshot,
        pending_approvers: dict[CanonicalSubjectKey, _PendingApprover],
        rejected_recipients: list[RejectedRecipient],
    ) -> None:
        if isinstance(initiator, ContactInitiatorSnapshot):
            RecipientResolver._resolve_contact(
                initiator.contact_id,
                source,
                directory,
                capabilities,
                pending_approvers,
                rejected_recipients,
            )
            return

        normalized_email: NormalizedEmail | None = None
        if initiator.email is not None:
            try:
                normalized_email = NormalizedEmail(initiator.email)
            except ValueError:
                normalized_email = None
        subject = EndUserApprovalSubject(initiator.end_user_id)
        endpoints: list[DeliveryEndpointPlan] = []
        if normalized_email is not None:
            endpoints.append(EmailEndpointPlan(normalized_email))
        if initiator.end_user_id in capabilities.end_user_web_ids:
            endpoints.append(WebEndpointPlan())
        RecipientResolver._add_approver(
            subject,
            source,
            SubjectSnapshot(initiator.display_name, normalized_email.value if normalized_email is not None else None),
            endpoints,
            pending_approvers,
        )

    @staticmethod
    def _resolve_contact(
        contact_id: ContactId,
        source: MatchedRecipientSource,
        directory: ContactDirectorySnapshot,
        capabilities: DeliveryCapabilitySnapshot,
        pending_approvers: dict[CanonicalSubjectKey, _PendingApprover],
        rejected_recipients: list[RejectedRecipient],
    ) -> None:
        try:
            resolution = ContactDirectoryPolicy.resolve_for_workspace(directory, contact_id)
        except ContactDirectoryError:
            resolution = ContactResolution.ABSENT
        contact = directory.find(contact_id)
        if resolution is ContactResolution.ABSENT or contact is None:
            rejected_recipients.append(
                RejectedRecipient(source, RecipientRejectionReason.CONTACT_UNAVAILABLE, contact_id.value)
            )
            return
        RecipientResolver._add_contact_approver(contact, source, capabilities, pending_approvers)

    @staticmethod
    def _resolve_email(
        email: str,
        source: MatchedRecipientSource,
        directory: ContactDirectorySnapshot,
        capabilities: DeliveryCapabilitySnapshot,
        pending_approvers: dict[CanonicalSubjectKey, _PendingApprover],
        rejected_recipients: list[RejectedRecipient],
    ) -> None:
        try:
            normalized_email = NormalizedEmail(email)
        except ValueError:
            rejected_recipients.append(RejectedRecipient(source, RecipientRejectionReason.INVALID_EMAIL, email))
            return

        matching_contacts = sorted(
            (contact for contact in directory.contacts if contact.normalized_email == normalized_email),
            key=lambda contact: contact.id.value,
        )
        for contact in matching_contacts:
            try:
                resolution = ContactDirectoryPolicy.resolve_for_workspace(directory, contact.id)
            except ContactDirectoryError:
                continue
            if resolution is not ContactResolution.ABSENT:
                RecipientResolver._add_contact_approver(contact, source, capabilities, pending_approvers)
                return

        subject = EmailAddressApprovalSubject(normalized_email)
        endpoints: list[DeliveryEndpointPlan] = [EmailEndpointPlan(normalized_email)]
        if capabilities.email_address_web_available:
            endpoints.append(WebEndpointPlan())
        RecipientResolver._add_approver(
            subject,
            source,
            SubjectSnapshot(None, normalized_email.value),
            endpoints,
            pending_approvers,
        )

    @staticmethod
    def _add_contact_approver(
        contact: Contact,
        source: MatchedRecipientSource,
        capabilities: DeliveryCapabilitySnapshot,
        pending_approvers: dict[CanonicalSubjectKey, _PendingApprover],
    ) -> None:
        endpoints: list[DeliveryEndpointPlan] = []
        if contact.normalized_email is not None:
            endpoints.append(EmailEndpointPlan(contact.normalized_email))
        endpoints.extend(
            IMEndpointPlan(
                integration_id=binding.integration_id,
                provider=binding.provider,
                provider_tenant_id=binding.provider_tenant_id,
                identity_id=binding.identity_id,
                binding_id=binding.binding_id,
                provider_user_id=binding.provider_user_id,
            )
            for binding in capabilities.im_bindings
            if binding.contact_id == contact.id
        )
        if contact.id in capabilities.contact_web_ids:
            endpoints.append(WebEndpointPlan())
        if contact.id in capabilities.contact_console_ids:
            endpoints.append(ConsoleEndpointPlan())
        RecipientResolver._add_approver(
            ContactApprovalSubject(contact.id),
            source,
            SubjectSnapshot(contact.name, contact.email),
            endpoints,
            pending_approvers,
        )

    @staticmethod
    def _add_approver(
        subject: ApprovalSubject,
        source: MatchedRecipientSource,
        subject_snapshot: SubjectSnapshot,
        endpoints: list[DeliveryEndpointPlan],
        pending_approvers: dict[CanonicalSubjectKey, _PendingApprover],
    ) -> None:
        subject_key = _canonical_key_for_subject(subject)
        pending = pending_approvers.get(subject_key)
        if pending is None:
            pending = _PendingApprover(
                subject=subject,
                subject_key=subject_key,
                subject_snapshot=subject_snapshot,
                first_source_position=source.position,
            )
            pending_approvers[subject_key] = pending
        if source not in pending.matched_sources:
            pending.matched_sources.append(source)
        for endpoint in endpoints:
            if endpoint not in pending.endpoints:
                pending.endpoints.append(endpoint)


def _canonical_key_for_subject(subject: ApprovalSubject) -> CanonicalSubjectKey:
    if isinstance(subject, ContactApprovalSubject):
        return CanonicalSubjectKey.for_contact(subject.contact_id)
    if isinstance(subject, EndUserApprovalSubject):
        return CanonicalSubjectKey.for_end_user(subject.end_user_id)
    return CanonicalSubjectKey.for_email(subject.normalized_email)


_CHANNEL_ORDER = {
    HumanInputDeliveryChannel.EMAIL: 0,
    HumanInputDeliveryChannel.IM: 1,
    HumanInputDeliveryChannel.WEB: 2,
    HumanInputDeliveryChannel.CONSOLE: 3,
}


def _source_sort_key(source: MatchedRecipientSource) -> tuple[int, str, str]:
    return source.position, source.kind.value, source.reference or ""


def _endpoint_sort_key(endpoint: DeliveryEndpointPlan) -> tuple[int, str, str, str]:
    channel_order = _CHANNEL_ORDER[endpoint.channel]
    if isinstance(endpoint, EmailEndpointPlan):
        return channel_order, endpoint.email_address.value, "", ""
    if isinstance(endpoint, IMEndpointPlan):
        return (
            channel_order,
            endpoint.integration_id.value,
            endpoint.provider.value,
            endpoint.identity_id.value,
        )
    return channel_order, "", "", ""


def _rejection_sort_key(rejection: RejectedRecipient) -> tuple[int, str, str, str]:
    source_key = _source_sort_key(rejection.source)
    return source_key[0], source_key[1], rejection.reason.value, rejection.rejected_value or ""
