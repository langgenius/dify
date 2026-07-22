from __future__ import annotations

from unittest.mock import MagicMock, patch

from flask import Flask

from extensions import ext_knowledge_fs_observability


def test_extension_registers_the_database_backed_control_space_gauge() -> None:
    app = Flask(__name__)
    session_maker = MagicMock()
    metrics = MagicMock()
    reader = MagicMock()

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
    metrics.register_control_space_state_gauge.assert_called_once_with(reader)


def test_extension_does_not_block_startup_when_metric_registration_fails() -> None:
    app = Flask(__name__)
    metrics = MagicMock()
    metrics.register_control_space_state_gauge.side_effect = RuntimeError("metrics unavailable")

    with (
        patch("extensions.ext_knowledge_fs_observability.session_factory.get_session_maker"),
        patch("extensions.ext_knowledge_fs_observability.SQLAlchemyKnowledgeFSControlSpaceStateCountReader"),
        patch(
            "extensions.ext_knowledge_fs_observability.get_knowledge_fs_operational_metrics",
            return_value=metrics,
        ),
    ):
        ext_knowledge_fs_observability.init_app(app)
