from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock

import pytest

from controllers.openapi import _app_settings
from controllers.openapi._errors import WebAppAccessUnavailable
from controllers.openapi._models import WebAppAccessPayload
from controllers.openapi.auth.context import Context
from enums import WebAppAccessMode
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
    console = Mock()
    monkeypatch.setattr(
        _app_settings,
        "application_services",
        lambda: SimpleNamespace(webapp_access=webapp_access, apps=SimpleNamespace(console=console)),
    )

    result = _app_settings.update_webapp_access(
        _context(), WebAppAccessPayload(access_mode=WebAppAccessMode.PRIVATE_ALL)
    )

    assert result.access_mode == WebAppAccessMode.PRIVATE_ALL
    console.update_access.assert_called_once_with("app-1", WebAppAccessMode.PRIVATE_ALL)
