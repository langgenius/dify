"""Post-commit ordering, failure, logging, and resume-idempotency contracts."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta

import pytest

from core.human_input import ButtonStyle
from core.human_input_v2 import MarkdownText, ResolvedForm, ResolvedFormAction
from core.human_input_v2.approval import (
    ApproverGrant,
    AuthorizationContext,
    AuthorizedSubmissionCommit,
    CanonicalSubjectKey,
    ContactApprovalSubject,
    CurrentContactAuthorizationFacts,
    FormAuthorizationAuditEvent,
    FormRef,
    HumanInputForm,
    RetryableSubmissionPersistenceError,
    SubjectSnapshot,
    SubmissionAttemptScope,
    SubmissionCommitResult,
    SubmissionCommitStatus,
    VerifiedAccountSessionProof,
)
from core.human_input_v2.entities import HumanInputV2FormKind, HumanInputV2FormStatus
from core.human_input_v2.shared import (
    AccountId,
    AppId,
    ApproverGrantId,
    AuditEventId,
    ContactId,
    FormId,
    SubmissionId,
    TenantId,
)
from services.human_input_v2.submission import (
    SubmitFormCommand,
    SubmitFormResultStatus,
    SubmitHumanInputFormHandler,
    WorkflowResumeEnqueueError,
    WorkflowResumeIdentity,
)

_NOW = datetime(2026, 7, 25, 8)
_FORM_REF = FormRef(TenantId("workspace-1"), FormId("form-1"))
_GRANT_ID = ApproverGrantId("grant-1")
_ACCOUNT_ID = AccountId("account-1")
_CONTACT_ID = ContactId("contact-1")
_SCOPE = SubmissionAttemptScope(_FORM_REF, _GRANT_ID, None)
_RESUME_IDENTITY = WorkflowResumeIdentity(
    tenant_id=_FORM_REF.tenant_id,
    form_id=_FORM_REF.form_id,
    workflow_pause_id="pause-1",
    node_execution_id="node-execution-1",
)


def _context(
    *,
    status: HumanInputV2FormStatus = HumanInputV2FormStatus.WAITING,
    kind: HumanInputV2FormKind = HumanInputV2FormKind.RUNTIME,
    workflow_pause_id: str | None = "pause-1",
    node_execution_id: str | None = "node-execution-1",
) -> AuthorizationContext:
    subject = ContactApprovalSubject(_CONTACT_ID)
    grant = ApproverGrant(
        ref=_FORM_REF.grant(_GRANT_ID),
        subject=subject,
        subject_key=CanonicalSubjectKey.for_contact(_CONTACT_ID),
        matched_sources=(),
        subject_snapshot=SubjectSnapshot("Reviewer", "reviewer@example.com"),
        created_at=_NOW,
        updated_at=_NOW,
    )
    form = HumanInputForm(
        ref=_FORM_REF,
        app_id=AppId("app-1"),
        resolved_form=ResolvedForm(
            title="Review",
            blocks=(MarkdownText("Approve"),),
            user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
            legacy_form_content="Approve",
        ),
        display_in_ui=True,
        node_timeout_at=_NOW + timedelta(hours=1),
        global_expires_at=_NOW + timedelta(hours=2),
        kind=kind,
        status=status,
        workflow_pause_id=workflow_pause_id,
        node_execution_id=node_execution_id,
        grants=(grant,),
        created_at=_NOW,
        updated_at=_NOW,
    )
    return AuthorizationContext(
        form=form,
        grant=grant,
        endpoint=None,
        current_contact=CurrentContactAuthorizationFacts(
            contact_id=_CONTACT_ID,
            account_id=_ACCOUNT_ID,
            normalized_email=None,
            account_active=True,
            workspace_available=True,
        ),
        current_end_user=None,
        current_im_binding=None,
    )


def _command(
    *,
    proof: object | None = None,
    resume_identity: WorkflowResumeIdentity | None = _RESUME_IDENTITY,
) -> SubmitFormCommand:
    return SubmitFormCommand(
        scope=_SCOPE,
        proof=proof if proof is not None else VerifiedAccountSessionProof(_ACCOUNT_ID),
        selected_action_id="approve",
        input_snapshot={"comment": "approved"},
        canonical_values={"comment": "approved"},
        submission_id=SubmissionId("submission-1"),
        authorization_audit_event_id=AuditEventId("audit-authorized"),
        rejection_audit_event_id=AuditEventId("audit-rejected"),
        resume_identity=resume_identity,
        now=_NOW,
    )


class _RecordingTransaction:
    def __init__(
        self,
        events: list[str],
        *,
        fail_persistence: bool = False,
        commit_status: SubmissionCommitStatus = SubmissionCommitStatus.COMMITTED,
        context_status: HumanInputV2FormStatus = HumanInputV2FormStatus.WAITING,
        context_kind: HumanInputV2FormKind = HumanInputV2FormKind.RUNTIME,
    ) -> None:
        self.events = events
        self.context = _context(
            status=context_status,
            kind=context_kind,
            workflow_pause_id=None if context_kind is HumanInputV2FormKind.DELIVERY_TEST else "pause-1",
            node_execution_id=None if context_kind is HumanInputV2FormKind.DELIVERY_TEST else "node-execution-1",
        )
        self.fail_persistence = fail_persistence
        self.commit_status = commit_status

    def load_authorization_context(self, *, proof: object) -> AuthorizationContext:
        del proof
        self.events.append("context_loaded")
        return self.context

    def append_rejection_audit(self, event: FormAuthorizationAuditEvent) -> None:
        self.events.append(f"rejection_audit:{event.reason_code}")

    def commit_authorized_submission_once(self, commit: AuthorizedSubmissionCommit) -> SubmissionCommitResult:
        self.events.append("persistence_write")
        if self.fail_persistence:
            raise RuntimeError("persistence failed")
        if self.commit_status is SubmissionCommitStatus.ALREADY_COMPLETED:
            return SubmissionCommitResult(SubmissionCommitStatus.ALREADY_COMPLETED, None)
        submission = commit.to_submission(
            form_ref=_FORM_REF,
            approver_grant_id=_GRANT_ID,
            endpoint_id=None,
            submitted_at=_NOW,
        )
        return SubmissionCommitResult(SubmissionCommitStatus.COMMITTED, submission)


class _RecordingRepository:
    def __init__(
        self,
        events: list[str],
        *,
        fail_persistence: bool = False,
        commit_status: SubmissionCommitStatus = SubmissionCommitStatus.COMMITTED,
        context_status: HumanInputV2FormStatus = HumanInputV2FormStatus.WAITING,
        context_kind: HumanInputV2FormKind = HumanInputV2FormKind.RUNTIME,
    ) -> None:
        self.events = events
        self.fail_persistence = fail_persistence
        self.commit_status = commit_status
        self.context_status = context_status
        self.context_kind = context_kind

    @contextmanager
    def transaction(self, scope: SubmissionAttemptScope):
        assert scope == _SCOPE
        self.events.append("transaction_begin")
        transaction = _RecordingTransaction(
            self.events,
            fail_persistence=self.fail_persistence,
            commit_status=self.commit_status,
            context_status=self.context_status,
            context_kind=self.context_kind,
        )
        yield transaction
        self.events.append("transaction_commit")


class _RetryingRepository:
    def __init__(
        self,
        events: list[str],
        *,
        context_statuses: tuple[HumanInputV2FormStatus, ...],
        retryable_attempts: frozenset[int],
    ) -> None:
        self.events = events
        self.context_statuses = context_statuses
        self.retryable_attempts = retryable_attempts
        self.attempt_count = 0

    @contextmanager
    def transaction(self, scope: SubmissionAttemptScope):
        assert scope == _SCOPE
        attempt_index = self.attempt_count
        self.attempt_count += 1
        self.events.append(f"transaction_begin:{attempt_index + 1}")
        transaction = _RecordingTransaction(
            self.events,
            context_status=self.context_statuses[attempt_index],
        )
        yield transaction
        if attempt_index in self.retryable_attempts:
            self.events.append(f"serialization_failure:{attempt_index + 1}")
            raise RetryableSubmissionPersistenceError("serialization failure")
        self.events.append(f"transaction_commit:{attempt_index + 1}")


class _IdempotentRecordingResumePort:
    def __init__(self, events: list[str], *, fail: bool = False) -> None:
        self.events = events
        self.fail = fail
        self.dispatched: set[WorkflowResumeIdentity] = set()

    def enqueue_once(self, identity: WorkflowResumeIdentity) -> None:
        if identity in self.dispatched:
            return
        self.events.append("resume_enqueue")
        self.dispatched.add(identity)
        if self.fail:
            raise WorkflowResumeEnqueueError("queue unavailable")


def test_handler_commits_before_enqueuing_workflow_resume() -> None:
    events: list[str] = []
    handler = SubmitHumanInputFormHandler(_RecordingRepository(events), _IdempotentRecordingResumePort(events))

    result = handler.handle(_command())

    assert result.status is SubmitFormResultStatus.SUBMITTED
    assert result.resume_enqueued is True
    assert events == [
        "transaction_begin",
        "context_loaded",
        "persistence_write",
        "transaction_commit",
        "resume_enqueue",
    ]


def test_missing_runtime_resume_identity_rejects_delivery_test_before_repository_access() -> None:
    events: list[str] = []
    handler = SubmitHumanInputFormHandler(
        _RecordingRepository(events, context_kind=HumanInputV2FormKind.DELIVERY_TEST),
        _IdempotentRecordingResumePort(events),
    )

    with pytest.raises(ValueError, match="runtime resume identity"):
        handler.handle(_command(resume_identity=None))

    assert events == []


@pytest.mark.parametrize(
    "identity",
    [
        WorkflowResumeIdentity(TenantId("workspace-2"), _FORM_REF.form_id, "pause-1", "node-execution-1"),
        WorkflowResumeIdentity(_FORM_REF.tenant_id, FormId("form-2"), "pause-1", "node-execution-1"),
    ],
)
def test_resume_identity_owner_mismatch_is_rejected_before_repository_access(identity: WorkflowResumeIdentity) -> None:
    events: list[str] = []
    handler = SubmitHumanInputFormHandler(_RecordingRepository(events), _IdempotentRecordingResumePort(events))

    with pytest.raises(ValueError, match="form owner"):
        handler.handle(_command(resume_identity=identity))

    assert events == []


def test_delivery_test_form_is_rejected_before_any_persistence_write() -> None:
    events: list[str] = []
    handler = SubmitHumanInputFormHandler(
        _RecordingRepository(events, context_kind=HumanInputV2FormKind.DELIVERY_TEST),
        _IdempotentRecordingResumePort(events),
    )

    with pytest.raises(ValueError, match="runtime forms only"):
        handler.handle(_command())

    assert events == ["transaction_begin", "context_loaded"]


def test_loaded_runtime_form_must_match_prevalidated_resume_identity() -> None:
    events: list[str] = []
    handler = SubmitHumanInputFormHandler(_RecordingRepository(events), _IdempotentRecordingResumePort(events))
    identity = WorkflowResumeIdentity(
        _FORM_REF.tenant_id,
        _FORM_REF.form_id,
        "pause-other",
        "node-execution-other",
    )

    with pytest.raises(ValueError, match="loaded form"):
        handler.handle(_command(resume_identity=identity))

    assert events == ["transaction_begin", "context_loaded"]


@pytest.mark.parametrize(
    ("workflow_pause_id", "node_execution_id"),
    [(" ", "node-execution-1"), ("pause-1", " ")],
)
def test_resume_identity_values_must_not_be_blank(workflow_pause_id: str, node_execution_id: str) -> None:
    with pytest.raises(ValueError, match="must not be blank"):
        WorkflowResumeIdentity(
            _FORM_REF.tenant_id,
            _FORM_REF.form_id,
            workflow_pause_id,
            node_execution_id,
        )


def test_persistence_failure_prevents_resume_enqueue() -> None:
    events: list[str] = []
    handler = SubmitHumanInputFormHandler(
        _RecordingRepository(events, fail_persistence=True),
        _IdempotentRecordingResumePort(events),
    )

    with pytest.raises(RuntimeError, match="persistence failed"):
        handler.handle(_command())

    assert "resume_enqueue" not in events
    assert "transaction_commit" not in events
    assert events.count("transaction_begin") == 1


def test_retryable_persistence_failure_restarts_the_complete_transaction_before_resume() -> None:
    events: list[str] = []
    repository = _RetryingRepository(
        events,
        context_statuses=(HumanInputV2FormStatus.WAITING, HumanInputV2FormStatus.WAITING),
        retryable_attempts=frozenset({0}),
    )
    handler = SubmitHumanInputFormHandler(repository, _IdempotentRecordingResumePort(events))

    result = handler.handle(_command())

    assert result.status is SubmitFormResultStatus.SUBMITTED
    assert result.resume_enqueued is True
    assert repository.attempt_count == 2
    assert events.count("context_loaded") == 2
    assert events.count("persistence_write") == 2
    assert events == [
        "transaction_begin:1",
        "context_loaded",
        "persistence_write",
        "serialization_failure:1",
        "transaction_begin:2",
        "context_loaded",
        "persistence_write",
        "transaction_commit:2",
        "resume_enqueue",
    ]


def test_serialization_loser_reloads_current_form_and_returns_already_completed_without_side_effects() -> None:
    events: list[str] = []
    repository = _RetryingRepository(
        events,
        context_statuses=(HumanInputV2FormStatus.WAITING, HumanInputV2FormStatus.SUBMITTED),
        retryable_attempts=frozenset({0}),
    )
    handler = SubmitHumanInputFormHandler(repository, _IdempotentRecordingResumePort(events))

    result = handler.handle(_command())

    assert result.status is SubmitFormResultStatus.ALREADY_COMPLETED
    assert result.resume_enqueued is False
    assert repository.attempt_count == 2
    assert events.count("context_loaded") == 2
    assert events.count("persistence_write") == 1
    assert not any(event.startswith("rejection_audit:") for event in events)
    assert "resume_enqueue" not in events


def test_retryable_persistence_failure_is_reraised_after_one_retry() -> None:
    events: list[str] = []
    repository = _RetryingRepository(
        events,
        context_statuses=(HumanInputV2FormStatus.WAITING, HumanInputV2FormStatus.WAITING),
        retryable_attempts=frozenset({0, 1}),
    )
    handler = SubmitHumanInputFormHandler(repository, _IdempotentRecordingResumePort(events))

    with pytest.raises(RetryableSubmissionPersistenceError, match="serialization failure"):
        handler.handle(_command())

    assert repository.attempt_count == 2
    assert events.count("context_loaded") == 2
    assert events.count("persistence_write") == 2
    assert "resume_enqueue" not in events


def test_enqueue_failure_preserves_submitted_result_and_logs_actionable_identifiers(caplog) -> None:
    events: list[str] = []
    handler = SubmitHumanInputFormHandler(
        _RecordingRepository(events),
        _IdempotentRecordingResumePort(events, fail=True),
    )

    with caplog.at_level("ERROR"):
        result = handler.handle(_command())

    assert result.status is SubmitFormResultStatus.SUBMITTED
    assert result.resume_enqueued is False
    assert "transaction_commit" in events
    assert "workspace-1" in caplog.text
    assert "form-1" in caplog.text
    assert "pause-1" in caplog.text
    assert "node-execution-1" in caplog.text


def test_resume_identity_is_duplicate_safe_through_the_port_contract() -> None:
    events: list[str] = []
    resume_port = _IdempotentRecordingResumePort(events)
    handler = SubmitHumanInputFormHandler(_RecordingRepository(events), resume_port)

    first = handler.handle(_command())
    second = handler.handle(_command())

    assert first.status is SubmitFormResultStatus.SUBMITTED
    assert second.status is SubmitFormResultStatus.SUBMITTED
    assert events.count("resume_enqueue") == 1
    assert resume_port.dispatched == {
        WorkflowResumeIdentity(
            tenant_id=TenantId("workspace-1"),
            form_id=FormId("form-1"),
            workflow_pause_id="pause-1",
            node_execution_id="node-execution-1",
        )
    }


def test_raw_proof_rejection_appends_audit_without_persistence_or_resume() -> None:
    events: list[str] = []
    handler = SubmitHumanInputFormHandler(_RecordingRepository(events), _IdempotentRecordingResumePort(events))

    result = handler.handle(_command(proof="raw-session-token"))

    assert result.status is SubmitFormResultStatus.REJECTED
    assert result.rejection is not None
    assert events == [
        "transaction_begin",
        "context_loaded",
        "rejection_audit:raw_credential_not_verified",
        "transaction_commit",
    ]


def test_already_completed_result_does_not_enqueue_resume() -> None:
    events: list[str] = []
    handler = SubmitHumanInputFormHandler(
        _RecordingRepository(events, commit_status=SubmissionCommitStatus.ALREADY_COMPLETED),
        _IdempotentRecordingResumePort(events),
    )

    result = handler.handle(_command())

    assert result.status is SubmitFormResultStatus.ALREADY_COMPLETED
    assert result.resume_enqueued is False
    assert events == [
        "transaction_begin",
        "context_loaded",
        "persistence_write",
        "transaction_commit",
    ]


def test_form_already_submitted_rejection_maps_to_stable_already_completed_result() -> None:
    events: list[str] = []
    handler = SubmitHumanInputFormHandler(
        _RecordingRepository(events, context_status=HumanInputV2FormStatus.SUBMITTED),
        _IdempotentRecordingResumePort(events),
    )

    result = handler.handle(_command())

    assert result.status is SubmitFormResultStatus.ALREADY_COMPLETED
    assert result.rejection is None
    assert result.resume_enqueued is False
    assert events == [
        "transaction_begin",
        "context_loaded",
        "transaction_commit",
    ]
