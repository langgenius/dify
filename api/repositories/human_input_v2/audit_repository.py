"""Audit writes within a trusted tenant/form scope and caller-owned transaction."""

from typing import Protocol

from core.human_input_v2.shared.values import RecipientId


class AuditRepository(Protocol):
    def record_form_view(self, *, viewer_ip_address: str | None) -> None:
        """Record a form read after its visibility checks succeed."""
        ...

    def record_otp_send(
        self, *, recipient_id: RecipientId, recipient_email: str, sender_ip_address: str | None
    ) -> None:
        """Record an OTP email accepted by the sending channel."""
        ...

    def record_im_callback_verification(self, *, succeeded: bool, request_ip_address: str | None, reason: str) -> None:
        """Record callback authorization independently of form submission."""
        ...

    def record_service_api_submission(self, *, recipient_id: RecipientId, end_user_id: str) -> None:
        """Record the recipient grant and actual caller in the submission transaction."""
        ...
