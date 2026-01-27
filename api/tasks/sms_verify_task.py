import logging
import time

import click
from celery import shared_task

from extensions.ext_sms import sms

logger = logging.getLogger(__name__)


@shared_task(queue="mail")
def send_phone_verification_code_task(phone_number: str) -> dict | None:
    """
    Send phone verification code via Plivo Verify API.

    This task uses the Plivo Verify API to send an OTP to the specified phone number.
    The OTP is generated and managed by Plivo, so we only need to track the session_uuid.

    Args:
        phone_number: The phone number to send the verification code to (E.164 format)

    Returns:
        dict containing session_uuid if successful, None otherwise
    """
    if not sms.is_inited() or not sms.is_verify_enabled():
        logger.warning("Plivo SMS client is not initialized or verify is not enabled")
        return None

    logger.info(click.style(f"Start sending phone verification code to {phone_number}", fg="green"))
    start_at = time.perf_counter()

    try:
        result = sms.send_verification_code(phone_number)

        end_at = time.perf_counter()
        logger.info(
            click.style(
                f"Send phone verification code to {phone_number} succeeded: "
                f"session_uuid: {result.get('session_uuid')}, latency: {end_at - start_at:.3f}s",
                fg="green",
            )
        )
        return result
    except Exception:
        logger.exception("Send phone verification code to %s failed", phone_number)
        return None


@shared_task(queue="mail")
def verify_phone_code_task(session_uuid: str, otp: str) -> bool:
    """
    Verify phone verification code via Plivo Verify API.

    This task uses the Plivo Verify API to validate the OTP entered by the user.

    Args:
        session_uuid: The session UUID from the send verification response
        otp: The OTP code entered by the user

    Returns:
        True if verification is successful, False otherwise
    """
    if not sms.is_inited() or not sms.is_verify_enabled():
        logger.warning("Plivo SMS client is not initialized or verify is not enabled")
        return False

    logger.info(click.style(f"Start verifying phone code for session {session_uuid}", fg="green"))
    start_at = time.perf_counter()

    try:
        result = sms.verify_code(session_uuid, otp)

        end_at = time.perf_counter()
        status = "successful" if result else "failed"
        logger.info(
            click.style(
                f"Phone code verification for session {session_uuid} {status}: latency: {end_at - start_at:.3f}s",
                fg="green" if result else "yellow",
            )
        )
        return result
    except Exception:
        logger.exception("Phone code verification for session %s failed", session_uuid)
        return False
