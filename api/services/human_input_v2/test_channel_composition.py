"""Compose read-only Human Input test-channel discovery for the Console."""

from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_database import db
from services.human_input_v2.test_channel_service import HumanInputTestChannelService


def build_test_channel_service() -> HumanInputTestChannelService:
    """Require an initialized database; return discovery with service-owned read sessions."""
    return HumanInputTestChannelService(sessionmaker[Session](bind=db.engine, expire_on_commit=False))
