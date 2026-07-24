"""Current-state submission authorization over existing proof persistence.

OTP challenge rows, proof type enums, submissions, and audit rows already exist.
This context defines only transient proof inputs, authorization decisions, and
the policy boundary that must revalidate mutable identity state. Public form
definition reads are token-gated elsewhere and never create submit authority.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Protocol, Self

from core.human_input_v2.entities import IMProvider

from domain_model.approval_runtime.model import FormInstance, SubmissionActor
from domain_model.shared.identifiers import (
    AccountId,
    ApproverGrantKey,
    EmailChallengeId,
    EndUserId,
)
from domain_model.shared.value_objects import EmailAddress


@dataclass(frozen=True, slots=True)
class AccountSessionProof:
    """Current Dify login session for an Organization Contact."""

    account_id: AccountId
    session_id: str


@dataclass(frozen=True, slots=True)
class EmailOTPProof:
    """Verified challenge reference presented with public form submission."""

    challenge_id: EmailChallengeId
    email: EmailAddress


@dataclass(frozen=True, slots=True)
class IMIdentityProof:
    """Current provider identity received from an IM interaction callback."""

    provider: IMProvider
    provider_tenant_id: str
    provider_user_id: str


@dataclass(frozen=True, slots=True)
class TrustedEndUserProof:
    """Request-scoped end-user explicitly supplied by Service API."""

    app_id: str
    end_user_id: EndUserId


type IdentityProof = (
    AccountSessionProof | EmailOTPProof | IMIdentityProof | TrustedEndUserProof
)


class AccessDecisionReason(StrEnum):
    """Domain reasons not already represented by the stored proof type."""

    ALLOWED = "allowed"
    FORM_NOT_WAITING = "form_not_waiting"
    APPROVER_GRANT_NOT_ALLOWED = "approver_grant_not_allowed"
    CONTACT_UNAVAILABLE = "contact_unavailable"
    MEMBERSHIP_UNAVAILABLE = "membership_unavailable"
    ACCOUNT_UNAVAILABLE = "account_unavailable"
    CONTACT_IDENTITY_CHANGED = "contact_identity_changed"
    IM_BINDING_CHANGED = "im_binding_changed"
    EMAIL_PROOF_REQUIRED = "email_proof_required"
    INVALID_PROOF = "invalid_proof"


@dataclass(frozen=True, slots=True)
class AccessDecision:
    """Transient authorization result later persisted as one append-only audit event."""

    allowed: bool
    reason: AccessDecisionReason
    evaluated_at: datetime
    approver_grant_key: ApproverGrantKey | None = None
    actor: SubmissionActor | None = None

    @classmethod
    def allow(
        cls,
        *,
        evaluated_at: datetime,
        approver_grant_key: ApproverGrantKey,
        actor: SubmissionActor,
    ) -> Self:
        """Create an allowed decision linked to one grant and resolved actor."""

        return cls(
            allowed=True,
            reason=AccessDecisionReason.ALLOWED,
            evaluated_at=evaluated_at,
            approver_grant_key=approver_grant_key,
            actor=actor,
        )

    @classmethod
    def deny(
        cls,
        *,
        evaluated_at: datetime,
        reason: AccessDecisionReason,
    ) -> Self:
        """Create a denied decision with a stable audit reason."""

        if reason is AccessDecisionReason.ALLOWED:
            raise ValueError("denied decision requires a deny reason")
        return cls(
            allowed=False,
            reason=reason,
            evaluated_at=evaluated_at,
        )


@dataclass(frozen=True, slots=True)
class ResolvedAuthorizationContext:
    """Current grant match and business actor derived from transient proof."""

    approver_grant_key: ApproverGrantKey
    actor: SubmissionActor


class CurrentIdentityStatePort(Protocol):
    """Current-state queries required to revalidate a frozen approver grant."""

    def resolve_proof(
        self,
        *,
        form_instance: FormInstance,
        proof: IdentityProof,
    ) -> ResolvedAuthorizationContext | None:
        """Resolve proof to a current grant match and submission actor."""

        ...


class ApprovalAccessPolicy(Protocol):
    """Submit-time policy over form state, current identity state, and proof."""

    def authorize_submission(
        self,
        *,
        form_instance: FormInstance,
        proof: IdentityProof,
        current_identity_state: CurrentIdentityStatePort,
    ) -> AccessDecision:
        """Evaluate every mutable authorization check at submission time."""

        ...
