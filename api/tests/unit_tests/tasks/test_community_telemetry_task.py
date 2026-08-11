import logging
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from tasks import community_telemetry_task


def _bind_task_to_sqlite(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> None:
    """Bind the task-local sessionmaker to the isolated SQLite database."""
    monkeypatch.setattr(community_telemetry_task, "db", SimpleNamespace(engine=sqlite_engine))


def test_send_community_telemetry_heartbeat_reports_with_a_database_session(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    _bind_task_to_sqlite(monkeypatch, sqlite_engine)
    received_sessions: list[Session] = []

    def report_heartbeat(*, session: Session) -> None:
        received_sessions.append(session)
        assert session.get_bind() is sqlite_engine

    monkeypatch.setattr(community_telemetry_task.CommunityTelemetryService, "report_heartbeat", report_heartbeat)

    community_telemetry_task.send_community_telemetry_heartbeat.run()

    assert len(received_sessions) == 1
    assert isinstance(received_sessions[0], Session)


def test_send_community_telemetry_heartbeat_swallows_report_errors(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    caplog: pytest.LogCaptureFixture,
) -> None:
    _bind_task_to_sqlite(monkeypatch, sqlite_engine)
    monkeypatch.setattr(
        community_telemetry_task.CommunityTelemetryService,
        "report_heartbeat",
        Mock(side_effect=RuntimeError("telemetry unavailable")),
    )
    caplog.set_level(logging.DEBUG, logger=community_telemetry_task.logger.name)

    community_telemetry_task.send_community_telemetry_heartbeat.run()

    assert "Failed to process community telemetry heartbeat" in caplog.text
