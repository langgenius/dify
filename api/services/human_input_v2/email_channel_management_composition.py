"""Production composition for Human Input Email Channel management."""

from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_database import db
from services.human_input_v2.email_channel_management_service import HumanInputEmailChannelManagementService
from services.human_input_v2.resend_channel import ResendProviderGateway


def build_human_input_email_channel_management_service() -> HumanInputEmailChannelManagementService:
    operation_sessions = sessionmaker[Session](bind=db.engine, expire_on_commit=False)
    return HumanInputEmailChannelManagementService(
        ResendProviderGateway(),
        session_factory=operation_sessions,
    )


__all__ = ["build_human_input_email_channel_management_service"]
