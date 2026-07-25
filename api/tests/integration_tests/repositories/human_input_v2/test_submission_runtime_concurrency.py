"""PostgreSQL-only first-success and authorization-snapshot coverage."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import timedelta
from threading import Barrier, Lock

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.approval import (
    ApproverGrant,
    AuthorizedSubmissionCommit,
    CanonicalSubjectKey,
    ContactApprovalSubject,
    ContactOTPSubject,
    DeliveryEndpoint,
    EmailEndpointConfiguration,
    FormAuthorizationAuditEventType,
    FormRef,
    FrozenFormAction,
    FrozenFormDefinition,
    FrozenJSONObject,
    HumanInputForm,
    IMEndpointConfiguration,
    SubjectSnapshot,
    SubmissionAttemptScope,
    SubmissionAuthorizer,
    SubmissionCommitStatus,
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
    UtcTimestamp,
    WorkspaceId,
)
from extensions.ext_database import db
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
    workspace_id: WorkspaceId
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


class _RecordingResumePort:
    def __init__(self) -> None:
        self._lock = Lock()
        self.identities: set[WorkflowResumeIdentity] = set()

    def enqueue_once(self, identity: WorkflowResumeIdentity) -> None:
        with self._lock:
            self.identities.add(identity)


def _require_postgresql() -> None:
    if db.engine.dialect.name != "postgresql":
        pytest.skip("requires the CI PostgreSQL integration database")


type _TimestampedRecord = HumanInputContact | HumanInputIMBinding | HumanInputIMIdentity | HumanInputIMIntegration


def _set_record_identity(record: _TimestampedRecord, record_id: str, now: UtcTimestamp) -> None:
    record.id = record_id
    record.created_at = now.value
    record.updated_at = now.value


def _seed_scenario(session_maker: sessionmaker[Session]) -> _SeededScenario:
    now = UtcTimestamp.now()
    workspace_id = WorkspaceId(str(uuidv7()))
    account_id = AccountId(str(uuidv7()))
    contact_id = ContactId(str(uuidv7()))
    form_ref = FormRef(workspace_id, FormId(str(uuidv7())))
    grant_id = ApproverGrantId(str(uuidv7()))
    email_endpoint_id = DeliveryEndpointId(str(uuidv7()))
    im_endpoint_id = DeliveryEndpointId(str(uuidv7()))
    integration_id = IntegrationId(str(uuidv7()))
    identity_id = IMIdentityId(str(uuidv7()))
    binding_id = IMBindingId(str(uuidv7()))
    normalized_email = NormalizedEmail(f"submission-{uuidv7()}@example.com")
    provider_tenant_id = f"provider-tenant-{uuidv7()}"
    provider_user_id = f"provider-user-{uuidv7()}"
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
        definition=FrozenFormDefinition(
            form_content="Approve",
            inputs=(),
            actions=(FrozenFormAction("approve", "Approve", "primary"),),
            default_values=FrozenJSONObject.from_mapping({}),
            node_title="Review",
            display_in_ui=True,
        ),
        rendered_content="Approve",
        node_timeout_at=UtcTimestamp(now.value + timedelta(hours=1)),
        global_expires_at=UtcTimestamp(now.value + timedelta(hours=2)),
        kind=HumanInputV2FormKind.RUNTIME,
        status=HumanInputV2FormStatus.WAITING,
        workflow_pause_id=str(uuidv7()),
        node_execution_id=str(uuidv7()),
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
    tenant.id = str(workspace_id)
    account = Account(name="Concurrent Reviewer", email=str(normalized_email), status=AccountStatus.ACTIVE)
    account.id = str(account_id)
    membership = TenantAccountJoin(
        tenant_id=str(workspace_id),
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
        ),
        tenant_id=str(workspace_id),
        provider_tenant_id=provider_tenant_id,
        status=IMIntegrationStatus.CONNECTED,
        config_version=1,
        configured_by_account_id=str(account_id),
        callback_url=None,
        safe_status_reason=None,
        last_checked_at=now.value,
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
        last_seen_at=now.value,
    )
    _set_record_identity(identity, str(identity_id), now)
    binding = HumanInputIMBinding(
        integration_id=str(integration_id),
        scope=IMBindingScope.WORKSPACE,
        scope_id=str(workspace_id),
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
        workspace_id=workspace_id,
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
                TenantAccountJoin.tenant_id == str(scenario.workspace_id),
                TenantAccountJoin.account_id == str(scenario.account_id),
            )
        )
        session.execute(sa.delete(Account).where(Account.id == str(scenario.account_id)))
        session.execute(sa.delete(Tenant).where(Tenant.id == str(scenario.workspace_id)))


def _email_proof(scenario: _SeededScenario) -> VerifiedEmailOTPProof:
    return VerifiedEmailOTPProof(
        challenge_ref=scenario.form_ref.grant(scenario.grant_id).challenge(OTPChallengeId(str(uuidv7()))),
        subject=ContactOTPSubject(scenario.contact_id),
        normalized_email=scenario.normalized_email,
        verified_at=UtcTimestamp.now(),
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
        input_snapshot=FrozenJSONObject.from_mapping({"comment": "approved"}),
        canonical_values=FrozenJSONObject.from_mapping({"comment": "approved"}),
        submission_id=SubmissionId(str(uuidv7())),
        authorization_audit_event_id=AuditEventId(str(uuidv7())),
        rejection_audit_event_id=AuditEventId(str(uuidv7())),
        now=UtcTimestamp.now(),
    )


def test_concurrent_email_and_im_submission_has_exactly_one_winner(flask_req_ctx) -> None:
    _require_postgresql()
    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    scenario = _seed_scenario(session_maker)
    resume_port = _RecordingResumePort()
    barrier = Barrier(2)
    commands = (
        _command(scenario, proof=_email_proof(scenario), endpoint_id=scenario.email_endpoint_id),
        _command(scenario, proof=_im_proof(scenario), endpoint_id=scenario.im_endpoint_id),
    )

    def submit(command: SubmitFormCommand) -> SubmitFormResult:
        barrier.wait()
        return SubmitHumanInputFormHandler(
            SQLAlchemySubmissionRepository(session_maker),
            resume_port,
        ).handle(command)

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(submit, commands))

        assert [result.status for result in results].count(SubmitFormResultStatus.SUBMITTED) == 1
        assert [result.status for result in results].count(SubmitFormResultStatus.ALREADY_COMPLETED) == 1
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
                        HumanInputV2FormAuditEvent.form_id == str(scenario.form_ref.form_id),
                        HumanInputV2FormAuditEvent.event_type
                        == FormAuthorizationAuditEventType.SUBMISSION_AUTHORIZED.value,
                    )
                )
                == 1
            )
            assert (
                session.get_one(HumanInputV2Form, str(scenario.form_ref.form_id)).status
                is HumanInputV2FormStatus.SUBMITTED
            )
    finally:
        _cleanup_scenario(session_maker, scenario)


@pytest.mark.parametrize("proof_kind", ["email", "im"])
def test_loaded_context_remains_authoritative_after_identity_change(flask_req_ctx, proof_kind: str) -> None:
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
                now=UtcTimestamp.now(),
            )
            assert decision.authorized is not None
            result = transaction.commit_authorized_submission_once(
                AuthorizedSubmissionCommit(
                    submission_id=SubmissionId(str(uuidv7())),
                    authorization_audit_event_id=AuditEventId(str(uuidv7())),
                    authorized=decision.authorized,
                    input_snapshot=FrozenJSONObject.from_mapping({"comment": "approved"}),
                    canonical_values=FrozenJSONObject.from_mapping({"comment": "approved"}),
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
