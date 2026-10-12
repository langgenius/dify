"""Issue and verify email proof; Submission owns accepting the form and success audit."""

import logging
import secrets
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from hashlib import sha256
from typing import Annotated, Literal

import sqlalchemy as sa
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
from redis.exceptions import RedisError
from sqlalchemy.orm import Session

from core.human_input_v2.shared.values import TenantId
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from extensions.ext_redis import RedisClientWrapper
from extensions.redis_names import serialize_redis_name
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from libs.helper import RateLimiter
from models.human_input_v2 import HumanInputAuditEvent, HumanInputForm, OtpVerificationEvent
from models.model import App
from models.workflow import WorkflowRun
from repositories.human_input_v2.contact import ContactType
from repositories.human_input_v2.delivery_repository import Delivery, EmailTargetSnapshot, SubmissionAuthType
from repositories.human_input_v2.recipient_repository import ContactRecipientSubject, EmailRecipientSubject
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_recipient_repository import SQLAlchemyRecipientRepository

logger = logging.getLogger(__name__)
_COOLDOWN_SECONDS = 60


class EmailSubject(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: Literal["email"] = "email"
    email: str


class ExternalContactSubject(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: Literal["external_contact"] = "external_contact"
    contact_id: str
    email: str


type EmailOtpSubject = Annotated[EmailSubject | ExternalContactSubject, Field(discriminator="type")]


class EmailChallenge(EmailSubject):
    otp: str = Field(repr=False)


class ExternalContactChallenge(ExternalContactSubject):
    otp: str = Field(repr=False)


type EmailOtpChallenge = Annotated[EmailChallenge | ExternalContactChallenge, Field(discriminator="type")]


class VerificationStatus(StrEnum):
    VERIFIED = "verified"
    INVALID = "invalid"
    STALE = "stale"
    EXPIRED = "expired"


_CHALLENGE_TTL_SECONDS = 600
_MAX_FAILED_ATTEMPTS = 5

_CHALLENGE_ADAPTER = TypeAdapter(EmailOtpChallenge)
_COUNTER_ADAPTER = TypeAdapter(Annotated[int, Field(ge=0)])


class OtpFailure(StrEnum):
    NOT_FOUND = "human_input_form_not_found"
    EXPIRED = "human_input_form_expired"
    SUBMITTED = "human_input_form_submitted"
    RATE_LIMIT = "human_input_access_rate_limit_exceeded"
    DELIVERY = "human_input_access_delivery_failed"
    UNAVAILABLE = "human_input_v2_unavailable"
    INVALID = "human_input_invalid_otp"
    STALE = "human_input_challenge_stale"
    CHALLENGE_EXPIRED = "human_input_challenge_expired"


class EmailOtpError(Exception):
    def __init__(self, reason: OtpFailure, retry_after: int | None = None) -> None:
        super().__init__(reason.value)
        self.reason = reason
        self.retry_after = retry_after


class AccessChallenge(BaseModel):
    challenge_token: str = Field(repr=False)
    expires_in_seconds: int
    resend_after_seconds: int


@dataclass(frozen=True)
class VerifiedEmail:
    delivery: Delivery
    subject: EmailOtpSubject
    # The app owner resolved while verifying the delivery, never supplied by the client.
    app_id: str
    challenge_token: str = field(repr=False)

    def add_submission_audit(self, session: Session, *, ip_address: str | None) -> None:
        """Call only after accepting FormSubmission, in that same caller-owned transaction."""
        _add_audit(session, self.delivery, self.subject.email, ip_address, succeeded=True, reason="submitted")


@dataclass(frozen=True)
class OtpMail:
    available: Callable[[], bool]
    send: Callable[[str, str], None] = field(repr=False)


def _add_audit(
    session: Session, delivery: Delivery, email: str, ip_address: str | None, *, succeeded: bool, reason: str
) -> None:
    session.add(
        HumanInputAuditEvent(
            tenant_id=delivery.tenant_id,
            form_id=delivery.form_id,
            payload=OtpVerificationEvent(
                recipient_id=delivery.recipient_id,
                recipient_email=email,
                submitter_ip_address=ip_address,
                succeeded=succeeded,
                reason=reason,
            ),
        )
    )


class EmailOtpService:
    def __init__(
        self,
        *,
        session_factory: Callable[[], Session],
        redis: RedisClientWrapper,
        limiter: RateLimiter,
        mail: OtpMail,
    ) -> None:
        self._sessions = session_factory
        self._redis = redis
        self._limiter = limiter
        self._mail = mail

    def request_access(self, form_token: str) -> AccessChallenge:
        delivery, subject, _ = self._authorize(form_token)
        if not self._mail.available():
            raise EmailOtpError(OtpFailure.UNAVAILABLE)
        try:
            wait = self._limiter.acquire(delivery.id, cooldown_seconds=_COOLDOWN_SECONDS)
            if wait:
                raise EmailOtpError(OtpFailure.RATE_LIMIT, wait)
            token = secrets.token_urlsafe(32)
            otp = f"{secrets.randbelow(1_000_000):06d}"
            if isinstance(subject, ExternalContactSubject):
                challenge = ExternalContactChallenge(contact_id=subject.contact_id, email=subject.email, otp=otp)
            else:
                challenge = EmailChallenge(email=subject.email, otp=otp)
            self._create_challenge(delivery.id, token, challenge)
        except RedisError:
            raise EmailOtpError(OtpFailure.UNAVAILABLE) from None
        # Authorization transaction is already closed before external I/O.
        try:
            self._mail.send(subject.email, otp)
        except EmailOtpError:
            self.cleanup(delivery.id, token)
            raise EmailOtpError(OtpFailure.DELIVERY, self._retry_after(delivery.id)) from None
        try:
            remaining = self._challenge_remaining_seconds(delivery.id, token)
            if remaining <= 0:
                raise EmailOtpError(OtpFailure.CHALLENGE_EXPIRED)
            return AccessChallenge(
                challenge_token=token,
                expires_in_seconds=remaining,
                resend_after_seconds=self._retry_after(delivery.id),
            )
        except RedisError:
            raise EmailOtpError(OtpFailure.UNAVAILABLE) from None

    def verify(
        self, form_token: str, *, challenge_token: str | None, otp_code: str | None, ip_address: str | None
    ) -> VerifiedEmail:
        delivery, subject, app_id = self._authorize(form_token, submitting=True, ip_address=ip_address)
        reason = None
        if not challenge_token or not otp_code:
            reason = OtpFailure.INVALID
        else:
            try:
                status = self._verify_challenge(delivery.id, challenge_token, subject, otp_code)
            except (RedisError, ValidationError):
                reason = OtpFailure.UNAVAILABLE
            else:
                match status:
                    case VerificationStatus.VERIFIED:
                        return VerifiedEmail(delivery, subject, app_id, challenge_token)
                    case VerificationStatus.INVALID:
                        reason = OtpFailure.INVALID
                    case VerificationStatus.STALE:
                        reason = OtpFailure.STALE
                    case VerificationStatus.EXPIRED:
                        reason = OtpFailure.CHALLENGE_EXPIRED
        assert reason is not None
        with self._sessions() as session, session.begin():
            _add_audit(session, delivery, subject.email, ip_address, succeeded=False, reason=reason.value)
        raise EmailOtpError(reason)

    def cleanup(self, delivery_id: str, challenge_token: str) -> None:
        """Best effort after commit or a failed send; never affects another challenge."""
        try:
            key = self._challenge_key(delivery_id, challenge_token)
            self._redis.delete(key, self._counter_key(key))
        except RedisError:
            # Redis errors can embed command arguments; do not log the exception.
            logger.warning("OTP cleanup failed: delivery_id=%s", delivery_id)

    @staticmethod
    def _challenge_key(delivery_id: str, token: str) -> str:
        # Keep the payload and counter in the same Redis Cluster slot.
        return "hitl:otp:challenge:{" + delivery_id + ":" + token + "}"

    @staticmethod
    def _counter_key(challenge_key: str) -> str:
        return f"{challenge_key}:failed_attempts"

    def _create_challenge(self, delivery_id: str, token: str, challenge: EmailOtpChallenge) -> None:
        # Publish the JSON and zero counter with their TTLs in one transaction.
        # Raw pipelines require physical names, unlike RedisClientWrapper commands.
        key = self._challenge_key(delivery_id, token)
        with self._redis.pipeline(transaction=True) as pipeline:
            pipeline.set(serialize_redis_name(key), challenge.model_dump_json(), ex=_CHALLENGE_TTL_SECONDS)
            pipeline.set(serialize_redis_name(self._counter_key(key)), 0, ex=_CHALLENGE_TTL_SECONDS)
            pipeline.execute()

    def _verify_challenge(self, delivery_id: str, token: str, subject: EmailOtpSubject, otp: str) -> VerificationStatus:
        key = self._challenge_key(delivery_id, token)
        raw = self._redis.get(key)
        if raw is None:
            return VerificationStatus.EXPIRED
        counter_key = self._counter_key(key)
        raw_count = self._redis.get(counter_key)
        if raw_count is None or _COUNTER_ADAPTER.validate_json(raw_count) >= _MAX_FAILED_ATTEMPTS:
            return VerificationStatus.EXPIRED
        challenge = _CHALLENGE_ADAPTER.validate_json(raw)
        if challenge.type != subject.type or challenge.email != subject.email:
            return VerificationStatus.STALE
        if isinstance(challenge, ExternalContactChallenge) and (
            not isinstance(subject, ExternalContactSubject) or challenge.contact_id != subject.contact_id
        ):
            return VerificationStatus.STALE
        # A matching code is valid at these reads, even if another request later
        # removes the challenge. Counter exhaustion also blocks pending cleanup.
        if challenge.otp == otp:
            return VerificationStatus.VERIFIED
        failures = self._redis.incr_if_exists(counter_key)
        if failures is None:
            return VerificationStatus.EXPIRED
        if failures >= _MAX_FAILED_ATTEMPTS:
            self._redis.delete(key, counter_key)
            return VerificationStatus.STALE if failures == _MAX_FAILED_ATTEMPTS else VerificationStatus.EXPIRED
        return VerificationStatus.INVALID

    def _challenge_remaining_seconds(self, delivery_id: str, token: str) -> int:
        remaining = self._redis.ttl(self._challenge_key(delivery_id, token))
        if not isinstance(remaining, int):
            raise ValueError("Invalid Redis TTL response")
        return max(0, remaining)

    def _retry_after(self, delivery_id: str) -> int:
        try:
            return self._limiter.retry_after(delivery_id, cooldown_seconds=_COOLDOWN_SECONDS)
        except RedisError:
            raise EmailOtpError(OtpFailure.UNAVAILABLE) from None

    def _authorize(
        self, form_token: str, *, submitting: bool = False, ip_address: str | None = None
    ) -> tuple[Delivery, EmailOtpSubject, str]:
        """Return the delivery, email subject, and resolved app ID."""
        with self._sessions() as session:
            delivery = SQLAlchemyDeliveryRepository(session).get_delivery_by_token_hash(
                sha256(form_token.encode()).hexdigest()
            )
            if delivery is None or delivery.auth_type != SubmissionAuthType.EMAIL_OTP:
                raise EmailOtpError(OtpFailure.NOT_FOUND)
            if not isinstance(delivery.target_snapshot, EmailTargetSnapshot):
                raise EmailOtpError(OtpFailure.NOT_FOUND)
            form = session.scalar(
                sa.select(HumanInputForm)
                .join(App, App.id == HumanInputForm.app_id)
                .where(
                    HumanInputForm.id == delivery.form_id,
                    HumanInputForm.tenant_id == delivery.tenant_id,
                    App.tenant_id == delivery.tenant_id,
                )
            )
            if form is None:
                raise EmailOtpError(OtpFailure.NOT_FOUND)
            if form.status == HumanInputFormStatus.SUBMITTED:
                raise EmailOtpError(OtpFailure.SUBMITTED)
            now = naive_utc_now()
            if (
                form.status != HumanInputFormStatus.WAITING
                or form.expiration_time <= now
                or form.global_timeout_deadline <= now
            ):
                raise EmailOtpError(OtpFailure.EXPIRED)
            if form.workflow_run_id is not None:
                run = session.scalar(
                    sa.select(WorkflowRun).where(
                        WorkflowRun.id == form.workflow_run_id,
                        WorkflowRun.tenant_id == delivery.tenant_id,
                        WorkflowRun.app_id == form.app_id,
                    )
                )
                if run is None or run.status not in (WorkflowExecutionStatus.RUNNING, WorkflowExecutionStatus.PAUSED):
                    raise EmailOtpError(OtpFailure.EXPIRED)
            recipient = SQLAlchemyRecipientRepository(session, TenantId(delivery.tenant_id), form.id).get_recipient(
                delivery.recipient_id
            )
            if recipient is None:
                raise EmailOtpError(OtpFailure.NOT_FOUND)
            address = delivery.target_snapshot.email_address
            match recipient.subject:
                case EmailRecipientSubject(email):
                    if email.value != address:
                        if submitting:
                            _add_audit(
                                session, delivery, address, ip_address, succeeded=False, reason=OtpFailure.STALE.value
                            )
                            session.commit()
                        raise EmailOtpError(OtpFailure.STALE if submitting else OtpFailure.NOT_FOUND)
                    return delivery, EmailSubject(email=address), form.app_id
                case ContactRecipientSubject(contact_id):
                    contact = SQLAlchemyContactRepository(session).get_contacts_by_id(delivery.tenant_id, contact_id)
                    if contact is None or contact.type != ContactType.EXTERNAL:
                        raise EmailOtpError(OtpFailure.NOT_FOUND)
                    if contact.email != address:
                        if submitting:
                            _add_audit(
                                session, delivery, address, ip_address, succeeded=False, reason=OtpFailure.STALE.value
                            )
                            session.commit()
                        raise EmailOtpError(OtpFailure.STALE if submitting else OtpFailure.NOT_FOUND)
                    return delivery, ExternalContactSubject(contact_id=contact_id, email=address), form.app_id
                case _:
                    raise EmailOtpError(OtpFailure.NOT_FOUND)
