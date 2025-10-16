"""
Helper functions for obtaining message repository instances within the core layer.
"""

from sqlalchemy.orm import sessionmaker

from core.message.repositories.message_repository import MessageRepository
from core.repositories.factory import DifyCoreRepositoryFactory
from extensions.ext_database import db

_session_maker_singleton: sessionmaker | None = None


def _get_session_maker() -> sessionmaker:
    global _session_maker_singleton

    if _session_maker_singleton is None:
        _session_maker_singleton = sessionmaker(bind=db.engine, expire_on_commit=False)

    return _session_maker_singleton


def get_message_repository() -> MessageRepository:
    """
    Retrieve a configured MessageRepository instance.

    The repository uses a shared sessionmaker to avoid recreating it for each call.
    """
    session_maker = _get_session_maker()
    return DifyCoreRepositoryFactory.create_message_repository(session_maker=session_maker)
