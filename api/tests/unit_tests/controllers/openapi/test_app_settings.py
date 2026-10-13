from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock

import pytest

from controllers.openapi import _app_settings
from controllers.openapi._app_settings import WebAppPath
from controllers.openapi._errors import WebAppAccessModeConsoleOnly, WebAppAccessUnavailable, WebAppPublicAccessDisabled
from controllers.openapi._models import WebAppAccessPayload
from controllers.openapi.auth.context import Context
from enums import WebAppAccessMode
from models import AppMode
from services.webapp_access_query_service import WebAppAccessUnavailableError


def _context() -> Context:
    return cast(Context, SimpleNamespace(app=SimpleNamespace(id="app-1")))


def test_webapp_access_read_failure_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    webapp_access = Mock()
    webapp_access.get_access_mode.side_effect = WebAppAccessUnavailableError()
    monkeypatch.setattr(_app_settings, "application_services", lambda: SimpleNamespace(webapp_access=webapp_access))

    with pytest.raises(WebAppAccessUnavailable):
        _app_settings.webapp_access(_context())


def test_set_webapp_access_returns_the_written_mode_without_reading_back(monkeypatch: pytest.MonkeyPatch) -> None:
    """A failing read after a saved write must not report the write as failed."""
    webapp_access = Mock()
    webapp_access.get_access_mode.side_effect = WebAppAccessUnavailableError()
    monkeypatch.setattr(_app_settings, "application_services", lambda: SimpleNamespace(webapp_access=webapp_access))
    policy = Mock()
    monkeypatch.setattr(_app_settings, "_ACCESS_POLICY", policy)

    result = _app_settings.update_webapp_access(
        _context(), WebAppAccessPayload(access_mode=WebAppAccessMode.PRIVATE_ALL)
    )

    assert result.access_mode == WebAppAccessMode.PRIVATE_ALL
    policy.update_access_mode.assert_called_once_with("app-1", WebAppAccessMode.PRIVATE_ALL)


def test_set_webapp_access_public_is_refused_when_the_server_disables_public_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(_app_settings.dify_config, "WEBAPP_PUBLIC_ACCESS_ENABLED", False)
    policy = Mock()
    monkeypatch.setattr(_app_settings, "_ACCESS_POLICY", policy)

    with pytest.raises(WebAppPublicAccessDisabled):
        _app_settings.update_webapp_access(_context(), WebAppAccessPayload(access_mode=WebAppAccessMode.PUBLIC))

    policy.update_access_mode.assert_not_called()


@pytest.mark.parametrize("mode", [WebAppAccessMode.PRIVATE_ALL, WebAppAccessMode.SSO_VERIFIED])
def test_set_webapp_access_non_public_modes_are_unaffected_by_the_public_switch(
    monkeypatch: pytest.MonkeyPatch, mode: WebAppAccessMode
) -> None:
    monkeypatch.setattr(_app_settings.dify_config, "WEBAPP_PUBLIC_ACCESS_ENABLED", False)
    policy = Mock()
    monkeypatch.setattr(_app_settings, "_ACCESS_POLICY", policy)

    result = _app_settings.update_webapp_access(_context(), WebAppAccessPayload(access_mode=mode))

    assert result.access_mode == mode
    policy.update_access_mode.assert_called_once_with("app-1", mode)


def test_set_webapp_access_public_is_written_when_the_server_allows_it(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(_app_settings.dify_config, "WEBAPP_PUBLIC_ACCESS_ENABLED", True)
    policy = Mock()
    monkeypatch.setattr(_app_settings, "_ACCESS_POLICY", policy)

    result = _app_settings.update_webapp_access(_context(), WebAppAccessPayload(access_mode=WebAppAccessMode.PUBLIC))

    assert result.access_mode == WebAppAccessMode.PUBLIC
    policy.update_access_mode.assert_called_once_with("app-1", WebAppAccessMode.PUBLIC)


def test_set_webapp_access_private_still_answers_console_only_when_public_is_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(_app_settings.dify_config, "WEBAPP_PUBLIC_ACCESS_ENABLED", False)

    with pytest.raises(WebAppAccessModeConsoleOnly):
        _app_settings.update_webapp_access(_context(), WebAppAccessPayload(access_mode=WebAppAccessMode.PRIVATE))


@pytest.mark.parametrize(
    ("mode", "path"),
    [
        (AppMode.WORKFLOW, WebAppPath.WORKFLOW),
        (AppMode.ADVANCED_CHAT, WebAppPath.CHAT),
        (AppMode.CHAT, WebAppPath.CHAT),
        (AppMode.AGENT_CHAT, WebAppPath.CHAT),
        (AppMode.COMPLETION, WebAppPath.COMPLETION),
        (AppMode.AGENT, WebAppPath.AGENT),
    ],
)
def test_web_app_path_follows_the_app_mode(mode: AppMode, path: WebAppPath) -> None:
    assert WebAppPath.of(mode) is path
