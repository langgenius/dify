"""Endpoint tests for controllers.console.workspace.tool_providers."""

from __future__ import annotations

import builtins
import importlib
from contextlib import ExitStack, contextmanager
from inspect import unwrap
from types import ModuleType
from unittest.mock import MagicMock, patch
from uuid import NAMESPACE_URL, uuid5

import pytest
from flask import Flask
from flask.views import MethodView
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from core.tools.entities.api_entities import ToolProviderApiEntity as CoreToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolParameter
from models import Account, BuiltinToolProvider, Tenant, TenantAccountJoin
from models.account import TenantAccountRole
from models.credential_permission import CredentialPermission
from models.enums import PermissionEnum

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


_CONTROLLER_MODULE: ModuleType | None = None
_WRAPS_MODULE: ModuleType | None = None


@pytest.fixture
def app() -> Flask:
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture
def controller_module(monkeypatch: pytest.MonkeyPatch):
    """
    Import the controller with auth decorators neutralized only during import.

    The imported view classes retain those no-op decorators after import, so we
    can restore the original globals immediately and avoid leaking auth patches
    into unrelated tests such as libs.login unit coverage.
    """

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
        monkeypatch.setenv("DIFY_SETUP_READY", "true")
        with ExitStack() as stack:
            for target, value in patch_targets:
                stack.enter_context(patch(target, value))
            _CONTROLLER_MODULE = importlib.import_module(module_name)

    module = _CONTROLLER_MODULE

    # Ensure decorators that consult deployment edition do not reach the database.
    global _WRAPS_MODULE
    wraps_module = importlib.import_module("controllers.console.wraps")
    _WRAPS_MODULE = wraps_module
    monkeypatch.setattr(module.dify_config, "EDITION", "CLOUD")
    monkeypatch.setattr(wraps_module.dify_config, "EDITION", "CLOUD")

    login_module = importlib.import_module("libs.login")
    monkeypatch.setattr(login_module, "check_csrf_token", lambda *args, **kwargs: None)
    return module


def _mock_account(user_id: str = "user-123") -> Account:
    user = Account(name="Test User", email=f"{user_id}@example.com")
    user.id = _stable_uuid(f"account:{user_id}")
    user.role = TenantAccountRole.NORMAL
    return user


def _stable_uuid(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, value))


def _persist_workspace(session: Session, user: Account, tenant_name: str) -> Tenant:
    tenant = Tenant(name=tenant_name)
    tenant.id = _stable_uuid(f"tenant:{tenant_name}")
    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=user.id,
        current=True,
        role=TenantAccountRole.NORMAL,
    )
    session.add_all([user, tenant, membership])
    session.commit()
    return tenant


def _provider_credential(
    *,
    tenant_id: str,
    user_id: str,
    credential_name: str,
    visibility: PermissionEnum = PermissionEnum.ALL_TEAM,
) -> BuiltinToolProvider:
    provider = BuiltinToolProvider(
        name=credential_name,
        tenant_id=tenant_id,
        user_id=user_id,
        provider="demo",
        encrypted_credentials='{"api_key": "sk-secret"}',
        visibility=visibility,
    )
    provider.id = _stable_uuid(f"credential:{tenant_id}:{credential_name}")
    return provider


@contextmanager
def _bind_database_session(session: Session):
    database_session = scoped_session(
        sessionmaker(bind=session.get_bind(), expire_on_commit=False),
    )
    try:
        with patch("extensions.ext_database.db.session", database_session):
            yield
    finally:
        database_session.remove()


@contextmanager
def _mock_credential_encryption(controller_module: ModuleType):
    encrypter = MagicMock()
    encrypter.decrypt.side_effect = lambda credentials: credentials
    encrypter.mask_plugin_credentials.return_value = {"api_key": "[__HIDDEN__]"}
    with (
        patch(
            "services.tools.builtin_tools_manage_service.ToolManager.get_builtin_provider",
            return_value=MagicMock(),
        ),
        patch.object(
            controller_module.BuiltinToolManageService,
            "create_tool_encrypter",
            return_value=(encrypter, MagicMock()),
        ),
    ):
        yield


def _set_current_account(
    monkeypatch: pytest.MonkeyPatch,
    controller_module: ModuleType,
    user: Account,
    tenant_id: str,
) -> None:
    def _getter():
        return user, tenant_id

    monkeypatch.setattr(controller_module, "current_account_with_tenant", _getter, raising=False)
    if _WRAPS_MODULE is not None:
        monkeypatch.setattr(_WRAPS_MODULE, "current_account_with_tenant", _getter)

    login_module = importlib.import_module("libs.login")
    monkeypatch.setattr(login_module, "_get_user", lambda: user)


def _i18n(text: str) -> dict[str, str]:
    return {"en_US": text, "zh_Hans": text, "pt_BR": text, "ja_JP": text}


def _tool_response(controller_module: ModuleType, name: str = "tool-a") -> tuple[dict, dict]:
    expected = {
        "author": "Dify",
        "name": name,
        "label": _i18n(name),
        "description": _i18n(f"{name} description"),
        "parameters": [],
        "labels": [],
        "output_schema": {},
    }
    tool = controller_module.ToolApiEntity.model_validate(expected)
    return tool.model_dump(mode="json"), expected


def _provider_entity_response(
    controller_module: ModuleType, name: str = "provider", provider_type: str = "builtin"
) -> tuple[CoreToolProviderApiEntity, dict]:
    service_payload = {
        "id": f"{name}-id",
        "author": "Dify",
        "name": name,
        "description": _i18n(f"{name} description"),
        "icon": "tool.svg",
        "icon_dark": "",
        "label": _i18n(name),
        "type": provider_type,
        "masked_credentials": {"api_key": "[__HIDDEN__]"},
        "original_credentials": {"api_key": "sk-secret"},
        "is_team_authorization": False,
        "allow_delete": True,
        "plugin_id": "",
        "plugin_unique_identifier": "",
        "tools": [],
        "labels": [],
        "server_url": "",
        "updated_at": 1,
        "server_identifier": "",
        "masked_headers": None,
        "original_headers": None,
        "authentication": None,
        "is_dynamic_registration": True,
        "configuration": None,
        "identity_mode": "off",
        "workflow_app_id": None,
    }
    provider = CoreToolProviderApiEntity.model_validate(service_payload)
    return provider, provider.to_dict()


def _provider_list_item(
    controller_module: ModuleType, name: str = "provider", provider_type: str = "builtin"
) -> tuple[dict, dict]:
    service_payload = {
        "id": f"{name}-id",
        "author": "Dify",
        "name": name,
        "description": _i18n(f"{name} description"),
        "icon": "tool.svg",
        "icon_dark": "",
        "label": _i18n(name),
        "type": provider_type,
        "team_credentials": {"api_key": "[__HIDDEN__]"},
        "is_team_authorization": False,
        "allow_delete": True,
        "plugin_id": "",
        "plugin_unique_identifier": "",
        "tools": [],
        "labels": [],
    }
    expected = {
        **service_payload,
    }
    provider = controller_module.ToolProviderApiEntityResponse.model_validate(expected)
    return service_payload, provider.model_dump(mode="json", exclude_unset=True)


def _provider_config_response(controller_module: ModuleType) -> tuple[dict, dict]:
    expected = {
        "type": "secret-input",
        "name": "api_key",
        "scope": None,
        "required": False,
        "default": None,
        "options": None,
        "multiple": False,
        "label": None,
        "help": None,
        "url": None,
        "placeholder": None,
    }
    config = controller_module.ProviderConfig.model_validate(expected)
    return config.model_dump(mode="json"), expected


def _api_provider_detail_response(controller_module: ModuleType) -> tuple[dict, dict]:
    expected = {
        "schema_type": "openapi",
        "schema": "{}",
        "tools": [],
        "icon": {"background": "#252525", "content": "tool"},
        "description": "provider description",
        "credentials": {"auth_type": "none"},
        "privacy_policy": "",
        "custom_disclaimer": "",
        "labels": [],
    }
    detail = controller_module.ApiProviderDetailResponse.model_validate(expected)
    return detail.model_dump(mode="json", by_alias=True), expected


def _workflow_detail_response(controller_module: ModuleType) -> tuple[dict, dict]:
    tool_payload, tool_expected = _tool_response(controller_module, "workflow-tool")
    expected = {
        "name": "workflow-tool",
        "label": "Workflow Tool",
        "workflow_tool_id": "00000000-0000-0000-0000-000000000001",
        "workflow_app_id": "00000000-0000-0000-0000-000000000002",
        "icon": {"background": "#252525", "content": "tool"},
        "description": "description",
        "parameters": [],
        "output_schema": {},
        "tool": tool_expected,
        "synced": True,
        "privacy_policy": "",
    }
    service_payload = {**expected, "tool": tool_payload}
    detail = controller_module.WorkflowToolDetailResponse.model_validate(service_payload)
    return detail.model_dump(mode="json"), expected


def _tool_label_response(controller_module: ModuleType, name: str = "search") -> tuple[dict, dict]:
    expected = {"name": name, "label": _i18n(name), "icon": "search"}
    label = controller_module.ToolLabel.model_validate(expected)
    return label.model_dump(mode="json"), expected


def test_tool_provider_list_calls_service_with_query(
    app: Flask, controller_module: ModuleType, monkeypatch: pytest.MonkeyPatch
):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-456")

    service_payload, expected_response = _provider_list_item(controller_module, "builtin", "builtin")
    service_mock = MagicMock(return_value=[service_payload])
    monkeypatch.setattr(controller_module.ToolCommonService, "list_tool_providers", service_mock)

    with app.test_request_context("/workspaces/current/tool-providers?type=builtin"):
        response = controller_module.ToolProviderListApi().get()

    assert response == [expected_response]
    service_mock.assert_called_once_with(user.id, "tenant-456", "builtin")


def test_builtin_provider_add_passes_payload(
    app: Flask, controller_module: ModuleType, monkeypatch: pytest.MonkeyPatch
):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-456")

    service_mock = MagicMock(return_value={"result": "success"})
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

    assert response == {"result": "success"}
    service_mock.assert_called_once_with(
        user_id=user.id,
        tenant_id="tenant-456",
        provider="openai",
        credentials={"api_key": "sk-test"},
        name="MyTool",
        api_type=controller_module.CredentialType.API_KEY,
        visibility=None,
    )


def test_builtin_provider_tools_get(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account("user-tenant-789")
    _set_current_account(monkeypatch, controller_module, user, "tenant-789")

    service_payload, expected_response = _tool_response(controller_module, "tool-a")
    service_mock = MagicMock(return_value=[service_payload])
    monkeypatch.setattr(controller_module.BuiltinToolManageService, "list_builtin_tool_provider_tools", service_mock)

    with app.test_request_context(
        "/workspaces/current/tool-provider/builtin/my-provider/tools",
        method="GET",
    ):
        response = controller_module.ToolBuiltinProviderListToolsApi().get(provider="my-provider")

    assert response == [expected_response]
    service_mock.assert_called_once_with("tenant-789", "my-provider")


def test_builtin_provider_info_get(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account("user-tenant-9")
    _set_current_account(monkeypatch, controller_module, user, "tenant-9")
    service_payload, expected_response = _provider_entity_response(controller_module, "demo", "builtin")
    service_mock = MagicMock(return_value=service_payload)
    monkeypatch.setattr(controller_module.BuiltinToolManageService, "get_builtin_tool_provider_info", service_mock)

    with app.test_request_context("/info", method="GET"):
        resp = controller_module.ToolBuiltinProviderInfoApi().get(provider="demo")

    assert resp == expected_response
    service_mock.assert_called_once_with("tenant-9", "demo")


def test_builtin_provider_info_uses_core_to_dict_tool_projection(
    app: Flask, controller_module: ModuleType, monkeypatch: pytest.MonkeyPatch
):
    user = _mock_account("user-tenant-9")
    _set_current_account(monkeypatch, controller_module, user, "tenant-9")
    tool_parameter = ToolParameter(
        name="system_files",
        label=I18nObject(en_US="System Files", zh_Hans="System Files"),
        type=ToolParameter.ToolParameterType.SYSTEM_FILES,
        form=ToolParameter.ToolParameterForm.LLM,
        input_schema=None,
    )
    tool = controller_module.ToolApiEntity(
        author="Dify",
        name="demo-tool",
        label=I18nObject(en_US="Demo Tool", zh_Hans="Demo Tool"),
        description=I18nObject(en_US="Demo Tool description", zh_Hans="Demo Tool description"),
        parameters=[tool_parameter],
        labels=[],
        output_schema={},
    )
    provider = CoreToolProviderApiEntity(
        id="demo-id",
        author="Dify",
        name="demo",
        description=I18nObject(en_US="demo description", zh_Hans="demo description"),
        icon="tool.svg",
        label=I18nObject(en_US="demo", zh_Hans="demo"),
        type=controller_module.ToolProviderType.BUILT_IN,
        masked_credentials={"api_key": "[__HIDDEN__]"},
        original_credentials={"api_key": "sk-secret"},
        tools=[tool],
    )
    service_mock = MagicMock(return_value=provider)
    monkeypatch.setattr(controller_module.BuiltinToolManageService, "get_builtin_tool_provider_info", service_mock)

    with app.test_request_context("/info", method="GET"):
        resp = controller_module.ToolBuiltinProviderInfoApi().get(provider="demo")

    parameter = resp["tools"][0]["parameters"][0]
    assert parameter["type"] == "files"
    assert parameter["input_schema"] is None
    assert resp["team_credentials"] == {"api_key": "[__HIDDEN__]"}
    assert "masked_credentials" not in resp
    assert "original_credentials" not in resp


@pytest.mark.parametrize(
    "sqlite_session",
    [(Account, Tenant, TenantAccountJoin, BuiltinToolProvider, CredentialPermission)],
    indirect=True,
)
def test_builtin_provider_credentials_get(
    app: Flask,
    controller_module: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    user = _mock_account("user-tenant-cred")
    tenant = _persist_workspace(sqlite_session, user, "tenant-cred")
    credential = _provider_credential(
        tenant_id=tenant.id,
        user_id=user.id,
        credential_name="Credential",
    )
    other_tenant = Tenant(name="other-tenant")
    other_tenant.id = _stable_uuid("tenant:other-tenant")
    other_credential = _provider_credential(
        tenant_id=other_tenant.id,
        user_id=user.id,
        credential_name="Other Tenant Credential",
    )
    sqlite_session.add_all([credential, other_tenant, other_credential])
    sqlite_session.commit()
    _set_current_account(monkeypatch, controller_module, user, tenant.id)

    with (
        _bind_database_session(sqlite_session),
        _mock_credential_encryption(controller_module),
        app.test_request_context("/creds", method="GET"),
    ):
        response = controller_module.ToolBuiltinProviderGetCredentialsApi().get(provider="demo")

    assert [item["id"] for item in response] == [credential.id]
    assert response[0]["name"] == "Credential"
    assert response[0]["credentials"] == {"api_key": "[__HIDDEN__]"}
    assert response[0]["created_by"] == user.id
    assert other_credential.id not in {item["id"] for item in response}


@pytest.mark.parametrize(
    "sqlite_session",
    [(Account, Tenant, TenantAccountJoin, BuiltinToolProvider, CredentialPermission)],
    indirect=True,
)
def test_builtin_provider_credentials_get_reads_repeated_include_ids(
    app: Flask,
    controller_module: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    user = _mock_account("user-tenant-cred")
    tenant = _persist_workspace(sqlite_session, user, "tenant-cred")
    visible_credential = _provider_credential(
        tenant_id=tenant.id,
        user_id=user.id,
        credential_name="Visible Credential",
    )
    other_user = _mock_account("other-user")
    borrowed_credential = _provider_credential(
        tenant_id=tenant.id,
        user_id=other_user.id,
        credential_name="Borrowed Credential",
        visibility=PermissionEnum.ONLY_ME,
    )
    other_membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=other_user.id,
        role=TenantAccountRole.NORMAL,
    )
    sqlite_session.add_all([visible_credential, other_user, other_membership, borrowed_credential])
    sqlite_session.commit()

    request_path = (
        f"/creds?include_credential_ids={visible_credential.id}&include_credential_ids={borrowed_credential.id}"
    )
    with (
        _bind_database_session(sqlite_session),
        _mock_credential_encryption(controller_module),
        app.test_request_context(request_path, method="GET"),
    ):
        api = controller_module.ToolBuiltinProviderGetCredentialsApi()
        response = unwrap(api.get)(api, tenant.id, user, provider="demo")

    assert [item["id"] for item in response] == [visible_credential.id, borrowed_credential.id]
    assert response[0]["from_other_member"] is False
    assert response[1]["from_other_member"] is True


def test_api_provider_remote_schema_get(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-10")
    openapi_schema = '{"openapi":"3.0.0","info":{"title":"Demo API","version":"1.0.0"},"paths":{}}'
    service_mock = MagicMock(return_value={"schema": openapi_schema})
    monkeypatch.setattr(controller_module.ApiToolManageService, "get_api_tool_provider_remote_schema", service_mock)

    with app.test_request_context("/remote?url=https://example.com/"):
        resp = controller_module.ToolApiProviderGetRemoteSchemaApi().get()

    assert resp == {"schema": openapi_schema}
    service_mock.assert_called_once_with(user.id, "tenant-10", "https://example.com/")


def test_api_provider_list_tools_get(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-11")
    service_payload, expected_response = _tool_response(controller_module, "t")
    service_mock = MagicMock(return_value=[service_payload])
    monkeypatch.setattr(controller_module.ApiToolManageService, "list_api_tool_provider_tools", service_mock)

    with app.test_request_context("/tools?provider=foo"):
        resp = controller_module.ToolApiProviderListToolsApi().get()

    assert resp == [expected_response]
    service_mock.assert_called_once_with(user.id, "tenant-11", "foo")


def test_api_provider_get(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-12")
    service_payload, expected_response = _api_provider_detail_response(controller_module)
    service_mock = MagicMock(return_value=service_payload)
    monkeypatch.setattr(controller_module.ApiToolManageService, "get_api_tool_provider", service_mock)

    with app.test_request_context("/get?provider=foo"):
        resp = controller_module.ToolApiProviderGetApi().get()

    assert resp == expected_response
    service_mock.assert_called_once_with(user.id, "tenant-12", "foo")


def test_builtin_provider_credentials_schema_get(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account("user-tenant-13")
    _set_current_account(monkeypatch, controller_module, user, "tenant-13")
    service_payload, expected_response = _provider_config_response(controller_module)
    service_mock = MagicMock(return_value=[service_payload])
    monkeypatch.setattr(
        controller_module.BuiltinToolManageService,
        "list_builtin_provider_credentials_schema",
        service_mock,
    )

    with app.test_request_context("/schema", method="GET"):
        resp = controller_module.ToolBuiltinProviderCredentialsSchemaApi().get(
            provider="demo", credential_type="api-key"
        )

    assert resp == [expected_response]
    service_mock.assert_called_once()


def test_workflow_provider_get_by_tool(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-wf")
    service_payload, expected_response = _workflow_detail_response(controller_module)
    tool_service = MagicMock(return_value=service_payload)
    monkeypatch.setattr(
        controller_module.WorkflowToolManageService,
        "get_workflow_tool_by_tool_id",
        tool_service,
    )

    tool_id = "00000000-0000-0000-0000-000000000001"
    with app.test_request_context(f"/workflow?workflow_tool_id={tool_id}"):
        resp = controller_module.ToolWorkflowProviderGetApi().get()

    assert resp == expected_response
    tool_service.assert_called_once_with(user.id, "tenant-wf", tool_id)


def test_workflow_provider_get_by_app(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-wf2")
    service_payload, expected_response = _workflow_detail_response(controller_module)
    service_mock = MagicMock(return_value=service_payload)
    monkeypatch.setattr(
        controller_module.WorkflowToolManageService,
        "get_workflow_tool_by_app_id",
        service_mock,
    )

    app_id = "00000000-0000-0000-0000-000000000002"
    with app.test_request_context(f"/workflow?workflow_app_id={app_id}"):
        resp = controller_module.ToolWorkflowProviderGetApi().get()

    assert resp == expected_response
    service_mock.assert_called_once_with(user.id, "tenant-wf2", app_id)


def test_workflow_provider_list_tools(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-wf3")
    service_payload, expected_response = _tool_response(controller_module, "workflow-tool")
    service_mock = MagicMock(return_value=[service_payload])
    monkeypatch.setattr(controller_module.WorkflowToolManageService, "list_single_workflow_tools", service_mock)

    tool_id = "00000000-0000-0000-0000-000000000003"
    with app.test_request_context(f"/workflow/tools?workflow_tool_id={tool_id}"):
        resp = controller_module.ToolWorkflowProviderListToolApi().get()

    assert resp == [expected_response]
    service_mock.assert_called_once_with(user.id, "tenant-wf3", tool_id)


def test_builtin_tools_list(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-bt")

    provider, expected_response = _provider_entity_response(controller_module, "builtin", "builtin")
    monkeypatch.setattr(
        controller_module.BuiltinToolManageService,
        "list_builtin_tools",
        MagicMock(return_value=[provider]),
    )

    with app.test_request_context("/tools/builtin"):
        resp = controller_module.ToolBuiltinListApi().get()

    assert resp == [expected_response]


def test_api_tools_list(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account("user-tenant-api")
    _set_current_account(monkeypatch, controller_module, user, "tenant-api")

    provider, expected_response = _provider_entity_response(controller_module, "api", "api")
    monkeypatch.setattr(
        controller_module.ApiToolManageService,
        "list_api_tools",
        MagicMock(return_value=[provider]),
    )

    with app.test_request_context("/tools/api"):
        resp = controller_module.ToolApiListApi().get()

    assert resp == [expected_response]


def test_workflow_tools_list(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account()
    _set_current_account(monkeypatch, controller_module, user, "tenant-wf4")

    provider, expected_response = _provider_entity_response(controller_module, "wf", "workflow")
    monkeypatch.setattr(
        controller_module.WorkflowToolManageService,
        "list_tenant_workflow_tools",
        MagicMock(return_value=[provider]),
    )

    with app.test_request_context("/tools/workflow"):
        resp = controller_module.ToolWorkflowListApi().get()

    assert resp == [expected_response]


def test_tool_labels_list(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_account("user-label")
    _set_current_account(monkeypatch, controller_module, user, "tenant-labels")
    service_payload, expected_response = _tool_label_response(controller_module, "a")
    monkeypatch.setattr(controller_module.ToolLabelsService, "list_tool_labels", lambda: [service_payload])

    with app.test_request_context("/tool-labels"):
        resp = controller_module.ToolLabelsApi().get()

    assert resp == [expected_response]


# --- _resolve_identity_mode: gating + None-resolution (PR #36839 review) ---


def test_resolve_identity_mode_none_keeps_current_when_enterprise(controller_module, monkeypatch: pytest.MonkeyPatch):
    """None means 'leave unchanged' — fall back to the stored mode (update path)."""
    identity_mode = importlib.import_module("core.entities.mcp_provider").IdentityMode
    monkeypatch.setattr(controller_module.dify_config, "ENTERPRISE_ENABLED", True)

    resolved = controller_module._resolve_identity_mode(None, current=identity_mode.IDP_TOKEN)

    assert resolved == identity_mode.IDP_TOKEN


def test_resolve_identity_mode_explicit_value_overrides_current(controller_module, monkeypatch: pytest.MonkeyPatch):
    """An explicit value wins over the stored mode."""
    identity_mode = importlib.import_module("core.entities.mcp_provider").IdentityMode
    monkeypatch.setattr(controller_module.dify_config, "ENTERPRISE_ENABLED", True)

    resolved = controller_module._resolve_identity_mode(identity_mode.OFF, current=identity_mode.IDP_TOKEN)

    assert resolved == identity_mode.OFF


def test_resolve_identity_mode_coerces_non_off_to_off_when_not_enterprise(
    controller_module, monkeypatch: pytest.MonkeyPatch
):
    """Gate: a non-EE deployment must never persist a non-OFF mode — the
    runtime won't forward, so the stored row must not imply it does."""
    identity_mode = importlib.import_module("core.entities.mcp_provider").IdentityMode
    monkeypatch.setattr(controller_module.dify_config, "ENTERPRISE_ENABLED", False)

    # Both an explicit idp_token request AND an inherited non-OFF current
    # must collapse to OFF.
    assert (
        controller_module._resolve_identity_mode(identity_mode.IDP_TOKEN, current=identity_mode.OFF)
        == identity_mode.OFF
    )
    assert controller_module._resolve_identity_mode(None, current=identity_mode.IDP_TOKEN) == identity_mode.OFF


def test_resolve_identity_mode_off_is_passthrough_when_not_enterprise(
    controller_module, monkeypatch: pytest.MonkeyPatch
):
    """OFF is always fine — the gate only neutralizes non-OFF values."""
    identity_mode = importlib.import_module("core.entities.mcp_provider").IdentityMode
    monkeypatch.setattr(controller_module.dify_config, "ENTERPRISE_ENABLED", False)

    assert controller_module._resolve_identity_mode(None, current=identity_mode.OFF) == identity_mode.OFF
