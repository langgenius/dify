"""Endpoint tests for controllers.console.workspace.tool_providers."""

from __future__ import annotations

import builtins
import importlib
from contextlib import contextmanager
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from flask.views import MethodView

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


_CONTROLLER_MODULE: ModuleType | None = None
_WRAPS_MODULE: ModuleType | None = None
_CONTROLLER_PATCHERS: list[patch] = []


@contextmanager
def _mock_db():
    mock_session = SimpleNamespace(query=lambda *args, **kwargs: SimpleNamespace(first=lambda: True))
    with patch("extensions.ext_database.db.session", mock_session):
        yield


@pytest.fixture
def app() -> Flask:
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture
def controller_module(monkeypatch: pytest.MonkeyPatch):
    module_name = "controllers.console.workspace.tool_providers"
    global _CONTROLLER_MODULE
    if _CONTROLLER_MODULE is None:

        def _noop(func):
            return func

        patch_targets = [
            ("libs.login.login_required", _noop),
            ("controllers.console.wraps.setup_required", _noop),
            ("controllers.console.wraps.account_initialization_required", _noop),
            ("controllers.console.wraps.is_admin_or_owner_required", _noop),
            ("controllers.console.wraps.enterprise_license_required", _noop),
        ]
        for target, value in patch_targets:
            patcher = patch(target, value)
            patcher.start()
            _CONTROLLER_PATCHERS.append(patcher)
        monkeypatch.setenv("DIFY_SETUP_READY", "true")
        with _mock_db():
            _CONTROLLER_MODULE = importlib.import_module(module_name)

    module = _CONTROLLER_MODULE
    monkeypatch.setattr(module, "jsonable_encoder", lambda payload: payload)

    # Ensure decorators that consult deployment edition do not reach the database.
    global _WRAPS_MODULE
    wraps_module = importlib.import_module("controllers.console.wraps")
    _WRAPS_MODULE = wraps_module
    monkeypatch.setattr(module.dify_config, "EDITION", "CLOUD")
    monkeypatch.setattr(wraps_module.dify_config, "EDITION", "CLOUD")

    login_module = importlib.import_module("libs.login")
    monkeypatch.setattr(login_module, "check_csrf_token", lambda *args, **kwargs: None)
    return module


def _mock_account(user_id: str = "user-123") -> SimpleNamespace:
    return SimpleNamespace(id=user_id, status="active", is_authenticated=True, current_tenant_id=None)


def _set_current_account(
    monkeypatch: pytest.MonkeyPatch,
    controller_module: ModuleType,
    user: SimpleNamespace,
    tenant_id: str,
) -> None:
    def _getter():
        return user, tenant_id

    user.current_tenant_id = tenant_id

    monkeypatch.setattr(controller_module, "current_account_with_tenant", _getter)
    if _WRAPS_MODULE is not None:
        monkeypatch.setattr(_WRAPS_MODULE, "current_account_with_tenant", _getter)

    login_module = importlib.import_module("libs.login")
    monkeypatch.setattr(login_module, "_get_user", lambda: user)


def test_tool_provider_list_calls_service_with_query(
    app: Flask, controller_module: ModuleType, monkeypatch: pytest.MonkeyPatch
):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-456")

    service_mock = MagicMock(return_value=[{"provider": "builtin"}])
    monkeypatch.setattr(controller_module.ToolCommonService, "list_tool_providers", service_mock)

    with app.test_request_context("/workspaces/current/tool-providers?type=builtin"):
        response = controller_module.ToolProviderListApi().get()

    assert response == [{"provider": "builtin"}]
    service_mock.assert_called_once_with(user.id, "tenant-456", "builtin")


def test_builtin_provider_add_passes_payload(
    app: Flask, controller_module: ModuleType, monkeypatch: pytest.MonkeyPatch
):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-456")

    service_mock = MagicMock(return_value={"status": "ok"})
    monkeypatch.setattr(controller_module.BuiltinToolManageService, "add_builtin_tool_provider", service_mock)

    payload = {
        "credentials": {"api_key": "sk-test"},
        "name": "MyTool",
        "type": controller_module.CredentialType.API_KEY,
    }

    with app.test_request_context(
        "/workspaces/current/tool-provider/builtin/openai/add",
        method="POST",
        json=payload,
    ):
        response = controller_module.ToolBuiltinProviderAddApi().post(provider="openai")

    assert response == {"status": "ok"}
    service_mock.assert_called_once_with(
        user_id="user-123",
        tenant_id="tenant-456",
        provider="openai",
        credentials={"api_key": "sk-test"},
        name="MyTool",
        api_type=controller_module.CredentialType.API_KEY,
    )


def test_builtin_provider_tools_get(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account("user-tenant-789")
    _set_current_account(monkeypatch, controller_module, user, "tenant-789")

    service_mock = MagicMock(return_value=[{"name": "tool-a"}])
    monkeypatch.setattr(controller_module.BuiltinToolManageService, "list_builtin_tool_provider_tools", service_mock)
    monkeypatch.setattr(controller_module, "jsonable_encoder", lambda payload: payload)

    with app.test_request_context(
        "/workspaces/current/tool-provider/builtin/my-provider/tools",
        method="GET",
    ):
        response = controller_module.ToolBuiltinProviderListToolsApi().get(provider="my-provider")

    assert response == [{"name": "tool-a"}]
    service_mock.assert_called_once_with("tenant-789", "my-provider")


def test_builtin_provider_info_get(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account("user-tenant-9")
    _set_current_account(monkeypatch, controller_module, user, "tenant-9")
    service_mock = MagicMock(return_value={"info": True})
    monkeypatch.setattr(controller_module.BuiltinToolManageService, "get_builtin_tool_provider_info", service_mock)

    with app.test_request_context("/info", method="GET"):
        resp = controller_module.ToolBuiltinProviderInfoApi().get(provider="demo")

    assert resp == {"info": True}
    service_mock.assert_called_once_with("tenant-9", "demo")


def test_builtin_provider_credentials_get(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account("user-tenant-cred")
    _set_current_account(monkeypatch, controller_module, user, "tenant-cred")
    service_mock = MagicMock(return_value=[{"cred": 1}])
    monkeypatch.setattr(
        controller_module.BuiltinToolManageService,
        "get_builtin_tool_provider_credentials",
        service_mock,
    )

    with app.test_request_context("/creds", method="GET"):
        resp = controller_module.ToolBuiltinProviderGetCredentialsApi().get(provider="demo")

    assert resp == [{"cred": 1}]
    service_mock.assert_called_once_with(tenant_id="tenant-cred", provider_name="demo")


def test_api_provider_remote_schema_get(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-10")
    service_mock = MagicMock(return_value={"schema": "ok"})
    monkeypatch.setattr(controller_module.ApiToolManageService, "get_api_tool_provider_remote_schema", service_mock)

    with app.test_request_context("/remote?url=https://example.com/"):
        resp = controller_module.ToolApiProviderGetRemoteSchemaApi().get()

    assert resp == {"schema": "ok"}
    service_mock.assert_called_once_with(user.id, "tenant-10", "https://example.com/")


def test_api_provider_list_tools_get(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-11")
    service_mock = MagicMock(return_value=[{"tool": "t"}])
    monkeypatch.setattr(controller_module.ApiToolManageService, "list_api_tool_provider_tools", service_mock)

    with app.test_request_context("/tools?provider=foo"):
        resp = controller_module.ToolApiProviderListToolsApi().get()

    assert resp == [{"tool": "t"}]
    service_mock.assert_called_once_with(user.id, "tenant-11", "foo")


def test_api_provider_get(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-12")
    service_mock = MagicMock(return_value={"provider": "foo"})
    monkeypatch.setattr(controller_module.ApiToolManageService, "get_api_tool_provider", service_mock)

    with app.test_request_context("/get?provider=foo"):
        resp = controller_module.ToolApiProviderGetApi().get()

    assert resp == {"provider": "foo"}
    service_mock.assert_called_once_with(user.id, "tenant-12", "foo")


def test_builtin_provider_credentials_schema_get(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account("user-tenant-13")
    _set_current_account(monkeypatch, controller_module, user, "tenant-13")
    service_mock = MagicMock(return_value={"schema": True})
    monkeypatch.setattr(
        controller_module.BuiltinToolManageService,
        "list_builtin_provider_credentials_schema",
        service_mock,
    )

    with app.test_request_context("/schema", method="GET"):
        resp = controller_module.ToolBuiltinProviderCredentialsSchemaApi().get(
            provider="demo", credential_type="api-key"
        )

    assert resp == {"schema": True}
    service_mock.assert_called_once()


def test_workflow_provider_get_by_tool(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-wf")
    tool_service = MagicMock(return_value={"wf": 1})
    monkeypatch.setattr(
        controller_module.WorkflowToolManageService,
        "get_workflow_tool_by_tool_id",
        tool_service,
    )

    tool_id = "00000000-0000-0000-0000-000000000001"
    with app.test_request_context(f"/workflow?workflow_tool_id={tool_id}"):
        resp = controller_module.ToolWorkflowProviderGetApi().get()

    assert resp == {"wf": 1}
    tool_service.assert_called_once_with(user.id, "tenant-wf", tool_id)


def test_workflow_provider_get_by_app(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-wf2")
    service_mock = MagicMock(return_value={"app": 1})
    monkeypatch.setattr(
        controller_module.WorkflowToolManageService,
        "get_workflow_tool_by_app_id",
        service_mock,
    )

    app_id = "00000000-0000-0000-0000-000000000002"
    with app.test_request_context(f"/workflow?workflow_app_id={app_id}"):
        resp = controller_module.ToolWorkflowProviderGetApi().get()

    assert resp == {"app": 1}
    service_mock.assert_called_once_with(user.id, "tenant-wf2", app_id)


def test_workflow_provider_list_tools(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-wf3")
    service_mock = MagicMock(return_value=[{"id": 1}])
    monkeypatch.setattr(controller_module.WorkflowToolManageService, "list_single_workflow_tools", service_mock)

    tool_id = "00000000-0000-0000-0000-000000000003"
    with app.test_request_context(f"/workflow/tools?workflow_tool_id={tool_id}"):
        resp = controller_module.ToolWorkflowProviderListToolApi().get()

    assert resp == [{"id": 1}]
    service_mock.assert_called_once_with(user.id, "tenant-wf3", tool_id)


def test_builtin_tools_list(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-bt")

    provider = SimpleNamespace(to_dict=lambda: {"name": "builtin"})
    monkeypatch.setattr(
        controller_module.BuiltinToolManageService,
        "list_builtin_tools",
        MagicMock(return_value=[provider]),
    )

    with app.test_request_context("/tools/builtin"):
        resp = controller_module.ToolBuiltinListApi().get()

    assert resp == [{"name": "builtin"}]


def test_api_tools_list(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account("user-tenant-api")
    _set_current_account(monkeypatch, controller_module, user, "tenant-api")

    provider = SimpleNamespace(to_dict=lambda: {"name": "api"})
    monkeypatch.setattr(
        controller_module.ApiToolManageService,
        "list_api_tools",
        MagicMock(return_value=[provider]),
    )

    with app.test_request_context("/tools/api"):
        resp = controller_module.ToolApiListApi().get()

    assert resp == [{"name": "api"}]


def test_workflow_tools_list(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-wf4")

    provider = SimpleNamespace(to_dict=lambda: {"name": "wf"})
    monkeypatch.setattr(
        controller_module.WorkflowToolManageService,
        "list_tenant_workflow_tools",
        MagicMock(return_value=[provider]),
    )

    with app.test_request_context("/tools/workflow"):
        resp = controller_module.ToolWorkflowListApi().get()

    assert resp == [{"name": "wf"}]


def test_tool_labels_list(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account("user-label")
    _set_current_account(monkeypatch, controller_module, user, "tenant-labels")
    monkeypatch.setattr(controller_module.ToolLabelsService, "list_tool_labels", lambda: ["a", "b"])

    with app.test_request_context("/tool-labels"):
        resp = controller_module.ToolLabelsApi().get()

    assert resp == ["a", "b"]
