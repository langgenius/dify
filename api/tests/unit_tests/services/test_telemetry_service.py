from datetime import datetime
from unittest.mock import Mock

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.model import DifySetup
from services import telemetry_service
from services.telemetry_service import CommunityTelemetryService


@pytest.fixture
def telemetry_enabled(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(telemetry_service.dify_config, "EDITION", "SELF_HOSTED")
    monkeypatch.setattr(telemetry_service.dify_config, "DISABLE_TELEMETRY", False)
    monkeypatch.setattr(telemetry_service.dify_config, "DO_NOT_TRACK", False)
    monkeypatch.setattr(telemetry_service.dify_config, "CI", False)
    monkeypatch.setattr(telemetry_service.dify_config, "TELEMETRY_ENDPOINT", "https://telemetry.example.test/v1/events")
    monkeypatch.setattr(
        telemetry_service.dify_config,
        "TELEMETRY_FALLBACK_ENDPOINT",
        "https://telemetry-cn.example.test/v1/events",
    )
    monkeypatch.setattr(telemetry_service.dify_config, "TELEMETRY_TIMEOUT_SECONDS", 2)


@pytest.mark.parametrize("sqlite_session", [(DifySetup,)], indirect=True)
def test_report_install_marks_reported_at(
    sqlite_session: Session, telemetry_enabled, monkeypatch: pytest.MonkeyPatch
):
    setup = DifySetup(version="installed-version", instance_id="d246c3a1-350b-406c-92c7-6043df680758")
    sqlite_session.add(setup)
    sqlite_session.commit()
    monkeypatch.setattr(telemetry_service.dify_config.project, "version", "running-version")

    sent_payloads: list[dict[str, str | int]] = []

    def fake_post(url: str, json: dict[str, str | int], timeout: int):
        sent_payloads.append(json)
        return httpx.Response(204, request=httpx.Request("POST", url))

    monkeypatch.setattr(telemetry_service.httpx, "post", fake_post)

    assert CommunityTelemetryService.report_install(session=sqlite_session) is True

    saved_setup = sqlite_session.scalar(select(DifySetup))
    assert saved_setup is not None
    assert saved_setup.install_reported_at is not None
    assert sent_payloads[0]["event"] == "install"
    assert sent_payloads[0]["instance_id"] == setup.instance_id
    assert sent_payloads[0]["version"] == "installed-version"
    assert "installed_at" in sent_payloads[0]


@pytest.mark.parametrize("sqlite_session", [(DifySetup,)], indirect=True)
def test_report_install_failure_keeps_install_pending(
    sqlite_session: Session, telemetry_enabled, monkeypatch: pytest.MonkeyPatch
):
    setup = DifySetup(version="1.0.0", instance_id="d246c3a1-350b-406c-92c7-6043df680758")
    sqlite_session.add(setup)
    sqlite_session.commit()

    def fake_post(url: str, json: dict[str, str | int], timeout: int):
        raise httpx.ConnectError("offline", request=httpx.Request("POST", url))

    monkeypatch.setattr(telemetry_service.httpx, "post", fake_post)

    assert CommunityTelemetryService.report_install(session=sqlite_session) is False

    saved_setup = sqlite_session.scalar(select(DifySetup))
    assert saved_setup is not None
    assert saved_setup.install_reported_at is None


@pytest.mark.parametrize("sqlite_session", [(DifySetup,)], indirect=True)
def test_report_install_uses_fallback_endpoint_after_network_failure(
    sqlite_session: Session, telemetry_enabled, monkeypatch: pytest.MonkeyPatch
):
    setup = DifySetup(version="1.0.0", instance_id="d246c3a1-350b-406c-92c7-6043df680758")
    sqlite_session.add(setup)
    sqlite_session.commit()

    urls: list[str] = []

    def fake_post(url: str, json: dict[str, str | int], timeout: int):
        urls.append(url)
        if url == telemetry_service.dify_config.TELEMETRY_ENDPOINT:
            raise httpx.ConnectError("offline", request=httpx.Request("POST", url))
        return httpx.Response(204, request=httpx.Request("POST", url))

    monkeypatch.setattr(telemetry_service.httpx, "post", fake_post)

    assert CommunityTelemetryService.report_install(session=sqlite_session) is True
    assert urls == [
        telemetry_service.dify_config.TELEMETRY_ENDPOINT,
        telemetry_service.dify_config.TELEMETRY_FALLBACK_ENDPOINT,
    ]


@pytest.mark.parametrize("sqlite_session", [(DifySetup,)], indirect=True)
def test_report_install_does_not_use_fallback_endpoint_after_http_error(
    sqlite_session: Session, telemetry_enabled, monkeypatch: pytest.MonkeyPatch
):
    setup = DifySetup(version="1.0.0", instance_id="d246c3a1-350b-406c-92c7-6043df680758")
    sqlite_session.add(setup)
    sqlite_session.commit()

    post_mock = Mock(
        return_value=httpx.Response(
            500,
            request=httpx.Request("POST", telemetry_service.dify_config.TELEMETRY_ENDPOINT),
        )
    )
    monkeypatch.setattr(telemetry_service.httpx, "post", post_mock)

    assert CommunityTelemetryService.report_install(session=sqlite_session) is False
    post_mock.assert_called_once()


@pytest.mark.parametrize("sqlite_session", [(DifySetup,)], indirect=True)
def test_report_heartbeat_retries_pending_install_before_heartbeat(
    sqlite_session: Session, telemetry_enabled, monkeypatch: pytest.MonkeyPatch
):
    setup = DifySetup(version="installed-version", instance_id="d246c3a1-350b-406c-92c7-6043df680758")
    sqlite_session.add(setup)
    sqlite_session.commit()
    monkeypatch.setattr(telemetry_service.dify_config.project, "version", "running-version")

    sent_payloads: list[dict[str, str | int]] = []

    def fake_post(url: str, json: dict[str, str | int], timeout: int):
        sent_payloads.append(json)
        return httpx.Response(204, request=httpx.Request("POST", url))

    monkeypatch.setattr(telemetry_service.httpx, "post", fake_post)
    now = datetime(2026, 7, 13, 0, 0, 0)
    assert CommunityTelemetryService.report_heartbeat(session=sqlite_session, now=now) is True

    saved_setup = sqlite_session.scalar(select(DifySetup))
    assert saved_setup is not None
    assert saved_setup.install_reported_at is not None
    assert saved_setup.last_heartbeat_at == now
    assert [(payload["event"], payload["version"]) for payload in sent_payloads] == [
        ("install", "installed-version"),
        ("heartbeat", "running-version"),
    ]


@pytest.mark.parametrize("sqlite_session", [(DifySetup,)], indirect=True)
def test_report_heartbeat_skips_when_already_sent_today(
    sqlite_session: Session, telemetry_enabled, monkeypatch: pytest.MonkeyPatch
):
    setup = DifySetup(
        version="1.0.0",
        instance_id="d246c3a1-350b-406c-92c7-6043df680758",
        install_reported_at=datetime(2026, 7, 13, 8, 0, 0),
        last_heartbeat_at=datetime(2026, 7, 13, 9, 0, 0),
    )
    sqlite_session.add(setup)
    sqlite_session.commit()

    post_mock = Mock()
    monkeypatch.setattr(telemetry_service.httpx, "post", post_mock)

    assert CommunityTelemetryService.report_heartbeat(
        session=sqlite_session, now=datetime(2026, 7, 13, 12, 0, 0)
    ) is False
    post_mock.assert_not_called()
