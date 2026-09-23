"""CI-only acceptance of the real Redis scripts, including simultaneous callers."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest

from extensions.ext_redis import redis_client
from extensions.redis_names import serialize_redis_name
from libs.helper import RateLimiter
from repositories.human_input_v2.email_otp_repository import (
    EmailChallenge,
    EmailSubject,
    ExternalContactChallenge,
    ExternalContactSubject,
    VerificationStatus,
)
from repositories.human_input_v2.redis_email_otp_repository import RedisEmailOtpRepository

pytestmark = pytest.mark.usefixtures("flask_app_with_containers")


@pytest.mark.parametrize("external", [False, True])
def test_challenges_are_independent_and_fifth_mismatch_deletes_only_one(external):
    first, second = RedisEmailOtpRepository(redis_client), RedisEmailOtpRepository(redis_client)
    delivery = str(uuid4())
    if external:
        subject = ExternalContactSubject(contact_id=str(uuid4()), email="approver@example.com")
        challenge = ExternalContactChallenge(contact_id=subject.contact_id, email=subject.email, otp="001234")
    else:
        subject = EmailSubject(email="approver@example.com")
        challenge = EmailChallenge(email=subject.email, otp="001234")
    first.create(delivery, "first", challenge)
    second.create(delivery, "second", challenge)
    assert first.remaining_seconds(delivery, "first") <= 600
    assert second.verify(delivery, "first", subject, "001234") == VerificationStatus.VERIFIED
    assert first.verify("different-delivery", "first", subject, "001234") == VerificationStatus.EXPIRED
    for _ in range(4):
        assert second.verify(delivery, "first", subject, "1234") == VerificationStatus.INVALID
    # Successful verification neither resets guesses nor consumes proof.
    assert first.verify(delivery, "first", subject, "001234") == VerificationStatus.VERIFIED
    assert first.verify(delivery, "first", subject, "000000") == VerificationStatus.STALE
    assert not redis_client.exists(f"hitl:otp:challenge:{delivery}:first")
    assert second.verify(delivery, "first", subject, "001234") == VerificationStatus.EXPIRED
    assert second.verify(delivery, "second", subject, "001234") == VerificationStatus.VERIFIED
    second.delete(delivery, "second")


def test_contact_identity_and_email_mismatch_do_not_consume_guesses():
    store = RedisEmailOtpRepository(redis_client)
    delivery = str(uuid4())
    subject = ExternalContactSubject(contact_id="original", email="approver@example.com")
    store.create(delivery, "challenge", ExternalContactChallenge(**subject.model_dump(), otp="001234"))
    for _ in range(6):
        replacement = ExternalContactSubject(contact_id="replacement", email=subject.email)
        assert store.verify(delivery, "challenge", replacement, "001234") == VerificationStatus.STALE
    assert store.verify(delivery, "challenge", subject, "001234") == VerificationStatus.VERIFIED
    store.delete(delivery, "challenge")


def test_concurrent_guesses_cannot_exceed_budget():
    store = RedisEmailOtpRepository(redis_client)
    delivery = str(uuid4())
    subject = EmailSubject(email="approver@example.com")
    store.create(delivery, "challenge", EmailChallenge(email=subject.email, otp="001234"))
    barrier = Barrier(12)

    def guess(_):
        barrier.wait()
        return store.verify(delivery, "challenge", subject, "000000")

    with ThreadPoolExecutor(max_workers=12) as executor:
        results = list(executor.map(guess, range(12)))
    assert results.count(VerificationStatus.INVALID) == 4
    assert results.count(VerificationStatus.STALE) == 1
    assert results.count(VerificationStatus.EXPIRED) == 7


def test_concurrent_sends_consume_one_slot_and_rejections_do_not_count():
    limiter = RateLimiter(prefix=f"otp-test:{uuid4()}", max_attempts=5, time_window=3600)
    barrier = Barrier(12)

    def acquire(_):
        barrier.wait()
        return limiter.acquire("delivery", cooldown_seconds=60)

    with ThreadPoolExecutor(max_workers=12) as executor:
        results = list(executor.map(acquire, range(12)))
    assert results.count(0) == 1
    assert all(0 < wait <= 60 for wait in results if wait)
    assert redis_client.zcard(f"{limiter.prefix}:delivery") == 1
    assert limiter.acquire("other-delivery", cooldown_seconds=60) == 0
    redis_client.delete(f"{limiter.prefix}:delivery", f"{limiter.prefix}:other-delivery")


def test_hourly_window_and_cooldown_return_combined_delay():
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


def test_verification_does_not_refresh_ttl():
    store = RedisEmailOtpRepository(redis_client)
    delivery = str(uuid4())
    subject = EmailSubject(email="approver@example.com")
    store.create(delivery, "challenge", EmailChallenge(email=subject.email, otp="001234"))
    key = f"hitl:otp:challenge:{delivery}:challenge"
    redis_client.expire(key, 20)
    assert store.verify(delivery, "challenge", subject, "000000") == VerificationStatus.INVALID
    assert 0 < store.remaining_seconds(delivery, "challenge") <= 20
    redis_client.expire(key, 0)
    assert store.verify(delivery, "challenge", subject, "001234") == VerificationStatus.EXPIRED


def test_verified_challenges_accept_one_form_on_postgres(flask_app_with_containers):
    from datetime import timedelta
    from hashlib import sha256

    from sqlalchemy import delete, func, select
    from sqlalchemy.orm import sessionmaker

    from core.human_input_v2.resolved_form import ResolvedForm
    from core.human_input_v2.shared.values import NormalizedEmail, TenantId
    from core.workflow.nodes.human_input.enums import HumanInputFormKind
    from core.workflow.nodes.human_input_v2.entities import OnetimeEmail
    from extensions.ext_database import db
    from libs.datetime_utils import naive_utc_now
    from models.account import Tenant
    from models.human_input_v2 import HumanInputAuditEvent, HumanInputDelivery, HumanInputForm, HumanInputRecipient
    from models.model import App, AppMode
    from repositories.human_input_v2.delivery_repository import (
        DeliveryCreateParams,
        EmailTargetSnapshot,
        SubmissionAuthType,
    )
    from repositories.human_input_v2.form_repository import Form, FormCreateParams, FormSubmissionFailure
    from repositories.human_input_v2.recipient_repository import EmailRecipientSubject, RecipientCreateParams
    from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
    from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
    from repositories.human_input_v2.sqlalchemy_recipient_repository import SQLAlchemyRecipientRepository
    from services.human_input_v2.email_otp_service import EmailOtpService, OtpMail

    with flask_app_with_containers.app_context():
        engine = db.engine
    # Delivery/audit migrations are owned by the separate runtime change. This
    # acceptance fixture exercises their existing models on the CI database.
    for model in (HumanInputForm, HumanInputRecipient, HumanInputDelivery, HumanInputAuditEvent):
        model.__table__.create(engine, checkfirst=True)
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
        recipient = SQLAlchemyRecipientRepository(session, tenant_id, form.id).create_recipients(
            [
                RecipientCreateParams(
                    subject=EmailRecipientSubject(NormalizedEmail("ci@example.com")),
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
    store = RedisEmailOtpRepository(redis_client)
    service = EmailOtpService(
        session_factory=sessions,
        challenges=store,
        limiter=RateLimiter(prefix="otp-ci", max_attempts=5, time_window=3600),
        mail=OtpMail(available=lambda: False, send=lambda _email, _code: None),
    )
    try:
        for challenge_token in ("first", "second"):
            store.create(delivery.id, challenge_token, EmailChallenge(email="ci@example.com", otp="001234"))
        proofs = [
            service.verify(token, challenge_token=challenge_token, otp_code="001234", ip_address=None)
            for challenge_token in ("first", "second")
        ]
        barrier = Barrier(2)

        def submit(proof):
            barrier.wait()
            with sessions.begin() as session:
                result = SQLAlchemyFormRepository(session, tenant_id, app_id).submit_form(
                    form.id,
                    submitted_by_recipient_id=recipient.id,
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
                    select(func.count())
                    .select_from(HumanInputAuditEvent)
                    .where(HumanInputAuditEvent.form_id == form.id)
                )
                == 1
            )
    finally:
        for challenge_token in ("first", "second"):
            store.delete(delivery.id, challenge_token)
        with sessions.begin() as session:
            for model in (HumanInputAuditEvent, HumanInputDelivery, HumanInputRecipient):
                session.execute(delete(model).where(model.form_id == form.id))
            session.execute(delete(HumanInputForm).where(HumanInputForm.id == form.id))
            session.execute(delete(App).where(App.id == app_id))
            session.execute(delete(Tenant).where(Tenant.id == tenant_id))
