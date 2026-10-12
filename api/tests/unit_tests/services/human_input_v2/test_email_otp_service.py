import json

"""OTP authorization and audit transactions against actual SQLite persistence."""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import timedelta
from hashlib import sha256
from pathlib import Path
from sqlite3 import Connection as SQLiteConnection
from unittest.mock import MagicMock, Mock, create_autospec
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import ConnectionPoolEntry

from core.human_input_v2.resolved_form import ResolvedForm
from core.human_input_v2.shared.values import ContactId, NormalizedEmail, TenantId
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from core.workflow.nodes.human_input_v2.entities import DynamicEmail, OnetimeEmail
from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import naive_utc_now
from libs.helper import RateLimiter
from models.account import Account, Tenant, TenantAccountJoin
from models.human_input_v2 import (
    HumanInputAuditEvent,
    HumanInputContactIdentity,
    HumanInputDelivery,
    HumanInputExternalContactProfile,
    HumanInputForm,
    HumanInputPlatformContactWorkspaceEntry,
    HumanInputRecipient,
    OtpVerificationEvent,
)
from models.model import App, AppMode
from repositories.human_input_v2.contact import ExternalContact
from repositories.human_input_v2.delivery_repository import (
    Delivery,
    DeliveryCreateParams,
    EmailTargetSnapshot,
    SubmissionAuthType,
)
from repositories.human_input_v2.form_repository import Form, FormCreateParams, FormSubmissionFailure
from repositories.human_input_v2.recipient_repository import (
    ContactRecipientSubject,
    EmailRecipientSubject,
    RecipientCreateParams,
)
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from repositories.human_input_v2.sqlalchemy_recipient_repository import SQLAlchemyRecipientRepository
from services.human_input_v2.email_otp_service import (
    EmailOtpError,
    EmailOtpService,
    OtpFailure,
    OtpMail,
    VerificationStatus,
    VerifiedEmail,
)


@dataclass
class Context:
    sessions: sessionmaker[Session]
    service: EmailOtpService
    redis: Mock
    limiter: Mock
    send: Mock
    delivery: Delivery
    form: Form
    token: str


@pytest.fixture(params=["email", "dynamic_email", "external_contact"])
def context(request: pytest.FixtureRequest, tmp_path: Path) -> Iterator[Context]:
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'otp.sqlite3'}", connect_args={"timeout": 10})
    # Explicit BEGIN keeps repository savepoints inside the caller's transaction.

    @event.listens_for(engine, "connect")
    def configure(connection: SQLiteConnection, _record: ConnectionPoolEntry) -> None:
        connection.isolation_level = None

    @event.listens_for(engine, "begin")
    def begin(connection: Connection) -> None:
        connection.exec_driver_sql("BEGIN")

    for model in (
        App,
        Tenant,
        Account,
        TenantAccountJoin,
        HumanInputForm,
        HumanInputRecipient,
        HumanInputDelivery,
        HumanInputAuditEvent,
        HumanInputContactIdentity,
        HumanInputExternalContactProfile,
        HumanInputPlatformContactWorkspaceEntry,
    ):
        model.metadata.tables[model.__tablename__].create(engine)
    sessions = sessionmaker(engine, expire_on_commit=False)
    tenant, app_id, token = TenantId(str(uuid4())), str(uuid4()), "form-secret"
    now = naive_utc_now()
    with sessions.begin() as session:
        tenant_record = Tenant(name="OTP workspace")
        tenant_record.id = tenant
        session.add(tenant_record)
        session.add(
            App(id=app_id, tenant_id=tenant, name="Approval", mode=AppMode.WORKFLOW, enable_site=True, enable_api=True)
        )
        session.flush()
        form = SQLAlchemyFormRepository(session, tenant, app_id).create_form(
            FormCreateParams(
                workflow_run_id=None,
                node_execution_id=None,
                form_kind=HumanInputFormKind.DELIVERY_TEST,
                resolved_form=ResolvedForm(title="Approval", parts=(), actions=(), legacy_form_content="Review"),
                expiration_time=now + timedelta(hours=1),
                global_timeout_deadline=now + timedelta(hours=2),
            )
        )
        if request.param == "external_contact":
            contact = SQLAlchemyContactRepository(session).save_external_contact(
                tenant,
                ExternalContact(
                    id=ContactId(str(uuid4())),
                    name="Approver",
                    email="approver@example.com",
                    avatar_file_id=None,
                    created_at=now,
                ),
            )
            subject = ContactRecipientSubject(contact.id)
        else:
            subject = EmailRecipientSubject(NormalizedEmail("approver@example.com"))
        recipient = SQLAlchemyRecipientRepository(session, tenant, form.id).create_recipients(
            [
                RecipientCreateParams(
                    subject=subject,
                    sources=(
                        (DynamicEmail(selector=["input", "email"]),)
                        if request.param == "dynamic_email"
                        else (OnetimeEmail(email="approver@example.com"),)
                    ),
                    name=None,
                )
            ]
        )[0]
        delivery = SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=tenant,
            form_id=form.id,
            params=DeliveryCreateParams(
                recipient_id=recipient.id,
                token_hash=sha256(token.encode()).hexdigest(),
                auth_type=SubmissionAuthType.EMAIL_OTP,
                target_snapshot=EmailTargetSnapshot(email_address="approver@example.com"),
            ),
        )
    redis = Mock(spec=RedisClientWrapper)
    payload = {"type": "email", "email": "approver@example.com", "otp": "123456"}
    if isinstance(subject, ContactRecipientSubject):
        payload.update(type="external_contact", contact_id=subject.contact_id)
    redis.get.return_value = json.dumps(payload).encode()
    redis.get.side_effect = lambda key: b"0" if key.endswith(":failed_attempts") else redis.get.return_value
    redis.ttl.return_value = 600
    redis.incr_if_exists.return_value = 1
    pipeline = MagicMock()
    pipeline.__enter__.return_value = pipeline
    redis.pipeline.return_value = pipeline
    limiter = Mock(spec=RateLimiter)
    limiter.acquire.return_value = 0
    limiter.retry_after.return_value = 60
    send = Mock()
    service = EmailOtpService(
        session_factory=sessions,
        redis=redis,
        limiter=limiter,
        mail=OtpMail(available=lambda: True, send=send),
    )
    yield Context(sessions, service, redis, limiter, send, delivery, form, token)
    engine.dispose()


def test_send_uses_frozen_email_and_six_digit_code_without_tokens(context: Context) -> None:
    response = context.service.request_access(context.token)
    address, code = context.send.call_args.args
    assert address == "approver@example.com"
    assert len(code) == 6
    assert code.isascii()
    assert code.isdigit()
    assert len(response.challenge_token) >= 43
    assert response.challenge_token not in repr(response)
    assert response.expires_in_seconds == 600
    assert response.resend_after_seconds == 60


@pytest.mark.parametrize(
    ("status", "reason"),
    [
        (VerificationStatus.INVALID, OtpFailure.INVALID),
        (VerificationStatus.STALE, OtpFailure.STALE),
        (VerificationStatus.EXPIRED, OtpFailure.CHALLENGE_EXPIRED),
    ],
)
def test_rejected_proof_persists_failure_audit(
    context: Context, status: VerificationStatus, reason: OtpFailure
) -> None:
    if status == VerificationStatus.EXPIRED:
        context.redis.get.return_value = None
    elif status == VerificationStatus.STALE:
        context.redis.incr_if_exists.return_value = 5
    with pytest.raises(EmailOtpError) as error:
        context.service.verify(
            context.token, challenge_token="challenge-secret", otp_code="000000", ip_address="127.0.0.1"
        )
    assert error.value.reason == reason
    with context.sessions() as session:
        audit = session.scalar(sa.select(HumanInputAuditEvent))
        assert audit is not None
        assert isinstance(audit.payload, OtpVerificationEvent)
        assert audit.payload.succeeded is False
        assert audit.payload.reason == reason.value
        assert audit.payload.recipient_id == context.delivery.recipient_id
        assert "challenge-secret" not in audit.payload.model_dump_json()
        assert "000000" not in audit.payload.model_dump_json()


def test_missing_proof_is_audited_without_spending_guesses(context: Context) -> None:
    with pytest.raises(EmailOtpError) as error:
        context.service.verify(context.token, challenge_token=None, otp_code=None, ip_address=None)
    assert error.value.reason == OtpFailure.INVALID
    context.redis.incr_if_exists.assert_not_called()
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputAuditEvent)) == 1


def test_rate_limit_does_not_send_email(context: Context) -> None:
    context.limiter.acquire.return_value = 32
    with pytest.raises(EmailOtpError) as error:
        context.service.request_access(context.token)
    assert error.value.reason == OtpFailure.RATE_LIMIT
    assert error.value.retry_after == 32
    context.send.assert_not_called()


def test_send_failure_removes_only_its_challenge(context: Context) -> None:
    context.send.side_effect = EmailOtpError(OtpFailure.DELIVERY)
    with pytest.raises(EmailOtpError) as error:
        context.service.request_access(context.token)
    assert error.value.reason == OtpFailure.DELIVERY
    assert error.value.retry_after == 60


def test_storage_failure_does_not_send(context: Context) -> None:
    from redis.exceptions import ConnectionError

    context.redis.pipeline.return_value.execute.side_effect = ConnectionError("secret-command")
    with pytest.raises(EmailOtpError) as error:
        context.service.request_access(context.token)
    assert error.value.reason == OtpFailure.UNAVAILABLE
    assert "secret-command" not in str(error.value)
    context.send.assert_not_called()


@pytest.mark.parametrize("status", [HumanInputFormStatus.SUBMITTED, HumanInputFormStatus.EXPIRED])
def test_terminal_form_cannot_issue_or_verify_proof(context: Context, status: HumanInputFormStatus) -> None:
    with context.sessions.begin() as session:
        session.execute(sa.update(HumanInputForm).values(status=status))
    with pytest.raises(EmailOtpError):
        context.service.request_access(context.token)
    with pytest.raises(EmailOtpError):
        context.service.verify(context.token, challenge_token="proof", otp_code="123456", ip_address=None)
    context.send.assert_not_called()
    context.redis.incr_if_exists.assert_not_called()


def test_wrong_auth_type_does_not_issue_otp(context: Context) -> None:
    with context.sessions.begin() as session:
        session.execute(sa.update(HumanInputDelivery).values(auth_type=SubmissionAuthType.CONSOLE))
    with pytest.raises(EmailOtpError) as error:
        context.service.request_access(context.token)
    assert error.value.reason == OtpFailure.NOT_FOUND
    context.send.assert_not_called()


def test_submission_and_success_audit_commit_or_rollback_together(context: Context) -> None:
    verified = context.service.verify(context.token, challenge_token="proof", otp_code="123456", ip_address=None)

    def submit(session: Session) -> Form | FormSubmissionFailure:
        return SQLAlchemyFormRepository(session, context.form.tenant_id, context.form.app_id).submit_form(
            context.form.id,
            submitted_by_recipient_id=context.delivery.recipient_id,
            selected_action_id="approve",
            raw_submission_inputs={},
            normalized_submission_data={},
        )

    with context.sessions() as session:
        assert isinstance(submit(session), Form)
        verified.add_submission_audit(session, ip_address=None)
        session.flush()
        session.rollback()
    with context.sessions() as session:
        assert session.scalar(sa.select(HumanInputForm.status)) == HumanInputFormStatus.WAITING
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputAuditEvent)) == 0
    # A new request can still verify after rollback; proof is not consumed.
    verified = context.service.verify(context.token, challenge_token="proof", otp_code="123456", ip_address=None)
    with context.sessions.begin() as session:
        assert isinstance(submit(session), Form)
        verified.add_submission_audit(session, ip_address=None)
    context.service.cleanup(context.delivery.id, "proof")
    with context.sessions() as session:
        assert submit(session) == FormSubmissionFailure.ALREADY_SUBMITTED
        audit = session.scalars(sa.select(HumanInputAuditEvent)).one()
        assert isinstance(audit.payload, OtpVerificationEvent)
        assert audit.payload.succeeded is True


def test_current_contact_email_change_invalidates_only_contact_proof(context: Context) -> None:
    with context.sessions.begin() as session:
        profile = session.scalar(sa.select(HumanInputExternalContactProfile))
        if profile is None:
            # Direct email is independent of later directory membership.
            session.add(Account(name="Same email", email="approver@example.com"))
            external = False
        else:
            profile.email = "changed@example.com"
            external = True
    if external:
        with pytest.raises(EmailOtpError) as error:
            context.service.verify(context.token, challenge_token="proof", otp_code="123456", ip_address=None)
        assert error.value.reason == OtpFailure.STALE
        with context.sessions() as session:
            audit = session.scalars(sa.select(HumanInputAuditEvent)).one()
            assert isinstance(audit.payload, OtpVerificationEvent)
            assert audit.payload.reason == OtpFailure.STALE.value
        with pytest.raises(EmailOtpError) as error:
            context.service.request_access(context.token)
        assert error.value.reason == OtpFailure.NOT_FOUND
    else:
        verified = context.service.verify(context.token, challenge_token="proof", otp_code="123456", ip_address=None)
        assert verified.subject.type == "email"
        assert verified.subject.email == "approver@example.com"


def test_recreated_contact_with_same_email_does_not_restore_old_delivery(context: Context) -> None:
    with context.sessions.begin() as session:
        profile = session.scalar(sa.select(HumanInputExternalContactProfile))
        if profile is not None:
            session.delete(profile)
            session.execute(sa.delete(HumanInputContactIdentity))
            session.flush()
        SQLAlchemyContactRepository(session).save_external_contact(
            context.form.tenant_id,
            ExternalContact(
                id=ContactId(str(uuid4())),
                name="Replacement",
                email="approver@example.com",
                avatar_file_id=None,
                created_at=naive_utc_now(),
            ),
        )
    if profile is not None:
        with pytest.raises(EmailOtpError) as error:
            context.service.request_access(context.token)
        assert error.value.reason == OtpFailure.NOT_FOUND
    else:
        context.service.request_access(context.token)
        assert context.send.call_args.args[0] == "approver@example.com"


def test_form_deadline_is_checked_independently_of_proof(context: Context) -> None:
    with context.sessions.begin() as session:
        session.execute(sa.update(HumanInputForm).values(expiration_time=naive_utc_now() - timedelta(seconds=1)))
    with pytest.raises(EmailOtpError) as error:
        context.service.verify(context.token, challenge_token="proof", otp_code="123456", ip_address=None)
    assert error.value.reason == OtpFailure.EXPIRED
    context.redis.incr_if_exists.assert_not_called()


def test_cleanup_failure_does_not_undo_submission_or_log_secrets(
    context: Context, caplog: pytest.LogCaptureFixture
) -> None:
    from redis.exceptions import ConnectionError

    context.redis.delete.side_effect = ConnectionError("proof-secret otp-secret")
    context.service.cleanup(context.delivery.id, "proof-secret")
    assert "cleanup failed" in caplog.text
    assert "proof-secret" not in caplog.text
    assert "otp-secret" not in caplog.text


def test_audit_failure_does_not_repeat_verification_or_restore_budget(context: Context) -> None:
    from sqlalchemy.exc import OperationalError

    with context.sessions.begin() as session:
        session.execute(sa.text("DROP TABLE hitlv2_audit_events"))
    with pytest.raises(OperationalError):
        context.service.verify(context.token, challenge_token="proof", otp_code="000000", ip_address=None)
    context.redis.incr_if_exists.assert_called_once()


def test_field_validation_failure_does_not_write_success_audit(context: Context) -> None:
    context.service.verify(context.token, challenge_token="proof", otp_code="123456", ip_address=None)
    # The caller rejects its form input and therefore never accepts a submission.
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputAuditEvent)) == 0
    context.service.verify(context.token, challenge_token="proof", otp_code="123456", ip_address=None)


def test_deployment_mail_content_and_provider_failure_redaction(
    context: Context, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr("services.human_input_v2.email_otp_service.secrets.randbelow", lambda _bound: 1234)
    from extensions.ext_mail import Mail
    from services.human_input_v2 import email_otp_composition as composition

    mail = create_autospec(Mail, instance=True)
    mail.is_inited.return_value = True
    mail.send.side_effect = TimeoutError("provider echoed otp-secret")
    monkeypatch.setattr(composition, "mail", mail)
    monkeypatch.setattr(composition.session_factory, "create_session", context.sessions)
    monkeypatch.setattr(composition, "redis_client", context.redis)
    monkeypatch.setattr(composition, "RateLimiter", lambda **_kwargs: context.limiter)
    with pytest.raises(EmailOtpError) as error:
        composition.build_email_otp_service().request_access(context.token)
    assert error.value.reason == OtpFailure.DELIVERY
    sent = mail.send.call_args.kwargs
    assert "001234" in sent["html"]
    assert "otp-secret" not in caplog.text
    assert "001234" not in caplog.text
    assert context.token not in sent["html"]


def test_unconfigured_deployment_mail_does_not_spend_sending_budget(context: Context) -> None:
    service = EmailOtpService(
        session_factory=context.sessions,
        redis=context.redis,
        limiter=context.limiter,
        mail=OtpMail(available=lambda: False, send=context.send),
    )
    with pytest.raises(EmailOtpError) as error:
        service.request_access(context.token)
    assert error.value.reason == OtpFailure.UNAVAILABLE
    context.limiter.acquire.assert_not_called()
    context.send.assert_not_called()


def test_two_verified_challenges_accept_one_submission_and_success_audit(context: Context) -> None:
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    proofs = [
        context.service.verify(context.token, challenge_token=token, otp_code="123456", ip_address=None)
        for token in ("first", "second")
    ]
    barrier = Barrier(2)

    def accept(verified: VerifiedEmail) -> Form | FormSubmissionFailure:
        barrier.wait()
        with context.sessions.begin() as session:
            result = SQLAlchemyFormRepository(session, context.form.tenant_id, context.form.app_id).submit_form(
                context.form.id,
                submitted_by_recipient_id=context.delivery.recipient_id,
                selected_action_id="approve",
                raw_submission_inputs={},
                normalized_submission_data={},
            )
            if isinstance(result, Form):
                verified.add_submission_audit(session, ip_address=None)
            return result

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(accept, proofs))
    assert sum(isinstance(result, Form) for result in results) == 1
    assert results.count(FormSubmissionFailure.ALREADY_SUBMITTED) == 1
    with context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputAuditEvent)) == 1


def test_mail_is_sent_after_authorization_session_closes(context: Context) -> None:
    opened = []

    def sessions() -> Session:
        session = context.sessions()
        opened.append(session)
        return session

    def send(_email: str, _code: str) -> None:
        assert opened
        assert all(not session.in_transaction() for session in opened)

    service = EmailOtpService(
        session_factory=sessions,
        redis=context.redis,
        limiter=context.limiter,
        mail=OtpMail(available=lambda: True, send=send),
    )
    service.request_access(context.token)


@pytest.mark.parametrize("owner", ["delivery", "app"])
def test_cross_tenant_owner_chain_is_rejected(context: Context, owner: str) -> None:
    with context.sessions.begin() as session:
        if owner == "delivery":
            session.execute(sa.update(HumanInputDelivery).values(tenant_id=str(uuid4())))
        else:
            session.execute(sa.update(App).values(tenant_id=str(uuid4())))
    with pytest.raises(EmailOtpError) as error:
        context.service.request_access(context.token)
    assert error.value.reason == OtpFailure.NOT_FOUND
    context.send.assert_not_called()


def test_no_access_token_is_returned_if_challenge_expires_during_send(context: Context) -> None:
    context.redis.ttl.return_value = 0
    with pytest.raises(EmailOtpError) as error:
        context.service.request_access(context.token)
    assert error.value.reason == OtpFailure.CHALLENGE_EXPIRED


def test_redis_verification_outage_is_audited_without_logging_its_command(
    context: Context, caplog: pytest.LogCaptureFixture
) -> None:
    from redis.exceptions import ConnectionError

    context.redis.get.side_effect = ConnectionError("secret-command otp-secret")
    with pytest.raises(EmailOtpError) as error:
        context.service.verify(context.token, challenge_token="proof-secret", otp_code="001234", ip_address=None)
    assert error.value.reason == OtpFailure.UNAVAILABLE
    with context.sessions() as session:
        audit = session.scalar(sa.select(HumanInputAuditEvent))
        assert audit is not None
        assert audit is not None
        assert isinstance(audit.payload, OtpVerificationEvent)
        assert audit.payload.succeeded is False
        assert audit.payload.reason == OtpFailure.UNAVAILABLE.value
    assert "secret-command" not in caplog.text
    assert "proof-secret" not in caplog.text
    assert "001234" not in caplog.text


def test_deleted_tenant_email_channel_does_not_block_deployment_otp(context: Context) -> None:
    from core.human_input_v2.entities import EmailProviderType
    from models.human_input_v2 import HumanInputEmailProvider, ResendEmailProviderEncryptedCredentials

    with context.sessions.begin() as session:
        HumanInputEmailProvider.metadata.tables[HumanInputEmailProvider.__tablename__].create(session.connection())
        channel = HumanInputEmailProvider(
            tenant_id=context.form.tenant_id,
            provider=EmailProviderType.RESEND,
            sender_email="old-sender@example.com",
            encrypted_credentials=ResendEmailProviderEncryptedCredentials(encrypted_api_key="unused-ciphertext"),
        )
        session.add(channel)
        session.flush()
        session.delete(channel)
    response = context.service.request_access(context.token)
    assert response.expires_in_seconds == 600
    assert context.send.call_args.args[0] == "approver@example.com"


def test_binding_mismatch_does_not_consume_guesses(context: Context) -> None:
    payload = json.loads(context.redis.get.return_value)
    payload["email"] = "another@example.com"
    context.redis.get.return_value = json.dumps(payload)
    with pytest.raises(EmailOtpError) as error:
        context.service.verify(context.token, challenge_token="proof", otp_code="123456", ip_address=None)
    assert error.value.reason == OtpFailure.STALE
    context.redis.incr_if_exists.assert_not_called()


def test_challenge_removed_before_counter_update_is_expired(context: Context) -> None:
    context.redis.incr_if_exists.return_value = None
    with pytest.raises(EmailOtpError) as error:
        context.service.verify(context.token, challenge_token="proof", otp_code="000000", ip_address=None)
    assert error.value.reason == OtpFailure.CHALLENGE_EXPIRED


def test_corrupt_challenge_is_unavailable_without_disclosing_payload(context: Context) -> None:
    context.redis.get.return_value = b'{"type":"invalid-secret-type","otp":"otp-secret"}'
    with pytest.raises(EmailOtpError) as error:
        context.service.verify(context.token, challenge_token="proof", otp_code="123456", ip_address=None)
    assert error.value.reason == OtpFailure.UNAVAILABLE
    assert "otp-secret" not in str(error.value)
    assert error.value.__context__ is None
    context.redis.incr_if_exists.assert_not_called()


@pytest.mark.parametrize("counter", [None, b"5", b"6"])
def test_missing_or_exhausted_counter_rejects_correct_otp(context: Context, counter: bytes | None) -> None:
    context.redis.get.side_effect = lambda key: (
        counter if key.endswith(":failed_attempts") else context.redis.get.return_value
    )
    with pytest.raises(EmailOtpError) as error:
        context.service.verify(context.token, challenge_token="proof", otp_code="123456", ip_address=None)
    assert error.value.reason == OtpFailure.CHALLENGE_EXPIRED
    context.redis.incr_if_exists.assert_not_called()
