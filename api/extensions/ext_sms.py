import logging
from typing import Any, Literal

from flask import Flask

# Supported verification channels
VerifyChannel = Literal["sms", "voice"]

from configs import dify_config
from dify_app import DifyApp

logger = logging.getLogger(__name__)


class PlivoVerifyError(Exception):
    """Exception raised for Plivo Verify API errors."""

    def __init__(self, message: str, error_code: str | None = None):
        self.message = message
        self.error_code = error_code
        super().__init__(self.message)


class SMS:
    def __init__(self):
        self._client = None
        self._verify_enabled = False

    def is_inited(self) -> bool:
        return self._client is not None

    def is_verify_enabled(self) -> bool:
        return self._verify_enabled and self._client is not None

    def init_app(self, app: Flask):
        if not dify_config.PLIVO_VERIFY_ENABLED:
            logger.info("Plivo Verify is not enabled")
            return

        auth_id = dify_config.PLIVO_AUTH_ID
        auth_token = dify_config.PLIVO_AUTH_TOKEN

        if not auth_id or not auth_token:
            logger.warning("PLIVO_AUTH_ID or PLIVO_AUTH_TOKEN is not set")
            return

        try:
            import plivo

            self._client = plivo.RestClient(auth_id=auth_id, auth_token=auth_token)
            self._verify_enabled = True
            logger.info("Plivo SMS client initialized successfully")
        except Exception as e:
            logger.exception("Failed to initialize Plivo client")
            raise ValueError(f"Failed to initialize Plivo client: {e}")

    def send_verification_code(
        self, phone_number: str, channel: VerifyChannel = "sms"
    ) -> dict[str, Any]:
        """
        Send a verification code to the specified phone number using Plivo Verify API.

        Args:
            phone_number: The phone number to send the verification code to (E.164 format)
            channel: The delivery channel - "sms" (default) or "voice" for automated call

        Returns:
            dict containing session_uuid, channel, and other verification details

        Raises:
            PlivoVerifyError: If the verification request fails
            ValueError: If the client is not initialized or channel is invalid
        """
        if not self._client:
            raise ValueError("SMS client is not initialized")

        if not self._verify_enabled:
            raise ValueError("Plivo Verify is not enabled")

        if channel not in ("sms", "voice"):
            raise ValueError(f"Invalid channel '{channel}'. Must be 'sms' or 'voice'.")

        try:
            # Use Plivo Verify API to send OTP
            response = self._client.verify_session.create(
                recipient=phone_number,
                channel=channel,
                app_uuid=None,  # Uses default app
            )

            logger.info(
                "Verification code sent to %s via %s, session_uuid: %s",
                phone_number,
                channel,
                response.session_uuid,
            )

            return {
                "session_uuid": response.session_uuid,
                "channel": channel,
                "status": "sent",
            }
        except Exception as e:
            error_message = str(e)
            logger.exception("Failed to send verification code to %s: %s", phone_number, error_message)
            raise PlivoVerifyError(f"Failed to send verification code: {error_message}")

    def verify_code(self, session_uuid: str, otp: str) -> bool:
        """
        Verify the OTP code for a given session.

        Args:
            session_uuid: The session UUID returned from send_verification_code
            otp: The OTP code entered by the user

        Returns:
            True if verification is successful, False otherwise

        Raises:
            PlivoVerifyError: If the verification check fails
            ValueError: If the client is not initialized
        """
        if not self._client:
            raise ValueError("SMS client is not initialized")

        if not self._verify_enabled:
            raise ValueError("Plivo Verify is not enabled")

        try:
            # Use Plivo Verify API to validate OTP
            response = self._client.verify_session.validate(
                session_uuid=session_uuid,
                otp=otp,
            )

            # Check if verification was successful
            if hasattr(response, "status") and response.status == "verified":
                logger.info("Verification successful for session %s", session_uuid)
                return True

            logger.warning("Verification failed for session %s", session_uuid)
            return False
        except Exception as e:
            error_message = str(e)
            logger.warning("Verification check failed for session %s: %s", session_uuid, error_message)
            # Return False for invalid OTP cases instead of raising exception
            lower_msg = error_message.lower()
            if "invalid" in lower_msg or "expired" in lower_msg or "not found" in lower_msg:
                return False
            raise PlivoVerifyError(f"Verification check failed: {error_message}")

    def send_sms(self, to: str, message: str, from_number: str | None = None) -> dict[str, Any]:
        """
        Send an SMS message using Plivo Message API.

        Args:
            to: The recipient phone number (E.164 format)
            message: The message content to send
            from_number: The sender phone number (optional, uses default if not provided)

        Returns:
            dict containing message_uuid and other details

        Raises:
            PlivoVerifyError: If sending fails
            ValueError: If the client is not initialized
        """
        if not self._client:
            raise ValueError("SMS client is not initialized")

        src = from_number or dify_config.PLIVO_DEFAULT_FROM_NUMBER
        if not src:
            raise ValueError("From number is not set")

        try:
            response = self._client.messages.create(
                src=src,
                dst=to,
                text=message,
            )

            logger.info("SMS sent to %s, message_uuid: %s", to, response.message_uuid)

            return {
                "message_uuid": response.message_uuid[0] if response.message_uuid else None,
                "status": "sent",
            }
        except Exception as e:
            error_message = str(e)
            logger.exception("Failed to send SMS to %s: %s", to, error_message)
            raise PlivoVerifyError(f"Failed to send SMS: {error_message}")


def is_enabled() -> bool:
    return dify_config.PLIVO_VERIFY_ENABLED


def init_app(app: DifyApp):
    sms.init_app(app)


sms = SMS()
