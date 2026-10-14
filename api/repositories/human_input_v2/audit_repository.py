"""Submission attribution within an already-authorized tenant/form scope."""

from typing import Protocol

from core.human_input_v2.shared.values import RecipientId


class AuditRepository(Protocol):
    def record_service_api_submission(self, *, recipient_id: RecipientId, end_user_id: str) -> None:
        """Record the recipient grant and actual caller in the submission transaction."""
        ...
