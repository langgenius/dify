"""Transaction, owner-scope, rollback, and first-success repository contracts."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
import sqlalchemy as sa
from sqlalchemy import event, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input import ButtonStyle
from core.human_input_v2 import MarkdownText, ResolvedForm, ResolvedFormAction
from core.human_input_v2.approval import (
    ApproverGrant,
    AuthorizationContext,
    AuthorizedSubmissionCommit,
    CanonicalSubjectKey,
    ContactApprovalSubject,
    ContactOTPSubject,
    DeliveryEndpoint,
    EmailAddressApprovalSubject,
    EmailAddressOTPSubject,
    EmailAddressSubmissionActor,
    EndUserApprovalSubject,
    FormAuthorizationAuditEvent,
    FormAuthorizationAuditEventType,
    FormRef,
    HumanInputForm,
    IMEndpointConfiguration,
    RetryableSubmissionPersistenceError,
    SubjectSnapshot,
    SubmissionAttemptScope,
    SubmissionAuthorizationRejection,
    SubmissionAuthorizer,
    SubmissionCommitStatus,
    VerifiedAccountSessionProof,
    VerifiedEmailOTPProof,
    VerifiedIMIdentityProof,
    VerifiedTrustedEndUserProof,
)
from core.human_input_v2.entities import (
    HumanInputDeliveryChannel,
    HumanInputV2FormKind,
    HumanInputV2FormStatus,
    IMProvider,
)
from core.human_input_v2.shared import (
    AccountId,
    AppId,
    ApproverGrantId,
    AuditEventId,
    ContactId,
    DeliveryEndpointId,
    EndUserId,
    FormId,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    NormalizedEmail,
    OTPChallengeId,
    SubmissionId,
    TenantId,
)
from models.enums import EndUserType
from models.human_input_v2 import (
    HumanInputV2Form,
    HumanInputV2FormApproverGrant,
    HumanInputV2FormAuditEvent,
    HumanInputV2FormDeliveryEndpoint,
    HumanInputV2FormSubmission,
)
from models.model import EndUser
from repositories.human_input_v2.form.mappers import endpoint_to_record, form_to_record, grant_to_record
from repositories.human_input_v2.submission.mappers import audit_event_to_record, submission_to_record
from repositories.human_input_v2.submission.repository import (
    SQLAlchemySubmissionRepository,
    SQLAlchemySubmissionTransaction,
    SubmissionPersistenceError,
    SubmissionScopeNotFoundError,
)

_NOW = datetime(2026, 7, 25, 8)
_TENANT_ID = TenantId("workspace-1")
_FORM_REF = FormRef(_TENANT_ID, FormId("form-1"))
_GRANT_ID = ApproverGrantId("grant-1")
_ENDPOINT_ID = DeliveryEndpointId("endpoint-1")
_ACCOUNT_ID = AccountId("account-1")
_CONTACT_ID = ContactId("contact-1")
_INTEGRATION_ID = IntegrationId("integration-1")
_IDENTITY_ID = IMIdentityId("identity-1")
_BINDING_ID = IMBindingId("binding-1")
_SCOPE = SubmissionAttemptScope(_FORM_REF, _GRANT_ID, _ENDPOINT_ID)
_END_USER_ID = EndUserId("end-user-1")
_END_USER_FORM_REF = FormRef(_TENANT_ID, FormId("form-2"))
_END_USER_GRANT_ID = ApproverGrantId("grant-2")
_END_USER_SCOPE = SubmissionAttemptScope(_END_USER_FORM_REF, _END_USER_GRANT_ID, None)
_EMAIL = NormalizedEmail("one-time@example.com")
_EMAIL_FORM_REF = FormRef(_TENANT_ID, FormId("form-3"))
_EMAIL_GRANT_ID = ApproverGrantId("grant-3")
_EMAIL_SCOPE = SubmissionAttemptScope(_EMAIL_FORM_REF, _EMAIL_GRANT_ID, None)


@pytest.fixture
def repository_context(
    sqlite_engine: Engine,
) -> Iterator[tuple[SQLAlchemySubmissionRepository, sessionmaker[Session]]]:
    tables = [
        EndUser.__table__,
        HumanInputV2Form.__table__,
        HumanInputV2FormApproverGrant.__table__,
        HumanInputV2FormDeliveryEndpoint.__table__,
        HumanInputV2FormAuditEvent.__table__,
        HumanInputV2FormSubmission.__table__,
    ]
    HumanInputV2Form.metadata.create_all(sqlite_engine, tables=tables)
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    _seed_authorization_forms(session_maker)
    return SQLAlchemySubmissionRepository(session_maker), session_maker


def _grant() -> ApproverGrant:
    subject = ContactApprovalSubject(_CONTACT_ID)
    return ApproverGrant(
        ref=_FORM_REF.grant(_GRANT_ID),
        subject=subject,
        subject_key=CanonicalSubjectKey.for_contact(subject.contact_id),
        matched_sources=(),
        subject_snapshot=SubjectSnapshot("Reviewer", "reviewer@example.com"),
        created_at=_NOW,
        updated_at=_NOW,
    )


def _form(grant: ApproverGrant) -> HumanInputForm:
    return HumanInputForm(
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
        kind=HumanInputV2FormKind.RUNTIME,
        status=HumanInputV2FormStatus.WAITING,
        workflow_pause_id="pause-1",
        node_execution_id="node-execution-1",
        grants=(grant,),
        created_at=_NOW,
        updated_at=_NOW,
    )


def _endpoint(grant: ApproverGrant) -> DeliveryEndpoint:
    return DeliveryEndpoint(
        ref=grant.ref.endpoint(_ENDPOINT_ID),
        configuration=IMEndpointConfiguration(
            integration_id=_INTEGRATION_ID,
            provider=IMProvider.SLACK,
            provider_tenant_id="provider-tenant-1",
            identity_id=_IDENTITY_ID,
            binding_id=_BINDING_ID,
            provider_user_id="provider-user-1",
        ),
        address_hash="a" * 64,
        access_capability=None,
        created_at=_NOW,
        updated_at=_NOW,
    )


def _end_user_grant() -> ApproverGrant:
    subject = EndUserApprovalSubject(_END_USER_ID)
    return ApproverGrant(
        ref=_END_USER_FORM_REF.grant(_END_USER_GRANT_ID),
        subject=subject,
        subject_key=CanonicalSubjectKey.for_end_user(subject.end_user_id),
        matched_sources=(),
        subject_snapshot=SubjectSnapshot("App Reviewer", None),
        created_at=_NOW,
        updated_at=_NOW,
    )


def _end_user_form(grant: ApproverGrant) -> HumanInputForm:
    return HumanInputForm(
        ref=_END_USER_FORM_REF,
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
        kind=HumanInputV2FormKind.RUNTIME,
        status=HumanInputV2FormStatus.WAITING,
        workflow_pause_id="pause-2",
        node_execution_id="node-execution-2",
        grants=(grant,),
        created_at=_NOW,
        updated_at=_NOW,
    )


def _email_grant() -> ApproverGrant:
    subject = EmailAddressApprovalSubject(_EMAIL)
    return ApproverGrant(
        ref=_EMAIL_FORM_REF.grant(_EMAIL_GRANT_ID),
        subject=subject,
        subject_key=CanonicalSubjectKey.for_email(subject.normalized_email),
        matched_sources=(),
        subject_snapshot=SubjectSnapshot(None, _EMAIL.value),
        created_at=_NOW,
        updated_at=_NOW,
    )


def _email_form(grant: ApproverGrant) -> HumanInputForm:
    return HumanInputForm(
        ref=_EMAIL_FORM_REF,
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
        kind=HumanInputV2FormKind.RUNTIME,
        status=HumanInputV2FormStatus.WAITING,
        workflow_pause_id="pause-3",
        node_execution_id="node-execution-3",
        grants=(grant,),
        created_at=_NOW,
        updated_at=_NOW,
    )


def _seed_authorization_forms(session_maker: sessionmaker[Session]) -> None:
    grant = _grant()
    end_user_grant = _end_user_grant()
    email_grant = _email_grant()
    with session_maker() as session, session.begin():
        session.add_all(
            [
                form_to_record(_form(grant)),
                grant_to_record(grant),
                endpoint_to_record(_endpoint(grant)),
                EndUser(
                    id=str(_END_USER_ID),
                    tenant_id=str(_TENANT_ID),
                    app_id="app-1",
                    type=EndUserType.SERVICE_API,
                    name="App Reviewer",
                    session_id="end-user-session-1",
                ),
                form_to_record(_end_user_form(end_user_grant)),
                grant_to_record(end_user_grant),
                form_to_record(_email_form(email_grant)),
                grant_to_record(email_grant),
            ]
        )


def _im_proof() -> VerifiedIMIdentityProof:
    return VerifiedIMIdentityProof(
        integration_id=_INTEGRATION_ID,
        identity_id=_IDENTITY_ID,
        binding_id=_BINDING_ID,
        provider=IMProvider.SLACK,
        provider_tenant_id="provider-tenant-1",
        provider_user_id="provider-user-1",
    )


def _end_user_proof() -> VerifiedTrustedEndUserProof:
    return VerifiedTrustedEndUserProof(end_user_id=_END_USER_ID, app_id=AppId("app-1"))


def _email_proof() -> VerifiedEmailOTPProof:
    return VerifiedEmailOTPProof(
        challenge_ref=_EMAIL_FORM_REF.grant(_EMAIL_GRANT_ID).challenge(OTPChallengeId("challenge-email")),
        subject=EmailAddressOTPSubject(_EMAIL),
        normalized_email=_EMAIL,
        verified_at=_NOW,
    )


def _authorized(context: AuthorizationContext, proof: object):
    decision = SubmissionAuthorizer.authorize(
        context=context,
        proof=proof,
        selected_action_id="approve",
        now=_NOW,
    )
    assert decision.authorized is not None
    return decision.authorized


def _commit(authorized, *, submission_id: str = "submission-1", audit_id: str = "audit-1"):
    return AuthorizedSubmissionCommit(
        submission_id=SubmissionId(submission_id),
        authorization_audit_event_id=AuditEventId(audit_id),
        authorized=authorized,
        input_snapshot={"comment": "approved"},
        canonical_values={"comment": "approved"},
    )


def test_form_lock_statement_contains_complete_owner_predicates_and_for_update() -> None:
    statement = SQLAlchemySubmissionTransaction.locked_form_statement(_SCOPE)
    compiled = str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))

    assert "human_input_v2_forms.tenant_id = 'workspace-1'" in compiled
    assert "human_input_v2_forms.id = 'form-1'" in compiled
    assert "FOR UPDATE" in compiled


@pytest.mark.parametrize("dialect_name", ["postgresql", "mysql"])
def test_transaction_configures_repeatable_read_before_yield_for_snapshot_dialects(dialect_name: str) -> None:
    events: list[str] = []
    session = MagicMock(spec=Session)
    session.__enter__.return_value = session
    session.__exit__.return_value = False
    session.begin.return_value.__enter__.side_effect = lambda: events.append("transaction_entered")
    session.begin.return_value.__exit__.side_effect = lambda *_args: events.append("transaction_exited")
    session.get_bind.return_value.dialect.name = dialect_name
    session.connection.side_effect = lambda **_kwargs: events.append("isolation_configured")
    repository = SQLAlchemySubmissionRepository(MagicMock(return_value=session))

    with repository.transaction(_SCOPE):
        events.append("transaction_yielded")

    session.connection.assert_called_once_with(execution_options={"isolation_level": "REPEATABLE READ"})
    assert events == [
        "transaction_entered",
        "isolation_configured",
        "transaction_yielded",
        "transaction_exited",
    ]


def test_transaction_preserves_sqlite_default_isolation() -> None:
    session = MagicMock(spec=Session)
    session.__enter__.return_value = session
    session.__exit__.return_value = False
    session.get_bind.return_value.dialect.name = "sqlite"
    repository = SQLAlchemySubmissionRepository(MagicMock(return_value=session))

    with repository.transaction(_SCOPE):
        pass

    session.connection.assert_not_called()


def _transaction_session_mock() -> MagicMock:
    session = MagicMock(spec=Session)
    session.__enter__.return_value = session
    session.__exit__.return_value = False
    session.get_bind.return_value.dialect.name = "sqlite"
    return session


class _SQLStateDriverError(RuntimeError):
    sqlstate: str

    def __init__(self, sqlstate: str) -> None:
        super().__init__(f"database error {sqlstate}")
        self.sqlstate = sqlstate


def _raise_persistence_wrapped_serialization_failure(sqlalchemy_error: OperationalError) -> None:
    try:
        raise sqlalchemy_error
    except OperationalError as error:
        raise SubmissionPersistenceError("write failed") from error


def test_transaction_translates_wrapped_postgresql_serialization_failure_to_retry_signal() -> None:
    session = _transaction_session_mock()
    repository = SQLAlchemySubmissionRepository(MagicMock(return_value=session))
    driver_error = RuntimeError("driver wrapper")
    driver_error.__cause__ = _SQLStateDriverError("40001")
    sqlalchemy_error = OperationalError("SELECT FOR UPDATE", {}, driver_error)

    with pytest.raises(RetryableSubmissionPersistenceError):
        with repository.transaction(_SCOPE):
            raise sqlalchemy_error


def test_transaction_translates_serialization_failure_wrapped_by_persistence_error() -> None:
    session = _transaction_session_mock()
    repository = SQLAlchemySubmissionRepository(MagicMock(return_value=session))
    sqlalchemy_error = OperationalError(
        "UPDATE human_input_v2_forms",
        {},
        SimpleNamespace(sqlstate="40001"),
    )

    with pytest.raises(RetryableSubmissionPersistenceError):
        with repository.transaction(_SCOPE):
            _raise_persistence_wrapped_serialization_failure(sqlalchemy_error)


def test_transaction_does_not_translate_non_serialization_database_failure_to_retry_signal() -> None:
    session = _transaction_session_mock()
    repository = SQLAlchemySubmissionRepository(MagicMock(return_value=session))
    sqlalchemy_error = OperationalError(
        "SELECT FOR UPDATE",
        {},
        SimpleNamespace(sqlstate="40P01"),
    )

    with pytest.raises(SubmissionPersistenceError) as raised:
        with repository.transaction(_SCOPE):
            raise sqlalchemy_error

    assert not isinstance(raised.value, RetryableSubmissionPersistenceError)


def test_contact_and_im_authorization_facts_fail_closed_at_context_boundary(repository_context) -> None:
    repository, session_maker = repository_context
    with repository.transaction(_SCOPE) as transaction:
        context = transaction.load_authorization_context(proof=_im_proof())

    assert context.form.ref == _FORM_REF
    assert context.grant.id == _GRANT_ID
    assert context.endpoint is not None
    assert context.endpoint.id == _ENDPOINT_ID
    assert context.current_contact is None
    assert context.current_end_user is None
    assert context.current_im_binding is None

    contact_otp_proof = VerifiedEmailOTPProof(
        challenge_ref=_FORM_REF.grant(_GRANT_ID).challenge(OTPChallengeId("challenge-contact")),
        subject=ContactOTPSubject(_CONTACT_ID),
        normalized_email=NormalizedEmail("reviewer@example.com"),
        verified_at=_NOW,
    )
    for proof in (VerifiedAccountSessionProof(_ACCOUNT_ID), contact_otp_proof, _im_proof()):
        decision = SubmissionAuthorizer.authorize(
            context=context,
            proof=proof,
            selected_action_id="approve",
            now=_NOW,
        )
        assert decision.authorized is None
        assert decision.rejection is SubmissionAuthorizationRejection.STALE_IDENTITY

    cross_tenant = SubmissionAttemptScope(
        FormRef(TenantId("workspace-2"), _FORM_REF.form_id),
        _GRANT_ID,
        _ENDPOINT_ID,
    )
    with repository.transaction(cross_tenant) as transaction:
        with pytest.raises(SubmissionScopeNotFoundError):
            transaction.load_authorization_context(proof=_im_proof())


def test_loaded_context_is_cached_and_rejection_append_rejects_authorized_events(repository_context) -> None:
    repository, _session_maker = repository_context
    authorized_event = FormAuthorizationAuditEvent(
        id=AuditEventId("audit-authorized"),
        event_type=FormAuthorizationAuditEventType.SUBMISSION_AUTHORIZED,
        form_ref=_FORM_REF,
        approver_grant_id=_GRANT_ID,
        endpoint_id=_ENDPOINT_ID,
        channel=HumanInputDeliveryChannel.IM,
        reason_code=None,
        reason_message=None,
        authorization_proof=_im_proof(),
        payload={"selected_action_id": "approve"},
        occurred_at=_NOW,
        created_at=_NOW,
        updated_at=_NOW,
    )

    with repository.transaction(_SCOPE) as transaction:
        first = transaction.load_authorization_context(proof=_im_proof())
        second = transaction.load_authorization_context(proof=_im_proof())
        with pytest.raises(ValueError, match="submission_rejected"):
            transaction.append_rejection_audit(authorized_event)

    assert second is first


def test_persistence_write_requires_authorization_context_load(repository_context) -> None:
    _repository, session_maker = repository_context
    rejection_event = FormAuthorizationAuditEvent(
        id=AuditEventId("audit-rejected"),
        event_type=FormAuthorizationAuditEventType.SUBMISSION_REJECTED,
        form_ref=_FORM_REF,
        approver_grant_id=_GRANT_ID,
        endpoint_id=_ENDPOINT_ID,
        channel=HumanInputDeliveryChannel.IM,
        reason_code="stale_identity",
        reason_message=None,
        authorization_proof=None,
        payload=None,
        occurred_at=_NOW,
        created_at=_NOW,
        updated_at=_NOW,
    )

    with session_maker() as session:
        transaction = SQLAlchemySubmissionTransaction(session, _SCOPE)
        with pytest.raises(RuntimeError, match="must be loaded"):
            transaction.append_rejection_audit(rejection_event)


def test_context_loads_current_app_scoped_end_user_facts(repository_context) -> None:
    repository, _session_maker = repository_context
    proof = VerifiedTrustedEndUserProof(end_user_id=_END_USER_ID, app_id=AppId("app-1"))

    with repository.transaction(_END_USER_SCOPE) as transaction:
        context = transaction.load_authorization_context(proof=proof)

    assert context.current_contact is None
    assert context.current_im_binding is None
    assert context.current_end_user is not None
    assert context.current_end_user.end_user_id == _END_USER_ID
    assert context.current_end_user.app_id == AppId("app-1")
    assert context.current_end_user.workspace_available is True
    assert _authorized(context, proof).actor.end_user_id == _END_USER_ID


def test_context_keeps_email_address_grant_available_without_contact_facts(repository_context) -> None:
    repository, _session_maker = repository_context
    proof = _email_proof()

    with repository.transaction(_EMAIL_SCOPE) as transaction:
        context = transaction.load_authorization_context(proof=proof)

    assert context.current_contact is None
    assert context.current_end_user is None
    assert context.current_im_binding is None
    assert _authorized(context, proof).actor == EmailAddressSubmissionActor(_EMAIL)


def test_authorized_commit_persists_audit_submission_and_form_transition_atomically(repository_context) -> None:
    repository, session_maker = repository_context
    proof = _end_user_proof()

    with repository.transaction(_END_USER_SCOPE) as transaction:
        context = transaction.load_authorization_context(proof=proof)
        result = transaction.commit_authorized_submission_once(_commit(_authorized(context, proof)))

    assert result.status is SubmissionCommitStatus.COMMITTED
    assert result.submission is not None
    with session_maker() as session:
        assert session.scalar(select(sa.func.count(HumanInputV2FormAuditEvent.id))) == 1
        assert session.scalar(select(sa.func.count(HumanInputV2FormSubmission.id))) == 1
        assert session.get_one(HumanInputV2Form, str(_END_USER_FORM_REF.form_id)).status is (
            HumanInputV2FormStatus.SUBMITTED
        )
        audit = session.get_one(HumanInputV2FormAuditEvent, "audit-1")
        assert audit.event_type == FormAuthorizationAuditEventType.SUBMISSION_AUTHORIZED.value
        assert audit.authorization_proof is not None


def test_rejection_audit_is_append_only_and_requires_the_complete_owner_scope(repository_context) -> None:
    repository, session_maker = repository_context
    event_fact = FormAuthorizationAuditEvent(
        id=AuditEventId("audit-rejected"),
        event_type=FormAuthorizationAuditEventType.SUBMISSION_REJECTED,
        form_ref=_FORM_REF,
        approver_grant_id=_GRANT_ID,
        endpoint_id=_ENDPOINT_ID,
        channel=HumanInputDeliveryChannel.IM,
        reason_code="stale_identity",
        reason_message="Current binding no longer matches.",
        authorization_proof=None,
        payload={"proof_type": "im_identity"},
        occurred_at=_NOW,
        created_at=_NOW,
        updated_at=_NOW,
    )

    with repository.transaction(_SCOPE) as transaction:
        transaction.load_authorization_context(proof=_im_proof())
        transaction.append_rejection_audit(event_fact)

    with session_maker() as session:
        assert session.scalar(select(sa.func.count(HumanInputV2FormAuditEvent.id))) == 1
        assert session.scalar(select(sa.func.count(HumanInputV2FormSubmission.id))) == 0
        assert session.get_one(HumanInputV2Form, "form-1").status is HumanInputV2FormStatus.WAITING

    wrong_owner = FormAuthorizationAuditEvent(
        id=AuditEventId("wrong-owner"),
        event_type=event_fact.event_type,
        form_ref=FormRef(TenantId("workspace-2"), _FORM_REF.form_id),
        approver_grant_id=event_fact.approver_grant_id,
        endpoint_id=event_fact.endpoint_id,
        channel=event_fact.channel,
        reason_code=event_fact.reason_code,
        reason_message=event_fact.reason_message,
        authorization_proof=None,
        payload=event_fact.payload,
        occurred_at=_NOW,
        created_at=_NOW,
        updated_at=_NOW,
    )
    with repository.transaction(_SCOPE) as transaction:
        transaction.load_authorization_context(proof=_im_proof())
        with pytest.raises(ValueError, match="owner scope"):
            transaction.append_rejection_audit(wrong_owner)


@pytest.mark.parametrize("failure_point", ["audit", "submission", "transition"])
def test_any_authorized_write_failure_rolls_back_every_write(repository_context, failure_point: str) -> None:
    repository, session_maker = repository_context
    proof = _end_user_proof()
    trigger_name = f"fail_{failure_point}"
    if failure_point == "audit":
        trigger_sql = (
            f"CREATE TRIGGER {trigger_name} BEFORE INSERT ON human_input_v2_form_audit_events "
            "BEGIN SELECT RAISE(ABORT, 'audit failure'); END"
        )
    elif failure_point == "submission":
        trigger_sql = (
            f"CREATE TRIGGER {trigger_name} BEFORE INSERT ON human_input_v2_form_submissions "
            "BEGIN SELECT RAISE(ABORT, 'submission failure'); END"
        )
    else:
        trigger_sql = (
            f"CREATE TRIGGER {trigger_name} BEFORE UPDATE OF status ON human_input_v2_forms "
            "BEGIN SELECT RAISE(ABORT, 'transition failure'); END"
        )
    with session_maker.kw["bind"].begin() as connection:
        connection.exec_driver_sql(trigger_sql)

    def commit_with_injected_failure() -> None:
        with repository.transaction(_END_USER_SCOPE) as transaction:
            context = transaction.load_authorization_context(proof=proof)
            transaction.commit_authorized_submission_once(_commit(_authorized(context, proof)))

    with pytest.raises(SubmissionPersistenceError):
        commit_with_injected_failure()

    with session_maker() as session:
        assert session.scalar(select(sa.func.count(HumanInputV2FormAuditEvent.id))) == 0
        assert session.scalar(select(sa.func.count(HumanInputV2FormSubmission.id))) == 0
        assert session.get_one(HumanInputV2Form, "form-2").status is HumanInputV2FormStatus.WAITING


def test_unique_form_conflict_translates_to_stable_already_completed(repository_context) -> None:
    repository, session_maker = repository_context
    proof = _end_user_proof()
    with repository.transaction(_END_USER_SCOPE) as transaction:
        context = transaction.load_authorization_context(proof=proof)
        authorized = _authorized(context, proof)
    existing_audit = FormAuthorizationAuditEvent(
        id=AuditEventId("existing-audit"),
        event_type=FormAuthorizationAuditEventType.SUBMISSION_AUTHORIZED,
        form_ref=_END_USER_FORM_REF,
        approver_grant_id=_END_USER_GRANT_ID,
        endpoint_id=None,
        channel=None,
        reason_code=None,
        reason_message=None,
        authorization_proof=proof,
        payload={"selected_action_id": "approve"},
        occurred_at=_NOW,
        created_at=_NOW,
        updated_at=_NOW,
    )
    existing_submission = _commit(authorized, submission_id="existing-submission", audit_id="existing-audit")
    with session_maker() as session, session.begin():
        session.add(audit_event_to_record(existing_audit))
        session.add(
            submission_to_record(
                existing_submission.to_submission(
                    form_ref=_END_USER_FORM_REF,
                    approver_grant_id=_END_USER_GRANT_ID,
                    endpoint_id=None,
                    submitted_at=_NOW,
                )
            )
        )

    with repository.transaction(_END_USER_SCOPE) as transaction:
        context = transaction.load_authorization_context(proof=proof)
        result = transaction.commit_authorized_submission_once(
            _commit(_authorized(context, proof), submission_id="loser", audit_id="loser-audit")
        )

    assert result.status is SubmissionCommitStatus.ALREADY_COMPLETED
    assert result.submission is None
    with session_maker() as session:
        assert session.scalar(select(sa.func.count(HumanInputV2FormSubmission.id))) == 1
        assert session.scalar(select(sa.func.count(HumanInputV2FormAuditEvent.id))) == 1


def test_commit_uses_loaded_end_user_snapshot_without_identity_reload(repository_context) -> None:
    repository, session_maker = repository_context
    proof = _end_user_proof()
    statements: list[str] = []

    def record_statement(_connection, _cursor, statement, _parameters, _context, _executemany) -> None:
        statements.append(statement.lower())

    engine = session_maker.kw["bind"]
    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with repository.transaction(_END_USER_SCOPE) as transaction:
            context = transaction.load_authorization_context(proof=proof)
            authorized = _authorized(context, proof)
            statements.clear()
            transaction.commit_authorized_submission_once(_commit(authorized))
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)

    assert not any("human_input_contact_identities" in statement for statement in statements)
    assert not any("human_input_im_bindings" in statement for statement in statements)
    assert not any("human_input_im_identities" in statement for statement in statements)
