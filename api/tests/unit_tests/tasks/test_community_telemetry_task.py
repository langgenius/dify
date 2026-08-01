import logging
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock

import pytest

from tasks import community_telemetry_task


def _configure_task_session(monkeypatch: pytest.MonkeyPatch) -> Mock:
    session = Mock()
    session_factory = MagicMock()
    session_factory.return_value.__enter__.return_value = session
    monkeypatch.setattr(community_telemetry_task, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(community_telemetry_task, "sessionmaker", Mock(return_value=session_factory))
    return session


def test_send_community_telemetry_heartbeat_reports_with_a_database_session(monkeypatch: pytest.MonkeyPatch):
    session = _configure_task_session(monkeypatch)
    report_heartbeat = Mock()
    monkeypatch.setattr(community_telemetry_task.CommunityTelemetryService, "report_heartbeat", report_heartbeat)

    community_telemetry_task.send_community_telemetry_heartbeat.run()

    report_heartbeat.assert_called_once_with(session=session)


def test_send_community_telemetry_heartbeat_swallows_report_errors(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    _configure_task_session(monkeypatch)
    monkeypatch.setattr(
        community_telemetry_task.CommunityTelemetryService,
        "report_heartbeat",
        Mock(side_effect=RuntimeError("telemetry unavailable")),
    )
    caplog.set_level(logging.DEBUG, logger=community_telemetry_task.logger.name)
    community_telemetry_task.send_community_telemetry_heartbeat.run()

    assert "Failed to process community telemetry heartbeat" in caplog.text
