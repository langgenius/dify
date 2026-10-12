"""Deployment mail and shared Redis composition for public email proof."""

import logging
from smtplib import SMTPException

from python_http_client.exceptions import HTTPError
from requests.exceptions import RequestException
from resend.exceptions import ResendError

from core.db.session_factory import session_factory
from extensions.ext_mail import mail
from extensions.ext_redis import redis_client
from libs.helper import RateLimiter
from services.human_input_v2.email_otp_service import EmailOtpError, EmailOtpService, OtpFailure, OtpMail

logger = logging.getLogger(__name__)
_OTP_TEMPLATE = """<p>Use this verification code to submit your approval form:</p>
<p><strong>{code}</strong></p><p>This code expires in 10 minutes.</p>"""


def _send(email: str, otp: str) -> None:
    # Provider exceptions may contain secrets; expose only the OTP failure code.
    try:
        mail.send(
            to=email,
            subject="Verify your approval form submission",
            html=_OTP_TEMPLATE.format(code=otp),
        )
    except (SMTPException, OSError, HTTPError, ResendError, RequestException, ValueError):
        logger.warning("Human Input OTP mail delivery failed")
        raise EmailOtpError(OtpFailure.DELIVERY) from None


def build_email_otp_service() -> EmailOtpService:
    return EmailOtpService(
        session_factory=session_factory.create_session,
        redis=redis_client,
        limiter=RateLimiter(prefix="hitl:otp:sends", max_attempts=5, time_window=3600),
        mail=OtpMail(available=mail.is_inited, send=_send),
    )
