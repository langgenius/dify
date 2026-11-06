from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import cast
from unittest.mock import Mock

import pytest
from sqlalchemy.orm import Session

from services.tools import api_tools_manage_service
from services.tools.api_tools_manage_service import ApiToolManageService


class _QueryResult:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def all(self) -> list[object]:
        return self._rows


class _RecordedSession:
    """A session that answers ``scalar`` and ``scalars`` from prepared rows."""

    def __init__(self, rows: list[object] | None = None, scalar_value: object = None) -> None:
        self._rows = rows or []
        self._scalar_value = scalar_value

    def scalars(self, *_: object) -> _QueryResult:
        return _QueryResult(self._rows)

    def scalar(self, *_: object) -> object:
        return self._scalar_value


class _RecordingSessionMaker:
    """Stands in for ``sessionmaker``: every ``begin()`` yields the next prepared session and records it."""

    def __init__(self, sessions: list[_RecordedSession]) -> None:
        self._pending = list(sessions)
        self.opened: list[_RecordedSession] = []

    def __call__(self, *_: object, **__: object) -> "_RecordingSessionMaker":
        return self

    @contextmanager
    def begin(self) -> Generator[_RecordedSession]:
        session = self._pending.pop(0)
        self.opened.append(session)
        yield session


class _Database:
    """The ``db`` the service sees: an engine to build sessions from, and a global session that must stay unused."""

    engine = object()

    @staticmethod
    def session() -> None:
        raise AssertionError("db.session() must not be used")


def _patch_database(monkeypatch: pytest.MonkeyPatch, sessions: list[_RecordedSession]) -> _RecordingSessionMaker:
    """Route sessions through ``_RecordingSessionMaker`` and fail on any use of the global scoped session."""
    maker = _RecordingSessionMaker(sessions)
    monkeypatch.setattr(api_tools_manage_service, "sessionmaker", maker)
    monkeypatch.setattr(api_tools_manage_service, "db", _Database)
    return maker


def test_get_api_tool_provider_remote_schema_uses_ssrf_proxy_get(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    schema = """
    {
        "openapi": "3.0.0",
        "info": {"title": "Demo API", "version": "1.0.0"},
        "servers": [{"url": "https://api.example.com"}],
        "paths": {}
    }
    """
    url = "https://example.com/openapi.json"
    expected_headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)"
        " Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
        "Accept": "*/*",
    }
    mock_get = Mock(return_value=Mock(status_code=200, text=schema))
    mock_parser = Mock()

    monkeypatch.setattr("services.tools.api_tools_manage_service.ssrf_proxy.get", mock_get)
    monkeypatch.setattr(ApiToolManageService, "parser_api_schema", mock_parser)

    result = ApiToolManageService.get_api_tool_provider_remote_schema("user-1", "tenant-1", url)

    assert result == {"schema": schema}
    mock_get.assert_called_once_with(url, headers=expected_headers, timeout=10)
    mock_parser.assert_called_once_with(schema)


@dataclass
class _Provider:
    name: str


class _UserProvider:
    def __init__(self) -> None:
        self.tools: list[object] = []
        self.labels: list[str] = []


class _ProviderController:
    def get_tools(self, **_: object) -> list[object]:
        return []


def test_list_api_tools_passes_an_explicit_session_per_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    providers = [_Provider("provider-a"), _Provider("provider-b")]
    loader = _RecordedSession(rows=providers)
    lookup_sessions = [_RecordedSession(), _RecordedSession()]
    maker = _patch_database(monkeypatch, [loader, *lookup_sessions])

    received_sessions: list[object] = []

    def to_user_provider(*_: object, **kwargs: object) -> _UserProvider:
        received_sessions.append(kwargs["session"])
        return _UserProvider()

    transform = api_tools_manage_service.ToolTransformService
    monkeypatch.setattr(transform, "api_provider_to_controller", lambda **_: _ProviderController())
    monkeypatch.setattr(transform, "api_provider_to_user_provider", to_user_provider)
    monkeypatch.setattr(transform, "repack_provider", lambda **_: None)
    monkeypatch.setattr(api_tools_manage_service.ToolLabelManager, "get_tool_labels", lambda *_: [])

    result = ApiToolManageService.list_api_tools("tenant-1")

    assert len(result) == 2
    assert maker.opened == [loader, *lookup_sessions]
    assert received_sessions == lookup_sessions


class _Tool:
    def fork_tool_runtime(self, **_: object) -> "_Tool":
        return self

    def validate_credentials(self, *_: object) -> str:
        return "ok"


class _PreviewController:
    """Records the session ``from_db`` is given and serves a tool that validates."""

    from_db_sessions: list[object] = []

    @classmethod
    def from_db(cls, *_: object, session: object) -> "_PreviewController":
        cls.from_db_sessions.append(session)
        return cls()

    def load_bundled_tools(self, *_: object) -> None:
        pass

    def validate_credentials_format(self, *_: object) -> None:
        pass

    def get_tool(self, *_: object) -> _Tool:
        return _Tool()


class _Encrypter:
    def decrypt(self, credentials: dict[str, object]) -> dict[str, object]:
        return dict(credentials)

    def mask_plugin_credentials(self, *_: object) -> dict[str, object]:
        return {}


def test_api_tool_preview_uses_the_session_it_is_given(monkeypatch: pytest.MonkeyPatch) -> None:
    schema = """
    {
        "openapi": "3.0.0",
        "info": {"title": "Demo API", "version": "1.0.0"},
        "servers": [{"url": "https://api.example.com"}],
        "paths": {"/thing": {"get": {"operationId": "getThing", "responses": {"200": {"description": "ok"}}}}}
    }
    """
    session = _RecordedSession(scalar_value=None)  # no saved provider: a placeholder is built from the schema
    maker = _patch_database(monkeypatch, [])
    _PreviewController.from_db_sessions = []
    monkeypatch.setattr(api_tools_manage_service, "ApiToolProviderController", _PreviewController)
    monkeypatch.setattr(api_tools_manage_service, "create_tool_provider_encrypter", lambda **_: (_Encrypter(), None))

    result = ApiToolManageService.test_api_tool_preview(
        session=cast(Session, session),
        tenant_id="tenant-1",
        provider_name="demo",
        tool_name="getThing",
        credentials={"auth_type": "none"},
        parameters={},
        schema_type="openapi",
        schema=schema,
    )

    assert result == {"result": "ok"}
    assert maker.opened == []  # the service opens no session of its own
    assert _PreviewController.from_db_sessions == [session]
