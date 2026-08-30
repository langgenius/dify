"""Historical approver grants and form-scoped logical references.

Grants capture candidate authority at form creation. They are intentionally not
current authorization proofs: later submission code must revalidate the current
identity behind the frozen subject.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import assert_never

from pydantic import NaiveDatetime

from core.human_input_v2.shared import (
    ApproverGrantId,
    DeliveryEndpointId,
    FormId,
    OTPChallengeId,
    TenantId,
)

from .recipient_plan import (
    ApprovalSubject,
    CanonicalSubjectKey,
    ContactApprovalSubject,
    EmailAddressApprovalSubject,
    EndUserApprovalSubject,
    MatchedRecipientSource,
    ResolvedApprover,
    SubjectSnapshot,
)


def _subject_key(subject: ApprovalSubject) -> CanonicalSubjectKey:
    match subject:
        case ContactApprovalSubject(contact_id=contact_id):
            return CanonicalSubjectKey.for_contact(contact_id)
        case EndUserApprovalSubject(end_user_id=end_user_id):
            return CanonicalSubjectKey.for_end_user(end_user_id)
        case EmailAddressApprovalSubject(normalized_email=normalized_email):
            return CanonicalSubjectKey.for_email(normalized_email)
        case _:
            assert_never(subject)


@dataclass(frozen=True, slots=True)
class FormRef:
    """Workspace-owned root reference; authorization still requires scoped queries."""

    tenant_id: TenantId
    form_id: FormId

    def grant(self, grant_id: ApproverGrantId) -> ApproverGrantRef:
        return ApproverGrantRef(self, grant_id)


@dataclass(frozen=True, slots=True)
class ApproverGrantRef:
    """Grant reference carrying its complete form owner chain."""

    form_ref: FormRef
    grant_id: ApproverGrantId

    def endpoint(self, endpoint_id: DeliveryEndpointId) -> DeliveryEndpointRef:
        return DeliveryEndpointRef(self, endpoint_id)

    def challenge(self, challenge_id: OTPChallengeId) -> OTPChallengeRef:
        return OTPChallengeRef(self, challenge_id)


@dataclass(frozen=True, slots=True)
class OTPChallengeRef:
    """OTP proof-session reference carrying its complete grant owner chain."""

    grant_ref: ApproverGrantRef
    challenge_id: OTPChallengeId

    @property
    def form_ref(self) -> FormRef:
        return self.grant_ref.form_ref


@dataclass(frozen=True, slots=True)
class DeliveryEndpointRef:
    """Endpoint reference carrying grant, form, and workspace ownership."""

    grant_ref: ApproverGrantRef
    endpoint_id: DeliveryEndpointId

    @property
    def form_ref(self) -> FormRef:
        return self.grant_ref.form_ref


@dataclass(frozen=True, slots=True)
class ApproverGrant:
    """Frozen candidate approver with historical matched-source facts."""

    ref: ApproverGrantRef
    subject: ApprovalSubject
    subject_key: CanonicalSubjectKey
    matched_sources: tuple[MatchedRecipientSource, ...]
    subject_snapshot: SubjectSnapshot
    created_at: NaiveDatetime
    updated_at: NaiveDatetime

    def __post_init__(self) -> None:
        if not isinstance(self.matched_sources, tuple):
            raise TypeError("matched sources must be an immutable tuple")
        if self.subject_key != _subject_key(self.subject):
            raise ValueError("approver grant subject key does not match its subject")

    @property
    def id(self) -> ApproverGrantId:
        return self.ref.grant_id

    @classmethod
    def from_resolved_approver(
        cls,
        *,
        grant_id: ApproverGrantId,
        form_ref: FormRef,
        approver: ResolvedApprover,
        now: NaiveDatetime,
    ) -> ApproverGrant:
        return cls(
            ref=form_ref.grant(grant_id),
            subject=approver.subject,
            subject_key=approver.subject_key,
            matched_sources=approver.matched_sources,
            subject_snapshot=approver.subject_snapshot,
            created_at=now,
            updated_at=now,
        )
