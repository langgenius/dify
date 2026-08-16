"""Application orchestration for authorized Human Input v2 submissions.

The handler keeps authorization and persistence behind their deep domain and
repository interfaces. Its only application-layer policy is the post-commit
boundary: a winning runtime submission is committed before workflow resume is
requested, and a known enqueue failure never changes the persisted outcome.
Retryable transaction conflicts restart the complete use case with a fresh
snapshot; partial authorization or persistence steps are never retried alone.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from pydantic import JsonValue, NaiveDatetime

from core.human_input_v2.approval import (
    AuthorizedSubmissionCommit,
    FormAuthorizationAuditEvent,
    FormAuthorizationAuditEventType,
    FormSubmission,
    HumanInputForm,
    RetryableSubmissionPersistenceError,
    SubmissionAttemptScope,
    SubmissionAuthorizationRejection,
    SubmissionAuthorizer,
    SubmissionCommitStatus,
    SubmissionRepository,
)
from core.human_input_v2.entities import HumanInputV2FormKind
from core.human_input_v2.shared import AuditEventId, FormId, SubmissionId, TenantId

logger = logging.getLogger(__name__)

_MAX_SUBMISSION_TRANSACTION_RETRIES = 1


@dataclass(frozen=True, slots=True)
class WorkflowResumeIdentity:
    """Stable workflow owner identity used by an idempotent resume adapter."""

    tenant_id: TenantId
    form_id: FormId
    workflow_pause_id: str
    node_execution_id: str

    def __post_init__(self) -> None:
        if not self.workflow_pause_id.strip() or not self.node_execution_id.strip():
            raise ValueError("workflow resume identity values must not be blank")


class WorkflowResumeEnqueueError(RuntimeError):
    """A resume adapter could not accept an idempotent enqueue request."""


class WorkflowResumePort(Protocol):
    """Enqueue workflow resume once for a stable form/workflow identity."""

    def enqueue_once(self, identity: WorkflowResumeIdentity) -> None: ...


@dataclass(frozen=True, slots=True)
class SubmitFormCommand:
    """Verified proof and caller-owned record identities for one submission attempt."""

    scope: SubmissionAttemptScope
    proof: object
    selected_action_id: str
    input_snapshot: Mapping[str, JsonValue]
    canonical_values: Mapping[str, JsonValue]
    submission_id: SubmissionId
    authorization_audit_event_id: AuditEventId
    rejection_audit_event_id: AuditEventId
    resume_identity: WorkflowResumeIdentity | None
    now: NaiveDatetime


class SubmitFormResultStatus(StrEnum):
    """Stable application outcomes independent of transport status codes."""

    SUBMITTED = "submitted"
    ALREADY_COMPLETED = "already_completed"
    REJECTED = "rejected"


@dataclass(frozen=True, slots=True)
class SubmitFormResult:
    """Submission outcome plus post-commit resume delivery state."""

    status: SubmitFormResultStatus
    submission: FormSubmission | None
    rejection: SubmissionAuthorizationRejection | None
    resume_enqueued: bool


class SubmitHumanInputFormHandler:
    """Authorize and persist once, retrying only complete transient transactions."""

    def __init__(self, repository: SubmissionRepository, resume_port: WorkflowResumePort) -> None:
        self._repository = repository
        self._resume_port = resume_port

    def handle(self, command: SubmitFormCommand) -> SubmitFormResult:
        """Return a stable outcome while preserving commit-before-enqueue ordering."""

        identity = self._prevalidate_resume_identity(command)
        transaction_result = self._handle_transaction_with_retry(command, identity)
        if transaction_result.status is not SubmitFormResultStatus.SUBMITTED:
            return transaction_result

        try:
            self._resume_port.enqueue_once(identity)
        except WorkflowResumeEnqueueError:
            logger.exception(
                "Failed to enqueue Human Input v2 workflow resume after submission commit: "
                "tenant_id=%s form_id=%s workflow_pause_id=%s node_execution_id=%s",
                identity.tenant_id,
                identity.form_id,
                identity.workflow_pause_id,
                identity.node_execution_id,
            )
            return SubmitFormResult(
                SubmitFormResultStatus.SUBMITTED,
                transaction_result.submission,
                None,
                False,
            )
        return SubmitFormResult(
            SubmitFormResultStatus.SUBMITTED,
            transaction_result.submission,
            None,
            True,
        )

    def _handle_transaction_with_retry(
        self,
        command: SubmitFormCommand,
        identity: WorkflowResumeIdentity,
    ) -> SubmitFormResult:
        for retry_count in range(_MAX_SUBMISSION_TRANSACTION_RETRIES + 1):
            try:
                return self._handle_transaction_once(command, identity)
            except RetryableSubmissionPersistenceError:
                if retry_count == _MAX_SUBMISSION_TRANSACTION_RETRIES:
                    raise
                logger.warning(
                    "Retrying Human Input v2 submission after transaction serialization failure: "
                    "tenant_id=%s form_id=%s retry_count=%s",
                    identity.tenant_id,
                    identity.form_id,
                    retry_count + 1,
                )
        raise AssertionError("submission transaction retry loop must return or raise")

    def _handle_transaction_once(
        self,
        command: SubmitFormCommand,
        identity: WorkflowResumeIdentity,
    ) -> SubmitFormResult:
        """Run one complete load, authorization, Form decision, and commit attempt."""

        with self._repository.transaction(command.scope) as transaction:
            context = transaction.load_authorization_context(proof=command.proof)
            self._validate_runtime_form_identity(context.form, identity)
            decision = SubmissionAuthorizer.authorize(
                context=context,
                proof=command.proof,
                selected_action_id=command.selected_action_id,
                now=command.now,
            )
            if decision.rejection is not None:
                rejection = decision.rejection
                if rejection is SubmissionAuthorizationRejection.FORM_ALREADY_SUBMITTED:
                    return SubmitFormResult(SubmitFormResultStatus.ALREADY_COMPLETED, None, None, False)
                transaction.append_rejection_audit(
                    FormAuthorizationAuditEvent(
                        id=command.rejection_audit_event_id,
                        event_type=FormAuthorizationAuditEventType.SUBMISSION_REJECTED,
                        form_ref=command.scope.form_ref,
                        approver_grant_id=command.scope.approver_grant_id,
                        endpoint_id=command.scope.endpoint_id,
                        channel=context.endpoint.channel if context.endpoint is not None else None,
                        reason_code=rejection,
                        reason_message=None,
                        authorization_proof=None,
                        payload={"selected_action_id": command.selected_action_id},
                        occurred_at=command.now,
                        created_at=command.now,
                        updated_at=command.now,
                    )
                )
                return SubmitFormResult(SubmitFormResultStatus.REJECTED, None, rejection, False)

            authorized = decision.authorized
            assert authorized is not None
            commit_result = transaction.commit_authorized_submission_once(
                AuthorizedSubmissionCommit(
                    submission_id=command.submission_id,
                    authorization_audit_event_id=command.authorization_audit_event_id,
                    authorized=authorized,
                    input_snapshot=command.input_snapshot,
                    canonical_values=command.canonical_values,
                )
            )
            if commit_result.status is SubmissionCommitStatus.ALREADY_COMPLETED:
                return SubmitFormResult(SubmitFormResultStatus.ALREADY_COMPLETED, None, None, False)
            return SubmitFormResult(SubmitFormResultStatus.SUBMITTED, commit_result.submission, None, False)

    @staticmethod
    def _prevalidate_resume_identity(command: SubmitFormCommand) -> WorkflowResumeIdentity:
        identity = command.resume_identity
        if identity is None:
            raise ValueError("runtime resume identity is required before submission persistence")
        if identity.tenant_id != command.scope.form_ref.tenant_id or identity.form_id != command.scope.form_ref.form_id:
            raise ValueError("runtime resume identity does not match the submission form owner")
        return identity

    @staticmethod
    def _validate_runtime_form_identity(form: HumanInputForm, identity: WorkflowResumeIdentity) -> None:
        if form.kind is not HumanInputV2FormKind.RUNTIME:
            raise ValueError("submission handler accepts runtime forms only")
        if form.workflow_pause_id != identity.workflow_pause_id or form.node_execution_id != identity.node_execution_id:
            raise ValueError("runtime resume identity does not match the loaded form")


__all__ = [
    "SubmitFormCommand",
    "SubmitFormResult",
    "SubmitFormResultStatus",
    "SubmitHumanInputFormHandler",
    "WorkflowResumeEnqueueError",
    "WorkflowResumeIdentity",
    "WorkflowResumePort",
]
