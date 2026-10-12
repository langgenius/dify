"""CI-only OTP behavior through the service with real Redis and migrated PostgreSQL."""

from __future__ import annotations

import runpy
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import timedelta
from hashlib import sha256
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from flask import Flask
from sqlalchemy import Engine, create_engine, delete, func, select, text
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.resolved_form import ResolvedForm
from core.human_input_v2.shared.values import ContactId, NormalizedEmail, TenantId
from core.workflow.nodes.human_input.enums import HumanInputFormKind
from core.workflow.nodes.human_input_v2.entities import OnetimeEmail
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from extensions.redis_names import serialize_redis_name
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
from services.human_input_v2.email_otp_service import EmailOtpError, EmailOtpService, OtpFailure, OtpMail, VerifiedEmail

pytestmark = pytest.mark.usefixtures("flask_app_with_containers")


def test_challenges_are_independent_and_fifth_mismatch_deletes_only_one(
    otp_case: OtpCase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("services.human_input_v2.email_otp_service.secrets.randbelow", lambda _bound: 1234)
    first_node, second_node = otp_case.service(), otp_case.service()
    first = first_node.request_access(otp_case.token)
    otp_case.release_cooldown()
    second = second_node.request_access(otp_case.token)
    assert otp_case.sent[0][1] == "001234"
    other_token = str(uuid4())
    with otp_case.sessions.begin() as session:
        SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=otp_case.form.tenant_id,
            form_id=otp_case.form.id,
            params=DeliveryCreateParams(
                recipient_id=otp_case.delivery.recipient_id,
                token_hash=sha256(other_token.encode()).hexdigest(),
                auth_type=SubmissionAuthType.EMAIL_OTP,
                target_snapshot=EmailTargetSnapshot(email_address="ci@example.com"),
            ),
        )
    with pytest.raises(EmailOtpError) as error:
        second_node.verify(other_token, challenge_token=first.challenge_token, otp_code="001234", ip_address=None)
    assert error.value.reason == OtpFailure.CHALLENGE_EXPIRED
    second_node.verify(otp_case.token, challenge_token=first.challenge_token, otp_code="001234", ip_address=None)
    for _ in range(4):
        with pytest.raises(EmailOtpError) as error:
            second_node.verify(otp_case.token, challenge_token=first.challenge_token, otp_code="1234", ip_address=None)
        assert error.value.reason == OtpFailure.INVALID
    first_node.verify(otp_case.token, challenge_token=first.challenge_token, otp_code="001234", ip_address=None)
    with pytest.raises(EmailOtpError) as error:
        first_node.verify(otp_case.token, challenge_token=first.challenge_token, otp_code="000000", ip_address=None)
    assert error.value.reason == OtpFailure.STALE
    assert not redis_client.exists(f"hitl:otp:challenge:{{{otp_case.delivery.id}:{first.challenge_token}}}")
    with pytest.raises(EmailOtpError) as error:
        second_node.verify(otp_case.token, challenge_token=first.challenge_token, otp_code="001234", ip_address=None)
    assert error.value.reason == OtpFailure.CHALLENGE_EXPIRED
    second_node.verify(otp_case.token, challenge_token=second.challenge_token, otp_code="001234", ip_address=None)


@pytest.mark.parametrize("otp_case", ["external_contact"], indirect=True)
def test_contact_email_change_does_not_consume_guesses(otp_case: OtpCase) -> None:
    service = otp_case.service()
    challenge = service.request_access(otp_case.token)
    with otp_case.sessions.begin() as session:
        profile = session.scalars(select(HumanInputExternalContactProfile)).one()
        profile.email = "changed@example.com"
    for _ in range(6):
        with pytest.raises(EmailOtpError) as error:
            service.verify(
                otp_case.token, challenge_token=challenge.challenge_token, otp_code=otp_case.sent[0][1], ip_address=None
            )
        assert error.value.reason == OtpFailure.STALE
    with otp_case.sessions.begin() as session:
        profile = session.scalars(select(HumanInputExternalContactProfile)).one()
        profile.email = "ci@example.com"
    service.verify(
        otp_case.token, challenge_token=challenge.challenge_token, otp_code=otp_case.sent[0][1], ip_address=None
    )


def test_concurrent_guesses_cannot_exceed_budget(otp_case: OtpCase) -> None:
    service = otp_case.service()
    challenge = service.request_access(otp_case.token)
    barrier = Barrier(12)

    def guess(_: int) -> OtpFailure:
        barrier.wait()
        try:
            service.verify(
                otp_case.token, challenge_token=challenge.challenge_token, otp_code="wrong-code", ip_address=None
            )
        except EmailOtpError as error:
            return error.reason
        pytest.fail("An incorrect code was accepted")

    with ThreadPoolExecutor(max_workers=12) as executor:
        results = list(executor.map(guess, range(12)))
    assert results.count(OtpFailure.INVALID) == 4
    assert results.count(OtpFailure.STALE) == 1
    assert results.count(OtpFailure.CHALLENGE_EXPIRED) == 7


def test_concurrent_sends_consume_one_slot_and_rejections_do_not_count() -> None:
    limiter = RateLimiter(prefix=f"otp-test:{uuid4()}", max_attempts=5, time_window=3600)
    barrier = Barrier(12)

    def acquire(_: int) -> int:
        barrier.wait()
        return limiter.acquire("delivery", cooldown_seconds=60)

    with ThreadPoolExecutor(max_workers=12) as executor:
        results = list(executor.map(acquire, range(12)))
    assert results.count(0) == 1
    assert all(0 < wait <= 60 for wait in results if wait)
    assert redis_client.zcard(f"{limiter.prefix}:delivery") == 1
    assert limiter.acquire("other-delivery", cooldown_seconds=60) == 0
    redis_client.delete(f"{limiter.prefix}:delivery", f"{limiter.prefix}:other-delivery")


def test_hourly_window_and_cooldown_return_combined_delay() -> None:
    limiter = RateLimiter(prefix=f"otp-test:{uuid4()}", max_attempts=5, time_window=3600)
    key = serialize_redis_name(f"{limiter.prefix}:delivery")
    # Redis controls time; seed recent history without waiting an hour in CI.
    redis_client.eval(
        """
        local now = tonumber(redis.call('TIME')[1])
        for i = 0, 4 do redis.call('ZADD', KEYS[1], now - 300 + i * 60, tostring(i)) end
        redis.call('EXPIRE', KEYS[1], 3600)
    """,
        1,
        key,
    )
    assert 3298 <= limiter.acquire("delivery", cooldown_seconds=60) <= 3300
    assert redis_client.zcard(f"{limiter.prefix}:delivery") == 5
    redis_client.delete(f"{limiter.prefix}:delivery")


def test_verification_does_not_refresh_ttl(otp_case: OtpCase) -> None:
    service = otp_case.service()
    challenge = service.request_access(otp_case.token)
    key = f"hitl:otp:challenge:{{{otp_case.delivery.id}:{challenge.challenge_token}}}"
    redis_client.expire(key, 20)
    with pytest.raises(EmailOtpError) as error:
        service.verify(
            otp_case.token, challenge_token=challenge.challenge_token, otp_code="wrong-code", ip_address=None
        )
    assert error.value.reason == OtpFailure.INVALID
    assert 0 < redis_client.ttl(key) <= 20
    redis_client.expire(key, 0)
    with pytest.raises(EmailOtpError) as error:
        service.verify(
            otp_case.token, challenge_token=challenge.challenge_token, otp_code=otp_case.sent[0][1], ip_address=None
        )
    assert error.value.reason == OtpFailure.CHALLENGE_EXPIRED


@dataclass
class OtpCase:
    sessions: sessionmaker[Session]
    form: Form
    delivery: Delivery
    token: str
    limiter: RateLimiter
    sent: list[tuple[str, str]]

    def service(self, send: Callable[[str, str], None] | None = None) -> EmailOtpService:
        return EmailOtpService(
            session_factory=self.sessions,
            redis=redis_client,
            limiter=self.limiter,
            mail=OtpMail(available=lambda: True, send=send or (lambda email, code: self.sent.append((email, code)))),
        )

    def release_cooldown(self) -> None:
        # Move the successful-send history beyond its minute cooldown without
        # changing the challenge TTL or discarding the hourly send budget.
        key = serialize_redis_name(f"{self.limiter.prefix}:{self.delivery.id}")
        redis_client.eval(
            """
            local now = tonumber(redis.call('TIME')[1])
            local members = redis.call('ZRANGE', KEYS[1], 0, -1)
            for _, member in ipairs(members) do redis.call('ZADD', KEYS[1], now - 61, member) end
        """,
            1,
            key,
        )


@pytest.fixture
def migrated_otp_engine(flask_app_with_containers: Flask) -> Iterator[Engine]:
    # Business acceptance uses the migration-created schema rather than letting
    # metadata.create_all conceal a missing production table or column.
    with flask_app_with_containers.app_context():
        admin_engine = db.engine
    schema = "otp_" + uuid4().hex
    with admin_engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(admin_engine.url, connect_args={"options": f"-csearch_path={schema},public"})
    try:
        # App and Tenant are unrelated prerequisites already migrated by Dify.
        for model in (
            Tenant,
            App,
            Account,
            TenantAccountJoin,
            HumanInputContactIdentity,
            HumanInputExternalContactProfile,
            HumanInputPlatformContactWorkspaceEntry,
        ):
            model.metadata.tables[model.__tablename__].create(engine)
        migrations = Path(__file__).resolve().parents[3] / "migrations" / "versions"
        names = (
            "2026_09_09_1200-a7c9e1f3b5d8_add_human_input_v2_forms.py",
            "2026_09_10_1200-b8d0f2a4c6e9_add_human_input_v2_recipients.py",
            "2026_09_21_1200-f3c5e7a9b1d2_add_human_input_v2_delivery_runtime.py",
            "2026_09_23_1200-a8d2f4b6c0e3_add_human_input_v2_audit_events.py",
        )
        with engine.begin() as connection, Operations.context(MigrationContext.configure(connection)):
            for name in names:
                migration = runpy.run_path(str(migrations / name))
                migration["upgrade"]()
        yield engine
    finally:
        engine.dispose()
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


@pytest.fixture(params=["email", "external_contact"])
def otp_case(migrated_otp_engine: Engine, request: pytest.FixtureRequest) -> Iterator[OtpCase]:
    engine = migrated_otp_engine
    sessions = sessionmaker(engine, expire_on_commit=False)
    tenant_id, app_id, token = TenantId(str(uuid4())), str(uuid4()), str(uuid4())
    now = naive_utc_now()
    with sessions.begin() as session:
        tenant = Tenant(name="OTP CI")
        tenant.id = tenant_id
        session.add(tenant)
        session.add(
            App(id=app_id, tenant_id=tenant_id, name="OTP CI", mode=AppMode.WORKFLOW, enable_site=True, enable_api=True)
        )
        session.flush()
        form = SQLAlchemyFormRepository(session, tenant_id, app_id).create_form(
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
                tenant_id,
                ExternalContact(
                    id=ContactId(str(uuid4())),
                    name="CI approver",
                    email="ci@example.com",
                    avatar_file_id=None,
                    created_at=now,
                ),
            )
            subject = ContactRecipientSubject(contact.id)
        else:
            subject = EmailRecipientSubject(NormalizedEmail("ci@example.com"))
        recipient = SQLAlchemyRecipientRepository(session, tenant_id, form.id).create_recipients(
            [
                RecipientCreateParams(
                    subject=subject,
                    sources=(OnetimeEmail(email="ci@example.com"),),
                    name=None,
                )
            ]
        )[0]
        delivery = SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=tenant_id,
            form_id=form.id,
            params=DeliveryCreateParams(
                recipient_id=recipient.id,
                token_hash=sha256(token.encode()).hexdigest(),
                auth_type=SubmissionAuthType.EMAIL_OTP,
                target_snapshot=EmailTargetSnapshot(email_address="ci@example.com"),
            ),
        )
    limiter = RateLimiter(prefix=f"otp-ci:{uuid4()}", max_attempts=5, time_window=3600)
    try:
        yield OtpCase(sessions, form, delivery, token, limiter, [])
    finally:
        # Remove all test-issued challenges without adding a production list API.
        pattern = serialize_redis_name(f"hitl:otp:challenge:{{{delivery.id}:*")
        for key in redis_client.scan_iter(match=pattern):
            redis_client.delete(key)
        redis_client.delete(f"{limiter.prefix}:{delivery.id}")
        with sessions.begin() as session:
            for model in (HumanInputAuditEvent, HumanInputDelivery, HumanInputRecipient):
                session.execute(delete(model).where(model.form_id == form.id))
            session.execute(delete(HumanInputForm).where(HumanInputForm.id == form.id))
            session.execute(delete(App).where(App.id == app_id))
            session.execute(delete(Tenant).where(Tenant.id == tenant_id))


def test_verified_challenges_accept_one_form_on_postgres(otp_case: OtpCase) -> None:
    delivery, form, token = otp_case.delivery, otp_case.form, otp_case.token
    sessions = otp_case.sessions
    tenant_id, app_id, recipient_id = form.tenant_id, form.app_id, delivery.recipient_id
    service = otp_case.service()
    challenges = [service.request_access(token)]
    otp_case.release_cooldown()
    challenges.append(service.request_access(token))
    proofs = [
        service.verify(token, challenge_token=challenge.challenge_token, otp_code=sent[1], ip_address=None)
        for challenge, sent in zip(challenges, otp_case.sent, strict=True)
    ]
    barrier = Barrier(2)

    def submit(proof: VerifiedEmail) -> Form | FormSubmissionFailure:
        barrier.wait()
        with sessions.begin() as session:
            result = SQLAlchemyFormRepository(session, tenant_id, app_id).submit_form(
                form.id,
                submitted_by_recipient_id=recipient_id,
                selected_action_id="approve",
                raw_submission_inputs={},
                normalized_submission_data={},
            )
            if isinstance(result, Form):
                proof.add_submission_audit(session, ip_address=None)
            return result

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(submit, proofs))
    assert sum(isinstance(result, Form) for result in results) == 1
    assert results.count(FormSubmissionFailure.ALREADY_SUBMITTED) == 1
    with sessions() as session:
        assert (
            session.scalar(
                select(func.count()).select_from(HumanInputAuditEvent).where(HumanInputAuditEvent.form_id == form.id)
            )
            == 1
        )


def test_lost_response_and_failed_resend_preserve_earlier_proof_and_budget(otp_case: OtpCase) -> None:
    service = otp_case.service()
    first = service.request_access(otp_case.token)
    first_code = otp_case.sent[0][1]
    otp_case.release_cooldown()
    service.request_access(otp_case.token)  # The browser loses this successful response.
    assert (
        service.verify(
            otp_case.token, challenge_token=first.challenge_token, otp_code=first_code, ip_address=None
        ).delivery.id
        == otp_case.delivery.id
    )
    otp_case.release_cooldown()

    def fail(_email: str, _code: str) -> None:
        raise EmailOtpError(OtpFailure.DELIVERY)

    with pytest.raises(EmailOtpError) as error:
        otp_case.service(fail).request_access(otp_case.token)
    assert error.value.reason == OtpFailure.DELIVERY
    assert error.value.retry_after is not None
    assert error.value.retry_after > 0
    service.verify(otp_case.token, challenge_token=first.challenge_token, otp_code=first_code, ip_address=None)
    assert redis_client.zcard(f"{otp_case.limiter.prefix}:{otp_case.delivery.id}") == 3
    pattern = serialize_redis_name(f"hitl:otp:challenge:{{{otp_case.delivery.id}:*")
    assert len(list(redis_client.scan_iter(match=pattern))) == 4


def test_older_mail_finishing_last_does_not_replace_newer_challenge(otp_case: OtpCase) -> None:
    from threading import Event

    started, release = Event(), Event()
    first_code = []

    def slow_send(_email: str, code: str) -> None:
        first_code.append(code)
        started.set()
        assert release.wait(10)

    with ThreadPoolExecutor(max_workers=1) as executor:
        older = executor.submit(otp_case.service(slow_send).request_access, otp_case.token)
        assert started.wait(10)
        try:
            otp_case.release_cooldown()
            newer = otp_case.service().request_access(otp_case.token)
        finally:
            release.set()
        first = older.result(timeout=10)
    service = otp_case.service()
    service.verify(otp_case.token, challenge_token=first.challenge_token, otp_code=first_code[0], ip_address=None)
    service.verify(otp_case.token, challenge_token=newer.challenge_token, otp_code=otp_case.sent[0][1], ip_address=None)


def test_hourly_slot_recovers_without_discarding_recent_sends() -> None:
    limiter = RateLimiter(prefix=f"otp-test:{uuid4()}", max_attempts=5, time_window=3600)
    key = serialize_redis_name(f"{limiter.prefix}:delivery")
    redis_client.eval(
        """
        local now = tonumber(redis.call('TIME')[1])
        redis.call('ZADD', KEYS[1], now - 3600, 'boundary')
        for i = 1, 4 do redis.call('ZADD', KEYS[1], now - 300 + i * 30, tostring(i)) end
        redis.call('EXPIRE', KEYS[1], 3600)
    """,
        1,
        key,
    )
    assert limiter.acquire("delivery", cooldown_seconds=60) == 0
    assert redis_client.zcard(f"{limiter.prefix}:delivery") == 5
    assert limiter.retry_after("delivery", cooldown_seconds=60) > 60
    redis_client.delete(f"{limiter.prefix}:delivery")
