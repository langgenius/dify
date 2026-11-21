"""Persist form audits using a caller-owned Session and transaction."""

from typing import override

from sqlalchemy.orm import Session

from core.human_input_v2.shared.values import RecipientId, TenantId
from models.human_input_v2 import (
    FormViewEvent,
    HumanInputAuditEvent,
    IMCallbackVerificationEvent,
    OtpSendEvent,
    ServiceAPIFormSubmissionEvent,
)

from .audit_repository import AuditRepository


class SQLAlchemyAuditRepository(AuditRepository):
    def __init__(self, session: Session, tenant_id: TenantId, form_id: str) -> None:
        self._session = session
        self._tenant_id = tenant_id
        self._form_id = form_id

    @override
    def record_form_view(self, *, viewer_ip_address: str | None) -> None:
        self._session.add(
            HumanInputAuditEvent(
                tenant_id=str(self._tenant_id),
                form_id=self._form_id,
                payload=FormViewEvent(viewer_ip_address=viewer_ip_address),
            )
        )

    @override
    def record_otp_send(
        self, *, recipient_id: RecipientId, recipient_email: str, sender_ip_address: str | None
    ) -> None:
        self._session.add(
            HumanInputAuditEvent(
                tenant_id=str(self._tenant_id),
                form_id=self._form_id,
                payload=OtpSendEvent(
                    recipient_id=str(recipient_id),
                    recipient_email=recipient_email,
                    sender_ip_address=sender_ip_address,
                ),
            )
        )

    @override
    def record_im_callback_verification(self, *, succeeded: bool, request_ip_address: str | None, reason: str) -> None:
        self._session.add(
            HumanInputAuditEvent(
                tenant_id=str(self._tenant_id),
                form_id=self._form_id,
                payload=IMCallbackVerificationEvent(
                    succeeded=succeeded, request_ip_address=request_ip_address, reason=reason
                ),
            )
        )

    @override
    def record_service_api_submission(self, *, recipient_id: RecipientId, end_user_id: str) -> None:
        self._session.add(
            HumanInputAuditEvent(
                tenant_id=str(self._tenant_id),
                form_id=self._form_id,
                payload=ServiceAPIFormSubmissionEvent(recipient_id=str(recipient_id), end_user_id=end_user_id),
            )
        )
