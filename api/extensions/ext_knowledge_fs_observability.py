"""Production assembly for KnowledgeFS database-backed metrics."""

from __future__ import annotations

import logging

from flask import Flask

from core.db.session_factory import session_factory
from repositories.sqlalchemy_knowledge_fs_control_space_state_metrics import (
    SQLAlchemyKnowledgeFSControlSpaceStateCountReader,
)
from services.knowledge_fs.observability import get_knowledge_fs_operational_metrics

logger = logging.getLogger(__name__)


def init_app(app: Flask) -> None:
    del app
    try:
        reader = SQLAlchemyKnowledgeFSControlSpaceStateCountReader(session_factory.get_session_maker())
        get_knowledge_fs_operational_metrics().register_control_space_state_gauge(reader)
    except Exception:
        logger.exception("KnowledgeFS operational metric registration failed; continuing application startup")
