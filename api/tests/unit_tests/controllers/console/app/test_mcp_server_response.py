import datetime
from collections.abc import Callable
from dataclasses import dataclass, field
from inspect import unwrap
from types import SimpleNamespace
from uuid import UUID

import pytest
from flask import Flask
from werkzeug.exceptions import Conflict, NotFound, UnprocessableEntity

from controllers.console import console_ns
from controllers.console.app import mcp_server as module
from controllers.console.app.error import AppNotFoundError
from controllers.console.app.mcp_server import AppMCPServerResponse
from machinery.context import RequestContext
from services.app.mcp_server_service import (
    AppMCPServerAlreadyExistsError,
    AppMCPServerAppNotFoundError,
    AppMCPServerNotFoundError,
    AppMCPServerRecord,
    AppMCPServerStatus,
)

CONTEXT = RequestContext("request", None, "account", "workspace")
SERVER_ID = "abcdefab-1234-4567-89ab-abcdefabcdef"
APP_ID = UUID("11111111-1111-1111-1111-111111111111")
RECORD = AppMCPServerRecord(
    id="server",
    name="name",
    server_code="code",
    description="description",
    status=AppMCPServerStatus.ACTIVE,
    parameters='{"timeout": 30}',
    created_at=datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC),
    updated_at=datetime.datetime(2024, 1, 2, tzinfo=datetime.UTC),
)


@dataclass
class Servers:
    result: AppMCPServerRecord | None = RECORD
    error: Exception | None = None
    calls: list[tuple[str, str, dict[str, object]]] = field(default_factory=list)

    def get(self, context: RequestContext, app_id: str) -> AppMCPServerRecord | None:
        return self._call("get", app_id)

    def create(self, context: RequestContext, app_id: str, **kwargs: object) -> AppMCPServerRecord | None:
        return self._call("create", app_id, **kwargs)

    def update(self, context: RequestContext, app_id: str, **kwargs: object) -> AppMCPServerRecord | None:
        return self._call("update", app_id, **kwargs)

    def refresh(self, context: RequestContext, app_id: str) -> AppMCPServerRecord | None:
        return self._call("refresh", app_id)

    def _call(self, method: str, app_id: str, **kwargs: object) -> AppMCPServerRecord | None:
        self.calls.append((method, app_id, kwargs))
        if self.error is not None:
            raise self.error
        return self.result


@pytest.fixture
def servers(monkeypatch: pytest.MonkeyPatch) -> Servers:
    servers = Servers()
    monkeypatch.setattr(module, "application_services", lambda: SimpleNamespace(app_mcp_servers=servers))
    return servers


class TestAppMCPServerResponse:
    def test_parameters_json_string_parsed(self) -> None:
        data: dict[str, object] = {
            "id": "s1",
            "name": "test",
            "server_code": "code",
            "description": "desc",
            "status": "active",
            "parameters": '{"key": "value"}',
        }
        resp = AppMCPServerResponse.model_validate(data)
        assert resp.parameters == {"key": "value"}

    def test_parameters_invalid_json_returns_original(self) -> None:
        data: dict[str, object] = {
            "id": "s1",
            "name": "test",
            "server_code": "code",
            "description": "desc",
            "status": "active",
            "parameters": "not-valid-json",
        }
        resp = AppMCPServerResponse.model_validate(data)
        assert resp.parameters == "not-valid-json"

    def test_parameters_dict_passthrough(self) -> None:
        data: dict[str, object] = {
            "id": "s1",
            "name": "test",
            "server_code": "code",
            "description": "desc",
            "status": "active",
            "parameters": {"already": "parsed"},
        }
        resp = AppMCPServerResponse.model_validate(data)
        assert resp.parameters == {"already": "parsed"}

    def test_parameters_json_array_parsed(self) -> None:
        data: dict[str, object] = {
            "id": "s1",
            "name": "test",
            "server_code": "code",
            "description": "desc",
            "status": "active",
            "parameters": '["a", "b"]',
        }
        resp = AppMCPServerResponse.model_validate(data)
        assert resp.parameters == ["a", "b"]

    def test_timestamps_normalized(self) -> None:
        dt = datetime.datetime(2024, 1, 1, 0, 0, 0, tzinfo=datetime.UTC)
        data: dict[str, object] = {
            "id": "s1",
            "name": "test",
            "server_code": "code",
            "description": "desc",
            "status": "active",
            "parameters": {},
            "created_at": dt,
            "updated_at": dt,
        }
        resp = AppMCPServerResponse.model_validate(data)
        assert resp.created_at == int(dt.timestamp())
        assert resp.updated_at == int(dt.timestamp())

    def test_timestamps_none(self) -> None:
        data: dict[str, object] = {
            "id": "s1",
            "name": "test",
            "server_code": "code",
            "description": "desc",
            "status": "active",
            "parameters": {},
        }
        resp = AppMCPServerResponse.model_validate(data)
        assert resp.created_at is None
        assert resp.updated_at is None


def test_get_serializes_record_and_missing_server(servers: Servers) -> None:
    method = unwrap(module.AppMCPServerController.get)
    response = method(None, CONTEXT, APP_ID)
    assert response["parameters"] == {"timeout": 30}
    assert response["created_at"] == 1704067200
    servers.result = None
    assert method(None, CONTEXT, APP_ID) == {}


def test_post_parses_input_and_returns_201(app: Flask, servers: Servers) -> None:
    with app.test_request_context(method="POST", json={"parameters": {"timeout": 30}}):
        response, status = unwrap(module.AppMCPServerController.post)(None, CONTEXT, APP_ID)
    assert status == 201
    assert response["id"] == "server"
    assert servers.calls == [("create", str(APP_ID), {"description": None, "parameters": {"timeout": 30}})]


@pytest.mark.parametrize("candidate", [SERVER_ID, SERVER_ID.upper(), UUID(SERVER_ID).hex, "{" + SERVER_ID + "}"])
def test_put_normalizes_server_id_and_passes_status(app: Flask, servers: Servers, candidate: str) -> None:
    body = {"id": candidate, "parameters": {}, "description": "updated", "status": "inactive"}
    with app.test_request_context(method="PUT", json=body):
        unwrap(module.AppMCPServerController.put)(None, CONTEXT, APP_ID)
    assert servers.calls == [
        (
            "update",
            str(APP_ID),
            {"server_id": SERVER_ID, "description": "updated", "parameters": {}, "status": "inactive"},
        )
    ]


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"id": "not-a-uuid", "parameters": {}}, id="malformed-id"),
        pytest.param({"id": SERVER_ID, "parameters": {}, "status": "paused"}, id="unknown-status"),
        pytest.param({"id": SERVER_ID, "parameters": {}, "status": ""}, id="blank-status"),
    ],
)
def test_put_rejects_invalid_payload_before_calling_service(
    app: Flask, servers: Servers, body: dict[str, object]
) -> None:
    with app.test_request_context(method="PUT", json=body), pytest.raises(UnprocessableEntity):
        unwrap(module.AppMCPServerController.put)(None, CONTEXT, APP_ID)
    assert servers.calls == []


@pytest.mark.parametrize(
    "method",
    [
        module.AppMCPServerController.get,
        module.AppMCPServerController.post,
        module.AppMCPServerController.put,
        module.AppMCPServerRefreshController.post,
    ],
)
def test_unavailable_app_becomes_app_404(app: Flask, servers: Servers, method: Callable[..., object]) -> None:
    servers.error = AppMCPServerAppNotFoundError()
    with (
        app.test_request_context(method="POST", json={"id": SERVER_ID, "parameters": {}}),
        pytest.raises(AppNotFoundError) as error,
    ):
        unwrap(method)(None, CONTEXT, APP_ID)
    assert error.value.description == AppNotFoundError.description


@pytest.mark.parametrize("method", [module.AppMCPServerController.put, module.AppMCPServerRefreshController.post])
def test_missing_server_becomes_404(app: Flask, servers: Servers, method: Callable[..., object]) -> None:
    servers.error = AppMCPServerNotFoundError()
    with app.test_request_context(method="POST", json={"id": SERVER_ID, "parameters": {}}), pytest.raises(NotFound):
        unwrap(method)(None, CONTEXT, APP_ID)


def test_duplicate_create_becomes_409(app: Flask, servers: Servers) -> None:
    servers.error = AppMCPServerAlreadyExistsError()
    with app.test_request_context(method="POST", json={"parameters": {}}), pytest.raises(Conflict):
        unwrap(module.AppMCPServerController.post)(None, CONTEXT, APP_ID)


def test_routes_stay_app_scoped() -> None:
    route_map = {resource.__name__: urls for resource, urls, _, _ in console_ns.resources}
    assert route_map["AppMCPServerController"] == ("/apps/<uuid:app_id>/server",)
    assert route_map["AppMCPServerRefreshController"] == ("/apps/<uuid:app_id>/server/refresh",)
    assert not hasattr(module.AppMCPServerRefreshController, "get")
