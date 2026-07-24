"""Runtime aggregate behavior that is not already defined by persistence stubs.

Approver grants, endpoints, attempts, OTP challenges, submissions, and audit
records already have persistence definitions. This context does not repeat
their fields; FormInstance keeps only aggregate-level references and enforces
task lifecycle invariants.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Self

from core.workflow.nodes.human_input.enums import HumanInputFormStatus

from domain_model.configuration.model import FormConfiguration
from domain_model.shared.identifiers import (
    AccountId,
    ApproverGrantKey,
    EndUserId,
    FormInstanceId,
    WorkspaceId,
)
from domain_model.shared.value_objects import EmailAddress


@dataclass(frozen=True, slots=True)
class AccountActor:
    """Account-backed Organization Contact that completed a submission."""

    account_id: AccountId


@dataclass(frozen=True, slots=True)
class EndUserActor:
    """Application end user that completed a trusted Service API submission."""

    end_user_id: EndUserId


@dataclass(frozen=True, slots=True)
class EmailAddressActor:
    """Verified mailbox that completed an email-proof submission."""

    normalized_email: EmailAddress


type SubmissionActor = AccountActor | EndUserActor | EmailAddressActor


@dataclass(frozen=True, slots=True)
class SubmissionCommand:
    """Previously validated and authorized completion command.

    Existing form validation remains responsible for the submitted payload.
    Access control remains responsible for current identity revalidation. This
    command only carries the facts needed for the FormInstance transition.
    """

    approver_grant_key: ApproverGrantKey
    actor: SubmissionActor
    authorization_audit_event_id: str
    action_id: str
    submitted_data_json: str
    submitted_at: datetime


class FormInstanceError(RuntimeError):
    """Base class for invalid FormInstance lifecycle transitions."""


class AlreadySubmittedError(FormInstanceError):
    """Raised when a caller loses the first-success-wins race."""


class FormInstanceUnavailableError(FormInstanceError):
    """Raised when timeout or global expiration prevents submission."""


class UnauthorizedApproverGrantError(FormInstanceError):
    """Raised when a command does not reference a resolved approver grant."""


@dataclass(slots=True)
class FormInstance:
    """Aggregate root for one runtime Human Input task.

    Lifecycle: created by ``FormInstanceFactory`` with exactly one immutable
    ``FormConfiguration`` and a frozen set of resolved approver-grant keys, remains
    WAITING, then transitions exactly once to SUBMITTED, TIMEOUT, or EXPIRED.
    Detailed grant, endpoint, challenge, and submission records stay in
    their existing persistence models.

    Persistence must conditionally transition the stored form from WAITING and
    insert the unique submission in the same transaction. The submission unique
    constraint provides the database-level first-success-wins guard.
    """

    instance_id: FormInstanceId
    workspace_id: WorkspaceId
    configuration: FormConfiguration
    allowed_approver_grant_keys: frozenset[ApproverGrantKey]
    created_at: datetime
    expires_at: datetime
    status: HumanInputFormStatus = HumanInputFormStatus.WAITING
    winning_submission_id: str | None = None

    @classmethod
    def _create(
        cls,
        *,
        instance_id: FormInstanceId,
        workspace_id: WorkspaceId,
        configuration: FormConfiguration,
        allowed_approver_grant_keys: frozenset[ApproverGrantKey],
        created_at: datetime,
    ) -> Self:
        """Build a waitable task after the factory completes recipient resolution."""

        if created_at.tzinfo is None:
            raise ValueError("form instance timestamp must be timezone-aware")
        if not allowed_approver_grant_keys:
            raise ValueError("form instance requires at least one approver grant")
        return cls(
            instance_id=instance_id,
            workspace_id=workspace_id,
            configuration=configuration,
            allowed_approver_grant_keys=allowed_approver_grant_keys,
            created_at=created_at,
            expires_at=configuration.expiration_time(created_at),
        )

    def accept_submission(self, command: SubmissionCommand) -> None:
        """Apply the in-memory first-success-wins transition.

        The application service must insert the existing submission model and
        update the persisted form status in the same transaction. The generated
        submission identifier is then recorded with `record_committed_submission`.
        """

        if self.status is HumanInputFormStatus.SUBMITTED:
            raise AlreadySubmittedError("This task has already been completed.")
        if self.status is not HumanInputFormStatus.WAITING:
            raise FormInstanceUnavailableError(f"form instance is {self.status.value}")
        if command.submitted_at >= self.expires_at:
            raise FormInstanceUnavailableError("form instance reached its node timeout")
        if command.approver_grant_key not in self.allowed_approver_grant_keys:
            raise UnauthorizedApproverGrantError(
                "submission does not exercise an allowed approver grant"
            )
        if not self.configuration.has_action(command.action_id):
            raise ValueError(
                "submission action is not defined by the form configuration"
            )
        if not command.authorization_audit_event_id:
            raise ValueError(
                "submission requires a successful authorization audit event"
            )
        if not command.submitted_data_json:
            raise ValueError("submission requires previously validated form data")
        self.status = HumanInputFormStatus.SUBMITTED

    def record_committed_submission(self, submission_id: str) -> None:
        """Attach the existing persistence submission after its transaction commits."""

        if self.status is not HumanInputFormStatus.SUBMITTED:
            raise FormInstanceError("submission reference requires submitted state")
        if not submission_id:
            raise ValueError("submission_id must not be empty")
        if self.winning_submission_id is not None:
            raise AlreadySubmittedError("winning submission is already recorded")
        self.winning_submission_id = submission_id

    def mark_timed_out(self, *, timed_out_at: datetime) -> None:
        """Apply the existing node-local TIMEOUT terminal status."""

        if self.status is not HumanInputFormStatus.WAITING:
            raise FormInstanceError("only a waiting form instance can time out")
        if timed_out_at < self.expires_at:
            raise ValueError("node timeout cannot occur before the captured deadline")
        self.status = HumanInputFormStatus.TIMEOUT

    def mark_expired(self) -> None:
        """Apply the existing workflow/global EXPIRED terminal status."""

        if self.status is not HumanInputFormStatus.WAITING:
            raise FormInstanceError("only a waiting form instance can expire")
        self.status = HumanInputFormStatus.EXPIRED
