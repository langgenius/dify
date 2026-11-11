import datetime as _mcp_server_response_datetime
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime as _mcp_server_admission_datetime
from inspect import unwrap
from types import SimpleNamespace
from uuid import UUID

import pytest
from flask import Flask
from werkzeug.exceptions import Conflict, Forbidden, NotFound, UnprocessableEntity

from controllers.common.rbac import PlainApp, RBACCheck
from controllers.console import console_ns, flask_admission
from controllers.console.app import mcp_server
from controllers.console.app import mcp_server as module
from controllers.console.app.error import AppNotFoundError
from controllers.console.app.mcp_server import (
    AppMCPServerController,
    AppMCPServerRefreshController,
    AppMCPServerResponse,
)
from controllers.console.wraps import RBACPermission
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.app.mcp_server_service import (
    AppMCPServerAlreadyExistsError,
    AppMCPServerAppNotFoundError,
    AppMCPServerNotFoundError,
    AppMCPServerRecord,
    AppMCPServerStatus,
)
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_account

"""App MCP Server routes retain their role and RBAC policy under unified admission."""


_MCP_SERVER_ADMISSION_APP_ID = UUID("11111111-1111-1111-1111-111111111111")
_MCP_SERVER_ADMISSION_RECORD = AppMCPServerRecord(
    id="server",
    name="name",
    server_code="code",
    description="description",
    status=AppMCPServerStatus.ACTIVE,
    parameters="{}",
    created_at=_mcp_server_admission_datetime(2024, 1, 1),
    updated_at=_mcp_server_admission_datetime(2024, 1, 1),
)
MUTATIONS = [
    AppMCPServerController.post,
    AppMCPServerController.put,
    AppMCPServerRefreshController.post,
]


def admission(method: Callable[..., object]) -> Callable[..., object]:
    return unwrap(method, stop=lambda view: "inject_request_context" in view.__code__.co_qualname)


class TestMcpServerAdmissionCases:
    @staticmethod
    @pytest.mark.parametrize("method", MUTATIONS)
    @pytest.mark.parametrize("role", [TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR])
    def test_readonly_roles_cannot_mutate(
        app: Flask, monkeypatch: pytest.MonkeyPatch, method: Callable[..., object], role: TenantAccountRole
    ) -> None:
        account = make_account(role=role)
        apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
        monkeypatch.setattr(
            flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account, "workspace")
        )
        with app.test_request_context(), pytest.raises(Forbidden):
            admission(method)(None, app_id=_MCP_SERVER_ADMISSION_APP_ID)

    @staticmethod
    @pytest.mark.parametrize(
        ("method", "permission"),
        [
            (AppMCPServerController.get, RBACPermission.APP_VIEW_LAYOUT),
            (AppMCPServerController.post, RBACPermission.APP_EDIT),
            (AppMCPServerController.put, RBACPermission.APP_EDIT),
            (AppMCPServerRefreshController.post, RBACPermission.APP_EDIT),
        ],
    )
    def test_rbac_checks_keep_app_scope(
        app: Flask, monkeypatch: pytest.MonkeyPatch, method: Callable[..., object], permission: RBACPermission
    ) -> None:
        account = make_account(role=TenantAccountRole.NORMAL)
        apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
        monkeypatch.setattr(
            flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account, "workspace")
        )
        called = []

        def denied(
            *, tenant_id: str, account_id: str, checks: Sequence[RBACCheck], path_args: dict[str, object]
        ) -> None:
            assert (tenant_id, account_id) == ("workspace", account.id)
            assert path_args == {"app_id": _MCP_SERVER_ADMISSION_APP_ID}
            assert len(checks) == 1
            assert checks[0].scene == permission
            assert isinstance(checks[0].locator, PlainApp)
            called.append(True)
            raise Forbidden

        monkeypatch.setattr(flask_admission, "enforce_rbac_checks", denied)
        with app.test_request_context(), pytest.raises(Forbidden):
            admission(method)(None, app_id=_MCP_SERVER_ADMISSION_APP_ID)
        assert called == [True]

    @staticmethod
    @pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR])
    def test_edit_roles_reach_service_with_request_context(
        app: Flask, monkeypatch: pytest.MonkeyPatch, role: TenantAccountRole
    ) -> None:
        account = make_account(role=role)
        apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
        monkeypatch.setattr(
            flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account, "workspace")
        )
        monkeypatch.setattr(flask_admission, "enforce_rbac_checks", lambda **_kwargs: None)
        monkeypatch.setattr(flask_admission, "get_trace_id", lambda: None)
        contexts: list[RequestContext] = []

        def refresh(context: RequestContext, _app_id: str) -> AppMCPServerRecord:
            contexts.append(context)
            return _MCP_SERVER_ADMISSION_RECORD

        monkeypatch.setattr(
            mcp_server,
            "application_services",
            lambda: SimpleNamespace(app_mcp_servers=SimpleNamespace(refresh=refresh)),
        )
        with app.test_request_context(method="POST", headers={"X-Trace-Id": "trace"}):
            response = admission(AppMCPServerRefreshController.post)(None, app_id=_MCP_SERVER_ADMISSION_APP_ID)
        assert isinstance(response, dict)
        assert response["id"] == _MCP_SERVER_ADMISSION_RECORD.id
        assert [(c.account_id, c.active_workspace_id, c.trace_id) for c in contexts] == [
            (account.id, "workspace", "trace")
        ]

    @staticmethod
    @pytest.mark.parametrize("role", [TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR])
    def test_readonly_roles_can_read(app: Flask, monkeypatch: pytest.MonkeyPatch, role: TenantAccountRole) -> None:
        account = make_account(role=role)
        apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
        monkeypatch.setattr(
            flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account, "workspace")
        )
        monkeypatch.setattr(flask_admission, "enforce_rbac_checks", lambda **_kwargs: None)
        monkeypatch.setattr(
            mcp_server,
            "application_services",
            lambda: SimpleNamespace(app_mcp_servers=SimpleNamespace(get=lambda _context, _app_id: None)),
        )
        with app.test_request_context():
            assert admission(AppMCPServerController.get)(None, app_id=_MCP_SERVER_ADMISSION_APP_ID) == {}


CONTEXT = RequestContext("request", None, "account", "workspace")
SERVER_ID = "abcdefab-1234-4567-89ab-abcdefabcdef"
_MCP_SERVER_RESPONSE_APP_ID = UUID("11111111-1111-1111-1111-111111111111")
_MCP_SERVER_RESPONSE_RECORD = AppMCPServerRecord(
    id="server",
    name="name",
    server_code="code",
    description="description",
    status=AppMCPServerStatus.ACTIVE,
    parameters='{"timeout": 30}',
    created_at=_mcp_server_response_datetime.datetime(2024, 1, 1, tzinfo=_mcp_server_response_datetime.UTC),
    updated_at=_mcp_server_response_datetime.datetime(2024, 1, 2, tzinfo=_mcp_server_response_datetime.UTC),
)


@dataclass
class Servers:
    result: AppMCPServerRecord | None = _MCP_SERVER_RESPONSE_RECORD
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


class TestMcpServerResponseCases:
    @staticmethod
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
            dt = _mcp_server_response_datetime.datetime(2024, 1, 1, 0, 0, 0, tzinfo=_mcp_server_response_datetime.UTC)
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

    @staticmethod
    def test_get_serializes_record_and_missing_server(servers: Servers) -> None:
        method = unwrap(module.AppMCPServerController.get)
        response = method(None, CONTEXT, _MCP_SERVER_RESPONSE_APP_ID)
        assert response["parameters"] == {"timeout": 30}
        assert response["created_at"] == 1704067200
        servers.result = None
        assert method(None, CONTEXT, _MCP_SERVER_RESPONSE_APP_ID) == {}

    @staticmethod
    def test_post_parses_input_and_returns_201(app: Flask, servers: Servers) -> None:
        with app.test_request_context(method="POST", json={"parameters": {"timeout": 30}}):
            response, status = unwrap(module.AppMCPServerController.post)(None, CONTEXT, _MCP_SERVER_RESPONSE_APP_ID)
        assert status == 201
        assert response["id"] == "server"
        assert servers.calls == [
            ("create", str(_MCP_SERVER_RESPONSE_APP_ID), {"description": None, "parameters": {"timeout": 30}})
        ]

    @staticmethod
    @pytest.mark.parametrize("candidate", [SERVER_ID, SERVER_ID.upper(), UUID(SERVER_ID).hex, "{" + SERVER_ID + "}"])
    def test_put_normalizes_server_id_and_passes_status(app: Flask, servers: Servers, candidate: str) -> None:
        body = {"id": candidate, "parameters": {}, "description": "updated", "status": "inactive"}
        with app.test_request_context(method="PUT", json=body):
            unwrap(module.AppMCPServerController.put)(None, CONTEXT, _MCP_SERVER_RESPONSE_APP_ID)
        assert servers.calls == [
            (
                "update",
                str(_MCP_SERVER_RESPONSE_APP_ID),
                {"server_id": SERVER_ID, "description": "updated", "parameters": {}, "status": "inactive"},
            )
        ]

    @staticmethod
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
            unwrap(module.AppMCPServerController.put)(None, CONTEXT, _MCP_SERVER_RESPONSE_APP_ID)
        assert servers.calls == []

    @staticmethod
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
            unwrap(method)(None, CONTEXT, _MCP_SERVER_RESPONSE_APP_ID)
        assert error.value.description == AppNotFoundError.description

    @staticmethod
    @pytest.mark.parametrize("method", [module.AppMCPServerController.put, module.AppMCPServerRefreshController.post])
    def test_missing_server_becomes_404(app: Flask, servers: Servers, method: Callable[..., object]) -> None:
        servers.error = AppMCPServerNotFoundError()
        with app.test_request_context(method="POST", json={"id": SERVER_ID, "parameters": {}}), pytest.raises(NotFound):
            unwrap(method)(None, CONTEXT, _MCP_SERVER_RESPONSE_APP_ID)

    @staticmethod
    def test_duplicate_create_becomes_409(app: Flask, servers: Servers) -> None:
        servers.error = AppMCPServerAlreadyExistsError()
        with app.test_request_context(method="POST", json={"parameters": {}}), pytest.raises(Conflict):
            unwrap(module.AppMCPServerController.post)(None, CONTEXT, _MCP_SERVER_RESPONSE_APP_ID)

    @staticmethod
    def test_routes_stay_app_scoped() -> None:
        route_map = {resource.__name__: urls for resource, urls, _, _ in console_ns.resources}
        assert route_map["AppMCPServerController"] == ("/apps/<uuid:app_id>/server",)
        assert route_map["AppMCPServerRefreshController"] == ("/apps/<uuid:app_id>/server/refresh",)
        assert not hasattr(module.AppMCPServerRefreshController, "get")
