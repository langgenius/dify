"""Pure current-state authorization for Human Input v2 submissions.

The module owns the cross-snapshot decision only. Callers must verify transport
credentials before constructing a proof and must load one coherent
``AuthorizationContext`` through persistence. The authorizer performs no I/O,
does not retain raw credentials, and never reloads Contact or IM binding facts.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import assert_never

from pydantic import NaiveDatetime

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.shared import (
    AccountId,
    AppId,
    ContactId,
    EndUserId,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    NormalizedEmail,
)

from .delivery import DeliveryEndpoint
from .form import (
    FormInactiveReason,
    HumanInputForm,
    InactiveFormState,
    InvalidApproverGrantError,
    InvalidSelectedActionError,
    SubmissionTransitionDecision,
)
from .grants import ApproverGrant, DeliveryEndpointRef
from .otp import ContactOTPSubject, EmailAddressOTPSubject, VerifiedEmailOTPProof
from .recipient_plan import ContactApprovalSubject, EmailAddressApprovalSubject, EndUserApprovalSubject


@dataclass(frozen=True, slots=True)
class VerifiedAccountSessionProof:
    """Current Account identity produced by a trusted session verifier."""

    account_id: AccountId


@dataclass(frozen=True, slots=True)
class VerifiedTrustedEndUserProof:
    """Current EndUser identity produced by a trusted app-token boundary."""

    end_user_id: EndUserId
    app_id: AppId


@dataclass(frozen=True, slots=True)
class VerifiedIMIdentityProof:
    """Current provider identity evidence without callback credentials or payloads."""

    integration_id: IntegrationId
    identity_id: IMIdentityId
    binding_id: IMBindingId | None
    provider: IMProvider
    provider_tenant_id: str
    provider_user_id: str

    def __post_init__(self) -> None:
        if not self.provider_tenant_id.strip() or not self.provider_user_id.strip():
            raise ValueError("verified IM provider identities must not be blank")


type VerifiedSubmissionProof = (
    VerifiedAccountSessionProof | VerifiedTrustedEndUserProof | VerifiedEmailOTPProof | VerifiedIMIdentityProof
)


@dataclass(frozen=True, slots=True)
class AccountSubmissionActor:
    """Current Dify Account that completed a submission."""

    account_id: AccountId


@dataclass(frozen=True, slots=True)
class EndUserSubmissionActor:
    """Current app-scoped EndUser that completed a submission."""

    end_user_id: EndUserId


@dataclass(frozen=True, slots=True)
class EmailAddressSubmissionActor:
    """Verified normalized Email identity that completed a submission."""

    normalized_email: NormalizedEmail


type SubmissionActor = AccountSubmissionActor | EndUserSubmissionActor | EmailAddressSubmissionActor


@dataclass(frozen=True, slots=True)
class CurrentContactAuthorizationFacts:
    """Current Contact incarnation, Email, Account, and workspace availability."""

    contact_id: ContactId
    account_id: AccountId | None
    normalized_email: NormalizedEmail | None
    account_active: bool
    workspace_available: bool


@dataclass(frozen=True, slots=True)
class CurrentEndUserAuthorizationFacts:
    """Current tenant/app ownership facts for one EndUser identity."""

    end_user_id: EndUserId
    app_id: AppId
    workspace_available: bool


@dataclass(frozen=True, slots=True)
class CurrentIMAuthorizationFacts:
    """Credential-free effective IM binding observed in the authorization snapshot."""

    integration_id: IntegrationId
    provider: IMProvider
    provider_tenant_id: str
    contact_id: ContactId
    account_id: AccountId | None
    identity_id: IMIdentityId
    binding_id: IMBindingId | None
    provider_user_id: str


@dataclass(frozen=True, slots=True)
class AuthorizationContext:
    """One immutable tenant-scoped view used without later identity reloads."""

    form: HumanInputForm
    grant: ApproverGrant
    endpoint: DeliveryEndpoint | None
    current_contact: CurrentContactAuthorizationFacts | None
    current_end_user: CurrentEndUserAuthorizationFacts | None
    current_im_binding: CurrentIMAuthorizationFacts | None

    def __post_init__(self) -> None:
        if self.grant.ref.form_ref != self.form.ref or self.grant not in self.form.grants:
            raise ValueError("authorization grant does not belong to the form snapshot")
        if self.endpoint is not None and self.endpoint.grant_ref != self.grant.ref:
            raise ValueError("authorization endpoint does not belong to the target grant")


class SubmissionAuthorizationRejection(StrEnum):
    """Stable transport-neutral reasons for denied submission authority."""

    RAW_CREDENTIAL_NOT_VERIFIED = "raw_credential_not_verified"
    FORM_ALREADY_SUBMITTED = "form_already_submitted"
    FORM_TIMED_OUT = "form_timed_out"
    FORM_STATUS_EXPIRED = "form_status_expired"
    FORM_GLOBALLY_EXPIRED = "form_globally_expired"
    GRANT_NOT_MATCHED = "grant_not_matched"
    INVALID_SELECTED_ACTION = "invalid_selected_action"
    STALE_IDENTITY = "stale_identity"
    ACCOUNT_DISABLED = "account_disabled"
    WORKSPACE_UNAVAILABLE = "workspace_unavailable"
    END_USER_UNAVAILABLE = "end_user_unavailable"
    IM_BINDING_CHANGED = "im_binding_changed"


@dataclass(frozen=True, slots=True)
class AuthorizedSubmission:
    """Current authority and local form transition prepared for atomic persistence."""

    transition: SubmissionTransitionDecision
    proof: VerifiedSubmissionProof
    actor: SubmissionActor
    endpoint_ref: DeliveryEndpointRef | None


@dataclass(frozen=True, slots=True)
class SubmissionAuthorizationDecision:
    """Exactly one authorized value or stable rejection."""

    authorized: AuthorizedSubmission | None
    rejection: SubmissionAuthorizationRejection | None

    def __post_init__(self) -> None:
        if (self.authorized is None) == (self.rejection is None):
            raise ValueError("authorization decision requires exactly one outcome")

    @classmethod
    def accept(cls, authorized: AuthorizedSubmission) -> SubmissionAuthorizationDecision:
        return cls(authorized, None)

    @classmethod
    def reject(cls, reason: SubmissionAuthorizationRejection) -> SubmissionAuthorizationDecision:
        return cls(None, reason)


class SubmissionAuthorizer:
    """Stateless cross-snapshot policy that resolves one current business actor."""

    @classmethod
    def authorize(
        cls,
        *,
        context: AuthorizationContext,
        proof: object,
        selected_action_id: str,
        now: NaiveDatetime,
    ) -> SubmissionAuthorizationDecision:
        """Authorize verified proof against one already-loaded coherent context."""

        if not isinstance(
            proof,
            VerifiedAccountSessionProof | VerifiedTrustedEndUserProof | VerifiedEmailOTPProof | VerifiedIMIdentityProof,
        ):
            return SubmissionAuthorizationDecision.reject(SubmissionAuthorizationRejection.RAW_CREDENTIAL_NOT_VERIFIED)

        state = context.form.state_at(now)
        if isinstance(state, InactiveFormState):
            return SubmissionAuthorizationDecision.reject(cls._inactive_rejection(state.reason))
        try:
            transition = context.form.decide_submission(
                grant_id=context.grant.id,
                selected_action_id=selected_action_id,
                now=now,
            )
        except InvalidApproverGrantError:
            return SubmissionAuthorizationDecision.reject(SubmissionAuthorizationRejection.GRANT_NOT_MATCHED)
        except InvalidSelectedActionError:
            return SubmissionAuthorizationDecision.reject(SubmissionAuthorizationRejection.INVALID_SELECTED_ACTION)
        if isinstance(transition, InactiveFormState):
            return SubmissionAuthorizationDecision.reject(cls._inactive_rejection(transition.reason))

        actor_or_rejection = cls._resolve_actor(context, proof)
        if isinstance(actor_or_rejection, SubmissionAuthorizationRejection):
            return SubmissionAuthorizationDecision.reject(actor_or_rejection)
        return SubmissionAuthorizationDecision.accept(
            AuthorizedSubmission(
                transition=transition,
                proof=proof,
                actor=actor_or_rejection,
                endpoint_ref=context.endpoint.ref if context.endpoint is not None else None,
            )
        )

    @staticmethod
    def _inactive_rejection(reason: FormInactiveReason) -> SubmissionAuthorizationRejection:
        match reason:
            case FormInactiveReason.SUBMITTED:
                return SubmissionAuthorizationRejection.FORM_ALREADY_SUBMITTED
            case FormInactiveReason.TIMED_OUT:
                return SubmissionAuthorizationRejection.FORM_TIMED_OUT
            case FormInactiveReason.STATUS_EXPIRED:
                return SubmissionAuthorizationRejection.FORM_STATUS_EXPIRED
            case FormInactiveReason.GLOBALLY_EXPIRED:
                return SubmissionAuthorizationRejection.FORM_GLOBALLY_EXPIRED
        assert_never(reason)

    @classmethod
    def _resolve_actor(
        cls,
        context: AuthorizationContext,
        proof: VerifiedSubmissionProof,
    ) -> SubmissionActor | SubmissionAuthorizationRejection:
        match proof:
            case VerifiedAccountSessionProof():
                return cls._authorize_account(context, proof)
            case VerifiedTrustedEndUserProof():
                return cls._authorize_end_user(context, proof)
            case VerifiedEmailOTPProof():
                return cls._authorize_email(context, proof)
            case VerifiedIMIdentityProof():
                return cls._authorize_im(context, proof)
        assert_never(proof)

    @classmethod
    def _authorize_account(
        cls,
        context: AuthorizationContext,
        proof: VerifiedAccountSessionProof,
    ) -> SubmissionActor | SubmissionAuthorizationRejection:
        if not isinstance(context.grant.subject, ContactApprovalSubject):
            return SubmissionAuthorizationRejection.GRANT_NOT_MATCHED
        current = cls._validate_current_contact(context, context.grant.subject.contact_id)
        if isinstance(current, SubmissionAuthorizationRejection):
            return current
        if current.account_id != proof.account_id:
            return SubmissionAuthorizationRejection.GRANT_NOT_MATCHED
        return AccountSubmissionActor(proof.account_id)

    @staticmethod
    def _authorize_end_user(
        context: AuthorizationContext,
        proof: VerifiedTrustedEndUserProof,
    ) -> SubmissionActor | SubmissionAuthorizationRejection:
        if not isinstance(context.grant.subject, EndUserApprovalSubject):
            return SubmissionAuthorizationRejection.GRANT_NOT_MATCHED
        current = context.current_end_user
        if (
            current is None
            or current.end_user_id != context.grant.subject.end_user_id
            or current.end_user_id != proof.end_user_id
            or current.app_id != context.form.app_id
            or current.app_id != proof.app_id
        ):
            return SubmissionAuthorizationRejection.END_USER_UNAVAILABLE
        if not current.workspace_available:
            return SubmissionAuthorizationRejection.WORKSPACE_UNAVAILABLE
        return EndUserSubmissionActor(current.end_user_id)

    @classmethod
    def _authorize_email(
        cls,
        context: AuthorizationContext,
        proof: VerifiedEmailOTPProof,
    ) -> SubmissionActor | SubmissionAuthorizationRejection:
        if proof.challenge_ref.grant_ref != context.grant.ref:
            return SubmissionAuthorizationRejection.GRANT_NOT_MATCHED
        subject = context.grant.subject
        if isinstance(subject, EmailAddressApprovalSubject):
            if (
                not isinstance(proof.subject, EmailAddressOTPSubject)
                or proof.subject.normalized_email != subject.normalized_email
                or proof.normalized_email != subject.normalized_email
            ):
                return SubmissionAuthorizationRejection.GRANT_NOT_MATCHED
            return EmailAddressSubmissionActor(subject.normalized_email)
        if not isinstance(subject, ContactApprovalSubject) or not isinstance(proof.subject, ContactOTPSubject):
            return SubmissionAuthorizationRejection.GRANT_NOT_MATCHED
        if proof.subject.contact_id != subject.contact_id:
            return SubmissionAuthorizationRejection.GRANT_NOT_MATCHED
        current = cls._validate_current_contact(context, subject.contact_id)
        if isinstance(current, SubmissionAuthorizationRejection):
            return current
        if current.normalized_email is None or current.normalized_email != proof.normalized_email:
            return SubmissionAuthorizationRejection.STALE_IDENTITY
        if current.account_id is not None:
            return AccountSubmissionActor(current.account_id)
        return EmailAddressSubmissionActor(proof.normalized_email)

    @classmethod
    def _authorize_im(
        cls,
        context: AuthorizationContext,
        proof: VerifiedIMIdentityProof,
    ) -> SubmissionActor | SubmissionAuthorizationRejection:
        if not isinstance(context.grant.subject, ContactApprovalSubject):
            return SubmissionAuthorizationRejection.GRANT_NOT_MATCHED
        current_contact = cls._validate_current_contact(context, context.grant.subject.contact_id)
        if isinstance(current_contact, SubmissionAuthorizationRejection):
            return current_contact
        if current_contact.account_id is None:
            return SubmissionAuthorizationRejection.STALE_IDENTITY
        current_im = context.current_im_binding
        if current_im is None:
            return SubmissionAuthorizationRejection.IM_BINDING_CHANGED
        if (
            current_im.contact_id != context.grant.subject.contact_id
            or current_im.account_id != current_contact.account_id
            or current_im.integration_id != proof.integration_id
            or current_im.identity_id != proof.identity_id
            or current_im.binding_id != proof.binding_id
            or current_im.provider is not proof.provider
            or current_im.provider_tenant_id != proof.provider_tenant_id
            or current_im.provider_user_id != proof.provider_user_id
        ):
            return SubmissionAuthorizationRejection.IM_BINDING_CHANGED
        return AccountSubmissionActor(current_contact.account_id)

    @staticmethod
    def _validate_current_contact(
        context: AuthorizationContext,
        contact_id: ContactId,
    ) -> CurrentContactAuthorizationFacts | SubmissionAuthorizationRejection:
        current = context.current_contact
        if current is None or current.contact_id != contact_id:
            return SubmissionAuthorizationRejection.STALE_IDENTITY
        if current.account_id is not None and not current.account_active:
            return SubmissionAuthorizationRejection.ACCOUNT_DISABLED
        if not current.workspace_available:
            return SubmissionAuthorizationRejection.WORKSPACE_UNAVAILABLE
        return current


__all__ = [
    "AccountSubmissionActor",
    "AuthorizationContext",
    "AuthorizedSubmission",
    "CurrentContactAuthorizationFacts",
    "CurrentEndUserAuthorizationFacts",
    "CurrentIMAuthorizationFacts",
    "EmailAddressSubmissionActor",
    "EndUserSubmissionActor",
    "SubmissionActor",
    "SubmissionAuthorizationDecision",
    "SubmissionAuthorizationRejection",
    "SubmissionAuthorizer",
    "VerifiedAccountSessionProof",
    "VerifiedIMIdentityProof",
    "VerifiedSubmissionProof",
    "VerifiedTrustedEndUserProof",
]
