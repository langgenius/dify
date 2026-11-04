from collections.abc import Generator
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from services.tools import api_tools_manage_service
from services.tools.api_tools_manage_service import ApiToolManageService


class _RecordingSessionMaker:
    """Stands in for ``sessionmaker``: every ``begin()`` yields the next prepared session and records it."""

    def __init__(self, sessions: list[Mock]) -> None:
        self._pending = list(sessions)
        self.opened: list[Mock] = []

    def __call__(self, *_: object, **__: object) -> "_RecordingSessionMaker":
        return self

    @contextmanager
    def begin(self) -> Generator[Mock]:
        session = self._pending.pop(0)
        self.opened.append(session)
        yield session


def _patch_database(monkeypatch: pytest.MonkeyPatch, sessions: list[Mock]) -> _RecordingSessionMaker:
    """Route sessions through ``_RecordingSessionMaker`` and fail on any use of the global scoped session."""
    maker = _RecordingSessionMaker(sessions)
    global_session = Mock(side_effect=AssertionError("db.session() must not be used"))
    monkeypatch.setattr(api_tools_manage_service, "sessionmaker", maker)
    monkeypatch.setattr(api_tools_manage_service, "db", SimpleNamespace(engine=object(), session=global_session))
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


def test_list_api_tools_passes_an_explicit_session_per_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    providers = [Mock(name="provider-a"), Mock(name="provider-b")]
    loader = Mock()
    loader.scalars.return_value.all.return_value = providers
    lookup_sessions = [Mock(name="lookup-a"), Mock(name="lookup-b")]
    maker = _patch_database(monkeypatch, [loader, *lookup_sessions])

    controller = Mock()
    controller.get_tools.return_value = []
    to_user_provider = Mock(side_effect=lambda *_, **__: SimpleNamespace(tools=[], labels=[]))
    transform = api_tools_manage_service.ToolTransformService
    monkeypatch.setattr(transform, "api_provider_to_controller", Mock(return_value=controller))
    monkeypatch.setattr(transform, "api_provider_to_user_provider", to_user_provider)
    monkeypatch.setattr(transform, "repack_provider", Mock())
    monkeypatch.setattr(api_tools_manage_service.ToolLabelManager, "get_tool_labels", Mock(return_value=[]))

    result = ApiToolManageService.list_api_tools("tenant-1")

    assert len(result) == 2
    assert maker.opened == [loader, *lookup_sessions]
    assert [call.kwargs["session"] for call in to_user_provider.call_args_list] == lookup_sessions


def test_api_tool_preview_builds_the_controller_with_an_explicit_session(monkeypatch: pytest.MonkeyPatch) -> None:
    schema = """
    {
        "openapi": "3.0.0",
        "info": {"title": "Demo API", "version": "1.0.0"},
        "servers": [{"url": "https://api.example.com"}],
        "paths": {"/thing": {"get": {"operationId": "getThing", "responses": {"200": {"description": "ok"}}}}}
    }
    """
    provider_lookup = Mock()
    provider_lookup.scalar.return_value = None  # no saved provider: a placeholder one is built from the schema
    controller_session = Mock(name="controller-session")
    maker = _patch_database(monkeypatch, [provider_lookup, controller_session])

    controller = Mock()
    controller.get_tool.return_value.fork_tool_runtime.return_value.validate_credentials.return_value = "ok"
    controller_class = Mock()
    controller_class.from_db.return_value = controller
    monkeypatch.setattr(api_tools_manage_service, "ApiToolProviderController", controller_class)
    encrypter = Mock()
    encrypter.decrypt.side_effect = lambda credentials: dict(credentials)
    encrypter.mask_plugin_credentials.return_value = {}
    monkeypatch.setattr(
        api_tools_manage_service, "create_tool_provider_encrypter", Mock(return_value=(encrypter, Mock()))
    )

    result = ApiToolManageService.test_api_tool_preview(
        tenant_id="tenant-1",
        provider_name="demo",
        tool_name="getThing",
        credentials={"auth_type": "none"},
        parameters={},
        schema_type="openapi",
        schema=schema,
    )

    assert result == {"result": "ok"}
    assert maker.opened == [provider_lookup, controller_session]
    assert controller_class.from_db.call_args.kwargs["session"] is controller_session
