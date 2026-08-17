"""PostgreSQL-only first-success and authorization-snapshot coverage."""

from __future__ import annotations

from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import timedelta
from threading import Event, Lock, get_ident
from time import monotonic, sleep
from typing import cast

import pytest
import sqlalchemy as sa
from pydantic import NaiveDatetime
from sqlalchemy import event
from sqlalchemy.engine import Connection
from sqlalchemy.engine.interfaces import DBAPICursor, ExecutionContext
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

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
    EmailEndpointConfiguration,
    FormAuthorizationAuditEvent,
    FormRef,
    HumanInputForm,
    IMEndpointConfiguration,
    SubjectSnapshot,
    SubmissionAttemptScope,
    SubmissionAuthorizer,
    SubmissionCommitResult,
    SubmissionCommitStatus,
    SubmissionRepository,
    SubmissionTransaction,
    VerifiedEmailOTPProof,
    VerifiedIMIdentityProof,
)
from core.human_input_v2.entities import (
    HumanInputV2FormKind,
    HumanInputV2FormStatus,
    IMBindingScope,
    IMIntegrationStatus,
    IMProvider,
)
from core.human_input_v2.shared import (
    AccountId,
    AppId,
    ApproverGrantId,
    AuditEventId,
    ContactId,
    DeliveryEndpointId,
    FormId,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    NormalizedEmail,
    OTPChallengeId,
    SubmissionId,
    TenantId,
)
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.human_input_v2 import (
    HumanInputContact,
    HumanInputContactIdentitySource,
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMIntegration,
    HumanInputV2Form,
    HumanInputV2FormApproverGrant,
    HumanInputV2FormAuditEvent,
    HumanInputV2FormDeliveryEndpoint,
    HumanInputV2FormSubmission,
    IMIdentityRawPayload,
    SlackIMIntegrationEncryptedCredentials,
)
from repositories.human_input_v2.form.mappers import endpoint_to_record, form_to_record, grant_to_record
from repositories.human_input_v2.submission.repository import SQLAlchemySubmissionRepository
from services.human_input_v2.submission import (
    SubmitFormCommand,
    SubmitFormResult,
    SubmitFormResultStatus,
    SubmitHumanInputFormHandler,
    WorkflowResumeIdentity,
)


@dataclass(frozen=True, slots=True)
class _SeededScenario:
    tenant_id: TenantId
    account_id: AccountId
    contact_id: ContactId
    form_ref: FormRef
    grant_id: ApproverGrantId
    email_endpoint_id: DeliveryEndpointId
    im_endpoint_id: DeliveryEndpointId
    integration_id: IntegrationId
    identity_id: IMIdentityId
    binding_id: IMBindingId
    normalized_email: NormalizedEmail
    provider_tenant_id: str
    provider_user_id: str
    workflow_pause_id: str
    node_execution_id: str


class _RecordingResumePort:
    def __init__(self) -> None:
        self._lock = Lock()
        self.identities: set[WorkflowResumeIdentity] = set()

    def enqueue_once(self, identity: WorkflowResumeIdentity) -> None:
        with self._lock:
            self.identities.add(identity)


class _PausingSubmissionTransaction:
    def __init__(
        self,
        delegate: SubmissionTransaction,
        *,
        context_loaded: Event,
        release_transaction: Event,
    ) -> None:
        self._delegate = delegate
        self._context_loaded = context_loaded
        self._release_transaction = release_transaction

    def load_authorization_context(self, *, proof: object) -> AuthorizationContext:
        context = self._delegate.load_authorization_context(proof=proof)
        self._context_loaded.set()
        if not self._release_transaction.wait(timeout=10):
            raise AssertionError("winner transaction was not released")
        return context

    def append_rejection_audit(self, event: FormAuthorizationAuditEvent) -> None:
        self._delegate.append_rejection_audit(event)

    def commit_authorized_submission_once(
        self,
        commit: AuthorizedSubmissionCommit,
    ) -> SubmissionCommitResult:
        return self._delegate.commit_authorized_submission_once(commit)


class _PausingSubmissionRepository:
    def __init__(
        self,
        delegate: SubmissionRepository,
        *,
        context_loaded: Event,
        release_transaction: Event,
    ) -> None:
        self._delegate = delegate
        self._context_loaded = context_loaded
        self._release_transaction = release_transaction

    @contextmanager
    def transaction(self, scope: SubmissionAttemptScope) -> Generator[SubmissionTransaction, None, None]:
        with self._delegate.transaction(scope) as transaction:
            yield _PausingSubmissionTransaction(
                transaction,
                context_loaded=self._context_loaded,
                release_transaction=self._release_transaction,
            )


class _CountingSubmissionRepository:
    def __init__(self, delegate: SubmissionRepository) -> None:
        self._delegate = delegate
        self._lock = Lock()
        self.attempt_count = 0

    @contextmanager
    def transaction(self, scope: SubmissionAttemptScope) -> Generator[SubmissionTransaction, None, None]:
        with self._lock:
            self.attempt_count += 1
        with self._delegate.transaction(scope) as transaction:
            yield transaction


class _NamedPostgreSQLSession(Session):
    """Test-only Session that labels its PostgreSQL backend for lock observation."""


@event.listens_for(_NamedPostgreSQLSession, "after_begin")
def _set_postgresql_application_name(
    session: Session,
    _transaction: SessionTransaction,
    connection: Connection,
) -> None:
    application_name = session.info.get("application_name")
    if isinstance(application_name, str):
        connection.execute(
            sa.text("SET LOCAL application_name = :application_name"),
            {"application_name": application_name},
        )


def _require_postgresql() -> None:
    if db.engine.dialect.name != "postgresql":
        pytest.skip("requires the CI PostgreSQL integration database")


def _wait_for_postgresql_lock_wait(
    session_maker: sessionmaker[Session],
    *,
    application_name: str,
) -> tuple[int, tuple[int, ...]]:
    deadline = monotonic() + 10
    while monotonic() < deadline:
        with session_maker() as session:
            row = session.execute(
                sa.text(
                    "SELECT pid, pg_blocking_pids(pid) AS blocking_pids "
                    "FROM pg_stat_activity "
                    "WHERE datname = current_database() "
                    "AND application_name = :application_name "
                    "AND wait_event_type = 'Lock' "
                    "ORDER BY backend_start DESC LIMIT 1"
                ),
                {"application_name": application_name},
            ).one_or_none()
        if row is not None and row.blocking_pids:
            return row.pid, tuple(row.blocking_pids)
        sleep(0.05)
    raise AssertionError("loser PostgreSQL backend did not enter a row-lock wait")


type _TimestampedRecord = HumanInputContact | HumanInputIMBinding | HumanInputIMIdentity | HumanInputIMIntegration


def _set_record_identity(record: _TimestampedRecord, record_id: str, now: NaiveDatetime) -> None:
    record.id = record_id
    record.created_at = now
    record.updated_at = now


def _seed_scenario(session_maker: sessionmaker[Session]) -> _SeededScenario:
    now = naive_utc_now()
    tenant_id = TenantId(str(uuidv7()))
    account_id = AccountId(str(uuidv7()))
    contact_id = ContactId(str(uuidv7()))
    form_ref = FormRef(tenant_id, FormId(str(uuidv7())))
    grant_id = ApproverGrantId(str(uuidv7()))
    email_endpoint_id = DeliveryEndpointId(str(uuidv7()))
    im_endpoint_id = DeliveryEndpointId(str(uuidv7()))
    integration_id = IntegrationId(str(uuidv7()))
    identity_id = IMIdentityId(str(uuidv7()))
    binding_id = IMBindingId(str(uuidv7()))
    normalized_email = NormalizedEmail(f"submission-{uuidv7()}@example.com")
    provider_tenant_id = f"provider-tenant-{uuidv7()}"
    provider_user_id = f"provider-user-{uuidv7()}"
    workflow_pause_id = str(uuidv7())
    node_execution_id = str(uuidv7())
    subject = ContactApprovalSubject(contact_id)
    grant = ApproverGrant(
        ref=form_ref.grant(grant_id),
        subject=subject,
        subject_key=CanonicalSubjectKey.for_contact(contact_id),
        matched_sources=(),
        subject_snapshot=SubjectSnapshot("Concurrent Reviewer", str(normalized_email)),
        created_at=now,
        updated_at=now,
    )
    form = HumanInputForm(
        ref=form_ref,
        app_id=AppId(str(uuidv7())),
        resolved_form=ResolvedForm(
            title="Review",
            blocks=(MarkdownText("Approve"),),
            user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
            legacy_form_content="Approve",
        ),
        display_in_ui=True,
        node_timeout_at=now + timedelta(hours=1),
        global_expires_at=now + timedelta(hours=2),
        kind=HumanInputV2FormKind.RUNTIME,
        status=HumanInputV2FormStatus.WAITING,
        workflow_pause_id=workflow_pause_id,
        node_execution_id=node_execution_id,
        grants=(grant,),
        created_at=now,
        updated_at=now,
    )
    email_endpoint = DeliveryEndpoint(
        ref=grant.ref.endpoint(email_endpoint_id),
        configuration=EmailEndpointConfiguration(normalized_email),
        address_hash="a" * 64,
        access_capability=None,
        created_at=now,
        updated_at=now,
    )
    im_endpoint = DeliveryEndpoint(
        ref=grant.ref.endpoint(im_endpoint_id),
        configuration=IMEndpointConfiguration(
            integration_id=integration_id,
            provider=IMProvider.SLACK,
            provider_tenant_id=provider_tenant_id,
            identity_id=identity_id,
            binding_id=binding_id,
            provider_user_id=provider_user_id,
        ),
        address_hash="b" * 64,
        access_capability=None,
        created_at=now,
        updated_at=now,
    )
    tenant = Tenant(name="Submission Runtime Concurrency")
    tenant.id = str(tenant_id)
    account = Account(name="Concurrent Reviewer", email=str(normalized_email), status=AccountStatus.ACTIVE)
    account.id = str(account_id)
    membership = TenantAccountJoin(
        tenant_id=str(tenant_id),
        account_id=str(account_id),
        current=False,
        role=TenantAccountRole.NORMAL,
    )
    membership.id = str(uuidv7())
    contact = HumanInputContact(
        name="Concurrent Reviewer",
        normalized_name="concurrent reviewer",
        identity_source=HumanInputContactIdentitySource.ORGANIZATION_ACCOUNT,
        tenant_id=None,
        account_id=str(account_id),
        email=str(normalized_email),
        normalized_email=str(normalized_email),
        avatar_file_id=None,
    )
    _set_record_identity(contact, str(contact_id), now)
    integration = HumanInputIMIntegration(
        provider=IMProvider.SLACK,
        encrypted_credentials=SlackIMIntegrationEncryptedCredentials(
            client_id="client-1",
            encrypted_client_secret="encrypted-client-secret",
            encrypted_signing_secret="encrypted-signing-secret",
            encrypted_bot_token="encrypted-bot-token",
            encrypted_app_token="encrypted-app-token",
        ),
        tenant_id=str(tenant_id),
        provider_tenant_id=provider_tenant_id,
        status=IMIntegrationStatus.CONNECTED,
        config_version=1,
        configured_by_account_id=str(account_id),
        callback_url=None,
        safe_status_reason=None,
        last_checked_at=now,
    )
    _set_record_identity(integration, str(integration_id), now)
    identity = HumanInputIMIdentity(
        integration_id=str(integration_id),
        provider=IMProvider.SLACK,
        provider_user_id=provider_user_id,
        display_name="Concurrent Reviewer",
        normalized_name="concurrent reviewer",
        email=str(normalized_email),
        normalized_email=str(normalized_email),
        raw_payload=IMIdentityRawPayload({}),
        last_seen_sync_run_id=None,
        last_seen_at=now,
    )
    _set_record_identity(identity, str(identity_id), now)
    binding = HumanInputIMBinding(
        integration_id=str(integration_id),
        scope=IMBindingScope.WORKSPACE,
        scope_id=str(tenant_id),
        contact_id=str(contact_id),
        im_identity_id=str(identity_id),
        provider=IMProvider.SLACK,
        bound_by_account_id=str(account_id),
    )
    _set_record_identity(binding, str(binding_id), now)
    with session_maker.begin() as session:
        session.add_all(
            [
                tenant,
                account,
                membership,
                contact,
                integration,
                identity,
                binding,
                form_to_record(form),
                grant_to_record(grant),
                endpoint_to_record(email_endpoint),
                endpoint_to_record(im_endpoint),
            ]
        )
    return _SeededScenario(
        tenant_id=tenant_id,
        account_id=account_id,
        contact_id=contact_id,
        form_ref=form_ref,
        grant_id=grant_id,
        email_endpoint_id=email_endpoint_id,
        im_endpoint_id=im_endpoint_id,
        integration_id=integration_id,
        identity_id=identity_id,
        binding_id=binding_id,
        normalized_email=normalized_email,
        provider_tenant_id=provider_tenant_id,
        provider_user_id=provider_user_id,
        workflow_pause_id=workflow_pause_id,
        node_execution_id=node_execution_id,
    )


def _cleanup_scenario(session_maker: sessionmaker[Session], scenario: _SeededScenario) -> None:
    form_id = str(scenario.form_ref.form_id)
    with session_maker.begin() as session:
        session.execute(sa.delete(HumanInputV2FormSubmission).where(HumanInputV2FormSubmission.form_id == form_id))
        session.execute(sa.delete(HumanInputV2FormAuditEvent).where(HumanInputV2FormAuditEvent.form_id == form_id))
        session.execute(
            sa.delete(HumanInputV2FormDeliveryEndpoint).where(HumanInputV2FormDeliveryEndpoint.form_id == form_id)
        )
        session.execute(
            sa.delete(HumanInputV2FormApproverGrant).where(HumanInputV2FormApproverGrant.form_id == form_id)
        )
        session.execute(sa.delete(HumanInputV2Form).where(HumanInputV2Form.id == form_id))
        session.execute(
            sa.delete(HumanInputIMBinding).where(HumanInputIMBinding.integration_id == str(scenario.integration_id))
        )
        session.execute(
            sa.delete(HumanInputIMIdentity).where(HumanInputIMIdentity.integration_id == str(scenario.integration_id))
        )
        session.execute(
            sa.delete(HumanInputIMIntegration).where(HumanInputIMIntegration.id == str(scenario.integration_id))
        )
        session.execute(sa.delete(HumanInputContact).where(HumanInputContact.id == str(scenario.contact_id)))
        session.execute(
            sa.delete(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == str(scenario.tenant_id),
                TenantAccountJoin.account_id == str(scenario.account_id),
            )
        )
        session.execute(sa.delete(Account).where(Account.id == str(scenario.account_id)))
        session.execute(sa.delete(Tenant).where(Tenant.id == str(scenario.tenant_id)))


def _email_proof(scenario: _SeededScenario) -> VerifiedEmailOTPProof:
    return VerifiedEmailOTPProof(
        challenge_ref=scenario.form_ref.grant(scenario.grant_id).challenge(OTPChallengeId(str(uuidv7()))),
        subject=ContactOTPSubject(scenario.contact_id),
        normalized_email=scenario.normalized_email,
        verified_at=naive_utc_now(),
    )


def _im_proof(scenario: _SeededScenario) -> VerifiedIMIdentityProof:
    return VerifiedIMIdentityProof(
        integration_id=scenario.integration_id,
        identity_id=scenario.identity_id,
        binding_id=scenario.binding_id,
        provider=IMProvider.SLACK,
        provider_tenant_id=scenario.provider_tenant_id,
        provider_user_id=scenario.provider_user_id,
    )


def _command(scenario: _SeededScenario, *, proof: object, endpoint_id: DeliveryEndpointId) -> SubmitFormCommand:
    return SubmitFormCommand(
        scope=SubmissionAttemptScope(scenario.form_ref, scenario.grant_id, endpoint_id),
        proof=proof,
        selected_action_id="approve",
        input_snapshot={"comment": "approved"},
        canonical_values={"comment": "approved"},
        submission_id=SubmissionId(str(uuidv7())),
        authorization_audit_event_id=AuditEventId(str(uuidv7())),
        rejection_audit_event_id=AuditEventId(str(uuidv7())),
        resume_identity=WorkflowResumeIdentity(
            tenant_id=scenario.form_ref.tenant_id,
            form_id=scenario.form_ref.form_id,
            workflow_pause_id=scenario.workflow_pause_id,
            node_execution_id=scenario.node_execution_id,
        ),
        now=naive_utc_now(),
    )


def test_context_load_uses_one_snapshot_across_contact_membership_and_im_queries(flask_req_ctx: object) -> None:
    _require_postgresql()
    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    scenario = _seed_scenario(session_maker)
    repository = SQLAlchemySubmissionRepository(session_maker)
    scope = SubmissionAttemptScope(scenario.form_ref, scenario.grant_id, scenario.im_endpoint_id)
    proof = _im_proof(scenario)
    contact_query_finished = Event()
    mutation_committed = Event()
    loader_thread_id: list[int] = []

    def pause_after_contact_query(
        _connection: Connection,
        _cursor: DBAPICursor,
        statement: str,
        _parameters: object,
        _context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        normalized_statement = " ".join(statement.lower().split())
        if (
            loader_thread_id
            and get_ident() == loader_thread_id[0]
            and normalized_statement.startswith("select")
            and "from human_input_contacts" in normalized_statement
        ):
            contact_query_finished.set()
            assert mutation_committed.wait(timeout=10)

    def load_context() -> AuthorizationContext:
        loader_thread_id.append(get_ident())
        with repository.transaction(scope) as transaction:
            return transaction.load_authorization_context(proof=proof)

    event.listen(db.engine, "after_cursor_execute", pause_after_contact_query)
    future = None
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(load_context)
            assert contact_query_finished.wait(timeout=10)
            with session_maker.begin() as mutation_session:
                mutation_session.execute(
                    sa.delete(TenantAccountJoin).where(
                        TenantAccountJoin.tenant_id == str(scenario.tenant_id),
                        TenantAccountJoin.account_id == str(scenario.account_id),
                    )
                )
                mutation_session.execute(
                    sa.delete(HumanInputIMBinding).where(HumanInputIMBinding.id == str(scenario.binding_id))
                )
            mutation_committed.set()
            context = future.result(timeout=10)

        assert context.current_contact is not None
        assert context.current_contact.workspace_available is True
        assert context.current_im_binding is not None
        assert context.current_im_binding.binding_id == scenario.binding_id
    finally:
        mutation_committed.set()
        event.remove(db.engine, "after_cursor_execute", pause_after_contact_query)
        if future is not None and not future.done():
            future.result(timeout=10)
        _cleanup_scenario(session_maker, scenario)


def test_row_lock_serialization_loser_retries_and_observes_completed_form(flask_req_ctx: object) -> None:
    _require_postgresql()
    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    scenario = _seed_scenario(session_maker)
    resume_port = _RecordingResumePort()
    winner_context_loaded = Event()
    release_winner = Event()
    winner_repository = _PausingSubmissionRepository(
        SQLAlchemySubmissionRepository(session_maker),
        context_loaded=winner_context_loaded,
        release_transaction=release_winner,
    )
    loser_application_name = f"submission-serialization-loser-{uuidv7()}"
    loser_session_maker = cast(
        sessionmaker[Session],
        sessionmaker(
            bind=db.engine,
            class_=_NamedPostgreSQLSession,
            expire_on_commit=False,
            info={"application_name": loser_application_name},
        ),
    )
    loser_repository = _CountingSubmissionRepository(SQLAlchemySubmissionRepository(loser_session_maker))
    winner_command = _command(
        scenario,
        proof=_email_proof(scenario),
        endpoint_id=scenario.email_endpoint_id,
    )
    loser_command = _command(
        scenario,
        proof=_im_proof(scenario),
        endpoint_id=scenario.im_endpoint_id,
    )

    def submit(repository: SubmissionRepository, command: SubmitFormCommand) -> SubmitFormResult:
        return SubmitHumanInputFormHandler(repository, resume_port).handle(command)

    winner_future = None
    loser_future = None
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            winner_future = executor.submit(submit, winner_repository, winner_command)
            assert winner_context_loaded.wait(timeout=10)
            loser_future = executor.submit(submit, loser_repository, loser_command)
            try:
                loser_pid, blocking_pids = _wait_for_postgresql_lock_wait(
                    session_maker,
                    application_name=loser_application_name,
                )
                assert loser_pid not in blocking_pids
                assert blocking_pids
            finally:
                release_winner.set()
            winner_result = winner_future.result(timeout=10)
            loser_result = loser_future.result(timeout=10)

        assert winner_result.status is SubmitFormResultStatus.SUBMITTED
        assert winner_result.resume_enqueued is True
        assert loser_result.status is SubmitFormResultStatus.ALREADY_COMPLETED
        assert loser_result.resume_enqueued is False
        assert loser_repository.attempt_count == 2
        assert len(resume_port.identities) == 1
        with session_maker() as session:
            assert (
                session.scalar(
                    sa.select(sa.func.count(HumanInputV2FormSubmission.id)).where(
                        HumanInputV2FormSubmission.form_id == str(scenario.form_ref.form_id)
                    )
                )
                == 1
            )
            assert (
                session.scalar(
                    sa.select(sa.func.count(HumanInputV2FormAuditEvent.id)).where(
                        HumanInputV2FormAuditEvent.form_id == str(scenario.form_ref.form_id)
                    )
                )
                == 1
            )
            assert (
                session.get_one(HumanInputV2Form, str(scenario.form_ref.form_id)).status
                is HumanInputV2FormStatus.SUBMITTED
            )
    finally:
        release_winner.set()
        if winner_future is not None and not winner_future.done():
            winner_future.result(timeout=10)
        if loser_future is not None and not loser_future.done():
            loser_future.result(timeout=10)
        _cleanup_scenario(session_maker, scenario)


@pytest.mark.parametrize("proof_kind", ["email", "im"])
def test_loaded_context_remains_authoritative_after_identity_change(flask_req_ctx: object, proof_kind: str) -> None:
    _require_postgresql()
    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    scenario = _seed_scenario(session_maker)
    proof = _email_proof(scenario) if proof_kind == "email" else _im_proof(scenario)
    endpoint_id = scenario.email_endpoint_id if proof_kind == "email" else scenario.im_endpoint_id
    scope = SubmissionAttemptScope(scenario.form_ref, scenario.grant_id, endpoint_id)

    try:
        with SQLAlchemySubmissionRepository(session_maker).transaction(scope) as transaction:
            context = transaction.load_authorization_context(proof=proof)
            with session_maker.begin() as mutation_session:
                if proof_kind == "email":
                    mutation_session.execute(
                        sa.update(HumanInputContact)
                        .where(HumanInputContact.id == str(scenario.contact_id))
                        .values(email="changed@example.com", normalized_email="changed@example.com")
                    )
                else:
                    mutation_session.execute(
                        sa.delete(HumanInputIMBinding).where(HumanInputIMBinding.id == str(scenario.binding_id))
                    )
            decision = SubmissionAuthorizer.authorize(
                context=context,
                proof=proof,
                selected_action_id="approve",
                now=naive_utc_now(),
            )
            assert decision.authorized is not None
            result = transaction.commit_authorized_submission_once(
                AuthorizedSubmissionCommit(
                    submission_id=SubmissionId(str(uuidv7())),
                    authorization_audit_event_id=AuditEventId(str(uuidv7())),
                    authorized=decision.authorized,
                    input_snapshot={"comment": "approved"},
                    canonical_values={"comment": "approved"},
                )
            )

        assert result.status is SubmissionCommitStatus.COMMITTED
        with session_maker() as session:
            assert (
                session.scalar(
                    sa.select(sa.func.count(HumanInputV2FormSubmission.id)).where(
                        HumanInputV2FormSubmission.form_id == str(scenario.form_ref.form_id)
                    )
                )
                == 1
            )
    finally:
        _cleanup_scenario(session_maker, scenario)
