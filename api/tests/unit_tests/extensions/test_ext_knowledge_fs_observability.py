from __future__ import annotations

from unittest.mock import patch

from flask import Flask
from sqlalchemy.orm import sessionmaker

from extensions import ext_knowledge_fs_observability
from repositories.sqlalchemy_knowledge_fs_control_space_state_metrics import (
    SQLAlchemyKnowledgeFSControlSpaceStateCountReader,
)
from tests.unit_tests.tasks.knowledge_fs_task_fakes import RecordingKnowledgeFSMetrics


def test_extension_registers_the_database_backed_control_space_gauge() -> None:
    app = Flask(__name__)
    session_maker = sessionmaker()
    metrics = RecordingKnowledgeFSMetrics()
    reader = SQLAlchemyKnowledgeFSControlSpaceStateCountReader(session_maker)

    with (
        patch(
            "extensions.ext_knowledge_fs_observability.session_factory.get_session_maker",
            return_value=session_maker,
        ),
        patch(
            "extensions.ext_knowledge_fs_observability.SQLAlchemyKnowledgeFSControlSpaceStateCountReader",
            return_value=reader,
        ) as reader_type,
        patch(
            "extensions.ext_knowledge_fs_observability.get_knowledge_fs_operational_metrics",
            return_value=metrics,
        ),
    ):
        ext_knowledge_fs_observability.init_app(app)

    reader_type.assert_called_once_with(session_maker)
    assert metrics.gauge_readers == [reader]


def test_extension_does_not_block_startup_when_metric_registration_fails() -> None:
    app = Flask(__name__)
    metrics = RecordingKnowledgeFSMetrics(gauge_registration_error=RuntimeError("metrics unavailable"))

    with (
        patch("extensions.ext_knowledge_fs_observability.session_factory.get_session_maker"),
        patch("extensions.ext_knowledge_fs_observability.SQLAlchemyKnowledgeFSControlSpaceStateCountReader"),
        patch(
            "extensions.ext_knowledge_fs_observability.get_knowledge_fs_operational_metrics",
            return_value=metrics,
        ),
    ):
        ext_knowledge_fs_observability.init_app(app)
