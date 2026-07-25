"""Transaction-oriented ports for current authorization and first-success commit.

The transaction object keeps one coherent authorization context alive through
the winning write set. Generic CRUD is intentionally absent; persistence owns
the Form lock, rejection audit append, and atomic authorized commit shape.
"""

from __future__ import annotations

from contextlib import AbstractContextManager
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from core.human_input_v2.shared import (
    ApproverGrantId,
    AuditEventId,
    DeliveryEndpointId,
    SubmissionId,
    UtcTimestamp,
)

from .frozen_values import FrozenJSONObject
from .grants import FormRef
from .submission_authorization import AuthorizationContext, AuthorizedSubmission
from .submission_records import FormAuthorizationAuditEvent, FormSubmission


@dataclass(frozen=True, slots=True)
class SubmissionAttemptScope:
    """Complete logical owner chain selected before the transaction begins."""

    form_ref: FormRef
    approver_grant_id: ApproverGrantId
    endpoint_id: DeliveryEndpointId | None


@dataclass(frozen=True, slots=True)
class AuthorizedSubmissionCommit:
    """Caller-owned identities and structured values for one authorized write set."""

    submission_id: SubmissionId
    authorization_audit_event_id: AuditEventId
    authorized: AuthorizedSubmission
    input_snapshot: FrozenJSONObject
    canonical_values: FrozenJSONObject

    def to_submission(
        self,
        *,
        form_ref: FormRef,
        approver_grant_id: ApproverGrantId,
        endpoint_id: DeliveryEndpointId | None,
        submitted_at: UtcTimestamp,
    ) -> FormSubmission:
        """Build the immutable record value after owner-scope validation."""

        return FormSubmission(
            id=self.submission_id,
            form_ref=form_ref,
            approver_grant_id=approver_grant_id,
            endpoint_id=endpoint_id,
            authorization_audit_event_id=self.authorization_audit_event_id,
            actor=self.authorized.actor,
            selected_action_id=self.authorized.transition.selected_action_id,
            input_snapshot=self.input_snapshot,
            canonical_values=self.canonical_values,
            submitted_at=submitted_at,
            created_at=submitted_at,
            updated_at=submitted_at,
        )


class SubmissionCommitStatus(StrEnum):
    """Stable first-success persistence outcome."""

    COMMITTED = "committed"
    ALREADY_COMPLETED = "already_completed"


@dataclass(frozen=True, slots=True)
class SubmissionCommitResult:
    """Committed winning submission or stable loser result."""

    status: SubmissionCommitStatus
    submission: FormSubmission | None


class SubmissionTransaction(Protocol):
    """One session-bound authorization and commit transaction."""

    def load_authorization_context(self, *, proof: object) -> AuthorizationContext: ...

    def append_rejection_audit(self, event: FormAuthorizationAuditEvent) -> None: ...

    def commit_authorized_submission_once(self, commit: AuthorizedSubmissionCommit) -> SubmissionCommitResult: ...


class SubmissionRepository(Protocol):
    """Factory for one short transaction owning the complete submission use case."""

    def transaction(self, scope: SubmissionAttemptScope) -> AbstractContextManager[SubmissionTransaction]: ...


__all__ = [
    "AuthorizedSubmissionCommit",
    "SubmissionAttemptScope",
    "SubmissionCommitResult",
    "SubmissionCommitStatus",
    "SubmissionRepository",
    "SubmissionTransaction",
]
