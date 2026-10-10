from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock

import pytest

from controllers.openapi import _app_settings
from controllers.openapi._app_settings import WebAppPath
from controllers.openapi._errors import WebAppAccessUnavailable
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

    result = _app_settings.update_webapp_access(
        _context(), WebAppAccessPayload(access_mode=WebAppAccessMode.PRIVATE_ALL)
    )

    assert result.access_mode == WebAppAccessMode.PRIVATE_ALL
    webapp_access.update_access_mode.assert_called_once_with(app_id="app-1", access_mode=WebAppAccessMode.PRIVATE_ALL)


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
