from __future__ import annotations

import builtins
import importlib
from collections.abc import Callable, Iterator
from contextlib import ExitStack, contextmanager
from inspect import unwrap
from types import FunctionType, ModuleType, SimpleNamespace
from unittest.mock import MagicMock, create_autospec, patch
from uuid import NAMESPACE_URL, uuid5

import pytest
from flask import Flask
from flask.views import MethodView
from sqlalchemy.orm import Session, scoped_session, sessionmaker
from werkzeug.exceptions import Forbidden

from controllers.common.rbac import RBACPermission, Workspace
from controllers.console.datasets.rag_pipeline.datasource_auth import DatasourceAuthOauthCustomClient
from controllers.console.workspace.tool_providers import (
    ApiToolProviderAddPayload,
    ApiToolProviderDeletePayload,
    ApiToolProviderUpdatePayload,
    BuiltinProviderDefaultCredentialPayload,
    BuiltinToolAddPayload,
    BuiltinToolCredentialDeletePayload,
    BuiltinToolUpdatePayload,
    ToolApiListApi,
    ToolApiProviderAddApi,
    ToolApiProviderDeleteApi,
    ToolApiProviderGetApi,
    ToolApiProviderGetRemoteSchemaApi,
    ToolApiProviderListToolsApi,
    ToolApiProviderUpdateApi,
    ToolBuiltinListApi,
    ToolBuiltinProviderAddApi,
    ToolBuiltinProviderCredentialsSchemaApi,
    ToolBuiltinProviderDeleteApi,
    ToolBuiltinProviderGetCredentialInfoApi,
    ToolBuiltinProviderGetCredentialsApi,
    ToolBuiltinProviderGetOauthClientSchemaApi,
    ToolBuiltinProviderIconApi,
    ToolBuiltinProviderInfoApi,
    ToolBuiltinProviderListToolsApi,
    ToolBuiltinProviderSetDefaultApi,
    ToolBuiltinProviderUpdateApi,
    ToolLabelsApi,
    ToolOAuthCallback,
    ToolOAuthCustomClient,
    ToolOAuthCustomClientPayload,
    ToolPluginOAuthApi,
    ToolProviderListApi,
    ToolWorkflowListApi,
    ToolWorkflowProviderCreateApi,
    ToolWorkflowProviderDeleteApi,
    ToolWorkflowProviderGetApi,
    ToolWorkflowProviderUpdateApi,
    WorkflowToolCreatePayload,
    WorkflowToolDeletePayload,
    WorkflowToolUpdatePayload,
    is_valid_url,
)
from core.tools.entities.api_entities import ToolProviderApiEntity as CoreToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolParameter
from enums import DeploymentEdition
from models import Account as _tool_providers_Account
from models import BuiltinToolProvider, Tenant, TenantAccountJoin
from models.account import Account as _tool_provider_apis_Account
from models.account import TenantAccountRole
from models.credential_permission import CredentialPermission
from models.enums import PermissionEnum
from repositories.credentials.query_repository import CredentialQueryRepository
from services.credentials.query import CredentialQuery
from services.plugin.dispatch_identity import PluginOAuthClientConfig
from tests.helpers.unit.controllers.rbac_introspection import rbac_checks


class TestOauthCustomClientPermissionsCases:
    @staticmethod
    @pytest.mark.parametrize(
        ("method", "legacy_gate"),
        [
            (ToolOAuthCustomClient.delete, "is_admin_or_owner_required"),
            (DatasourceAuthOauthCustomClient.delete, "edit_permission_required"),
        ],
    )
    def test_custom_oauth_client_delete_requires_management_permission(method: FunctionType, legacy_gate: str) -> None:
        legacy_wrapper = unwrap(method, stop=lambda wrapper: legacy_gate in wrapper.__code__.co_qualname)
        assert legacy_gate in legacy_wrapper.__code__.co_qualname

        # Both routes pass resource_required=False, so their bundle resolves to a Workspace
        # locator regardless of the resource_type they declared (see _single_check).
        [check] = rbac_checks(method)
        assert check.scene == RBACPermission.CREDENTIAL_MANAGE
        assert isinstance(check.locator, Workspace)


"""Unit tests for controllers.console.workspace.tool_providers endpoints."""


def empty_mapping() -> dict[str, object]:
    return {}


def empty_list() -> list[object]:
    return []


def emoji_icon() -> dict[str, str]:
    return {"content": "tool", "background": "#252525"}


def i18n(text: str) -> dict[str, str]:
    return {"en_US": text}


def tool_payload(name: str = "ping") -> dict[str, object]:
    return {
        "author": "langgenius",
        "name": name,
        "label": i18n(name.title()),
        "description": i18n(f"{name} description"),
        "parameters": [],
        "labels": ["utilities"],
        "output_schema": {},
    }


def provider_payload(
    *,
    provider_id: str = "provider-1",
    name: str = "provider",
    provider_type: str = "builtin",
    tools: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "id": provider_id,
        "author": "langgenius",
        "name": name,
        "description": i18n(f"{name} description"),
        "icon": emoji_icon(),
        "icon_dark": emoji_icon(),
        "label": i18n(name.title()),
        "type": provider_type,
        "masked_credentials": {"api_key": "[__HIDDEN__]"},
        "original_credentials": {"api_key": "sk-secret"},
        "is_team_authorization": False,
        "allow_delete": True,
        "plugin_id": "langgenius/provider",
        "plugin_unique_identifier": "langgenius/provider:1.0.0",
        "tools": tools or [tool_payload()],
        "labels": ["utilities"],
        "server_url": "",
        "updated_at": 1710000000,
        "server_identifier": "",
        "masked_headers": None,
        "original_headers": None,
        "authentication": None,
        "is_dynamic_registration": True,
        "configuration": None,
        "identity_mode": "off",
        "workflow_app_id": None,
    }


def provider_entity(
    *,
    provider_id: str = "provider-1",
    name: str = "provider",
    provider_type: str = "builtin",
    tools: list[dict[str, object]] | None = None,
) -> CoreToolProviderApiEntity:
    return CoreToolProviderApiEntity.model_validate(
        provider_payload(provider_id=provider_id, name=name, provider_type=provider_type, tools=tools)
    )


def credential_payload() -> dict[str, object]:
    return {
        "id": "credential-1",
        "name": "Default credential",
        "provider": "provider",
        "credential_type": "api-key",
        "is_default": True,
        "credentials": {"api_key": "masked"},
        "visibility": "all_team_members",
        "created_by": "user-1",
        "partial_member_list": [],
        "from_other_member": False,
    }


def provider_config_payload() -> dict[str, object]:
    return {"type": "secret-input", "name": "api_key", "required": True}


def api_tool_bundle_payload() -> dict[str, object]:
    return {
        "server_url": "https://api.example.com",
        "method": "get",
        "summary": "Ping",
        "operation_id": "ping",
        "parameters": [],
        "author": "langgenius",
        "icon": None,
        "openapi": {"operationId": "ping"},
        "output_schema": {},
    }


def api_provider_detail_payload() -> dict[str, object]:
    return {
        "schema_type": "openapi",
        "schema": "{}",
        "tools": [api_tool_bundle_payload()],
        "icon": emoji_icon(),
        "description": "API provider",
        "credentials": {},
        "privacy_policy": "",
        "custom_disclaimer": "",
        "labels": ["utilities"],
    }


def credential_info_payload() -> dict[str, object]:
    return {
        "supported_credential_types": ["api-key", "oauth2"],
        "is_oauth_custom_client_enabled": False,
        "credentials": [credential_payload()],
    }


def oauth_client_schema_payload() -> dict[str, object]:
    return {
        "schema": [provider_config_payload()],
        "is_oauth_custom_client_enabled": False,
        "is_system_oauth_params_exists": True,
        "client_params": {"client_id": "masked"},
        "redirect_uri": "https://console.example.com/oauth/callback",
    }


def tool_label_payload() -> dict[str, object]:
    return {
        "name": "utilities",
        "label": i18n("Utilities"),
        "icon": "wrench",
    }


def make_account(*, id: str = "u", role: TenantAccountRole = TenantAccountRole.EDITOR) -> _tool_provider_apis_Account:
    account = _tool_provider_apis_Account(name="Alice", email=f"{id}@example.com")
    account.id = id
    account.role = role
    return account


class TestToolProviderApisCases:
    @staticmethod
    @pytest.fixture
    def credential_query() -> Iterator[MagicMock]:
        query = create_autospec(CredentialQuery, instance=True, spec_set=True)
        with patch(
            "controllers.console.workspace.tool_providers.application_services",
            return_value=SimpleNamespace(credential_queries=query),
        ):
            yield query

    class TestUtils:
        def test_is_valid_url(self) -> None:
            assert is_valid_url("https://example.com")
            assert is_valid_url("http://example.com")
            assert not is_valid_url("")
            assert not is_valid_url("ftp://example.com")
            assert not is_valid_url("not-a-url")
            assert not is_valid_url(None)  # type: ignore[arg-type]

    class TestToolProviderListApi:
        def test_get_success(self, app: Flask) -> None:
            api = ToolProviderListApi()
            method = unwrap(api.get)

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.workspace.tool_providers.ToolCommonService.list_tool_providers",
                    return_value=[provider_entity(provider_id="p1").to_dict()],
                ),
            ):
                result = method(api, "t1", make_account(id="u1"))

            assert result[0]["id"] == "p1"
            assert result[0]["team_credentials"] == {"api_key": "[__HIDDEN__]"}
            assert "masked_credentials" not in result[0]
            assert "original_credentials" not in result[0]
            assert result[0]["tools"][0]["name"] == "ping"

    class TestBuiltinProviderApis:
        def test_list_tools(self, app: Flask) -> None:
            api = ToolBuiltinProviderListToolsApi()
            method = unwrap(api.get)

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.workspace.tool_providers.BuiltinToolManageService.list_builtin_tool_provider_tools",
                    return_value=[tool_payload()],
                ),
            ):
                assert method(api, "t1", "provider")[0]["name"] == "ping"

        def test_info(self, app: Flask) -> None:
            api = ToolBuiltinProviderInfoApi()
            method = unwrap(api.get)

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_builtin_tool_provider_info",
                    return_value=provider_entity(),
                ),
            ):
                result = method(api, "t1", "provider")

            assert result["id"] == "provider-1"
            assert result["team_credentials"] == {"api_key": "[__HIDDEN__]"}
            assert "masked_credentials" not in result
            assert "original_credentials" not in result

        def test_delete(self, app: Flask) -> None:
            api = ToolBuiltinProviderDeleteApi()
            method = unwrap(api.post)

            with (
                app.test_request_context("/", json={"credential_id": "cid"}),
                patch(
                    "controllers.console.workspace.tool_providers.BuiltinToolManageService.delete_builtin_tool_provider",
                    return_value={"result": "success"},
                ),
            ):
                req = BuiltinToolCredentialDeletePayload(credential_id="cid")
                assert method(api, req, "t1", "provider")["result"] == "success"

        def test_add_invalid_type(self, app: Flask) -> None:
            api = ToolBuiltinProviderAddApi()
            method = unwrap(api.post)

            with (
                app.test_request_context("/", json={"credentials": empty_mapping(), "type": "invalid"}),
            ):
                with pytest.raises(ValueError, match="1 validation error for BuiltinToolAddPayload\\\ntype"):
                    method(
                        api,
                        BuiltinToolAddPayload(credentials=empty_mapping(), type="invalid"),
                        "t",
                        make_account(),
                        "provider",
                    )

        def test_add_success(self, app: Flask) -> None:
            api = ToolBuiltinProviderAddApi()
            method = unwrap(api.post)

            payload = {"credentials": empty_mapping(), "type": "oauth2", "name": "n"}

            with (
                app.test_request_context("/", json=payload),
                patch(
                    "controllers.console.workspace.tool_providers.BuiltinToolManageService.add_builtin_tool_provider",
                    return_value={"result": "success"},
                ),
            ):
                assert (
                    method(api, BuiltinToolAddPayload(**payload), "t", make_account(), "provider")["result"]
                    == "success"
                )

        def test_update(self, app: Flask) -> None:
            api = ToolBuiltinProviderUpdateApi()
            method = unwrap(api.post)

            payload = {"credential_id": "c1", "credentials": empty_mapping(), "name": "n"}

            with (
                app.test_request_context("/", json=payload),
                patch(
                    "controllers.console.workspace.tool_providers.BuiltinToolManageService.update_builtin_tool_provider",
                    return_value={"result": "success"},
                ),
            ):
                req = BuiltinToolUpdatePayload(**payload)
                assert method(api, req, "t", make_account(), "provider")["result"] == "success"

        def test_get_credentials(self, app: Flask, credential_query: MagicMock) -> None:
            api = ToolBuiltinProviderGetCredentialsApi()
            method = unwrap(api.get)

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_builtin_tool_provider_credentials",
                    return_value=[credential_payload()],
                ) as get_credentials,
            ):
                assert method(api, "t", make_account(id="user-1"), "provider")[0]["id"] == "credential-1"
            assert get_credentials.call_args.kwargs["credential_query"] is credential_query

        def test_icon(self, app: Flask) -> None:
            api = ToolBuiltinProviderIconApi()
            method = unwrap(api.get)

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_builtin_tool_provider_icon",
                    return_value=(b"x", "image/png"),
                ),
            ):
                response = method(api, "provider")
                assert response.mimetype == "image/png"

        def test_credentials_schema(self, app: Flask) -> None:
            api = ToolBuiltinProviderCredentialsSchemaApi()
            method = unwrap(api.get)

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.workspace.tool_providers.BuiltinToolManageService.list_builtin_provider_credentials_schema",
                    return_value=[provider_config_payload()],
                ),
            ):
                assert method(api, "t", "provider", "oauth2")[0]["name"] == "api_key"

        def test_set_default_credential(self, app: Flask) -> None:
            api = ToolBuiltinProviderSetDefaultApi()
            method = unwrap(api.post)

            with (
                app.test_request_context("/", json={"id": "c1"}),
                patch(
                    "controllers.console.workspace.tool_providers.BuiltinToolManageService.set_default_provider",
                    return_value={"result": "success"},
                ),
            ):
                req = BuiltinProviderDefaultCredentialPayload(id="c1")
                assert method(api, req, "t", "provider")["result"] == "success"

        def test_get_credential_info(self, app: Flask, credential_query: MagicMock) -> None:
            api = ToolBuiltinProviderGetCredentialInfoApi()
            method = unwrap(api.get)

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_builtin_tool_provider_credential_info",
                    return_value=credential_info_payload(),
                ) as get_info,
            ):
                assert method(api, "t", make_account(), "provider")["credentials"][0]["id"] == "credential-1"
            assert get_info.call_args.kwargs["credential_query"] is credential_query

        def test_get_oauth_client_schema(self, app: Flask) -> None:
            api = ToolBuiltinProviderGetOauthClientSchemaApi()
            method = unwrap(api.get)

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_builtin_tool_provider_oauth_client_schema",
                    return_value=oauth_client_schema_payload(),
                ),
            ):
                assert method(api, "t", "provider")["schema"][0]["name"] == "api_key"

    class TestApiProviderApis:
        def test_add(self, app: Flask) -> None:
            api = ToolApiProviderAddApi()
            method = unwrap(api.post)

            payload = {
                "credentials": empty_mapping(),
                "schema_type": "openapi",
                "schema": "{}",
                "provider": "p",
                "icon": emoji_icon(),
            }

            with (
                app.test_request_context("/", json=payload),
                patch(
                    "controllers.console.workspace.tool_providers.ApiToolManageService.create_api_tool_provider",
                    return_value={"result": "success"},
                ) as create_api_tool_provider,
            ):
                assert method(api, ApiToolProviderAddPayload(**payload), "t", make_account()) == {"result": "success"}

            create_api_tool_provider.assert_called_once()
            assert create_api_tool_provider.call_args.args[3] == emoji_icon()

        def test_remote_schema(self, app: Flask) -> None:
            api = ToolApiProviderGetRemoteSchemaApi()
            method = unwrap(api.get)
            openapi_schema = '{"openapi":"3.0.0","info":{"title":"Demo API","version":"1.0.0"},"paths":{}}'

            with (
                app.test_request_context("/?url=http://x.com"),
                patch(
                    "controllers.console.workspace.tool_providers.ApiToolManageService.get_api_tool_provider_remote_schema",
                    return_value={"schema": openapi_schema},
                ),
            ):
                assert method(api, "t", make_account()) == {"schema": openapi_schema}

        def test_list_tools(self, app: Flask) -> None:
            api = ToolApiProviderListToolsApi()
            method = unwrap(api.get)

            with (
                app.test_request_context("/?provider=p"),
                patch(
                    "controllers.console.workspace.tool_providers.ApiToolManageService.list_api_tool_provider_tools",
                    return_value=[tool_payload("api_ping")],
                ),
            ):
                assert method(api, "t", make_account())[0]["name"] == "api_ping"

        def test_update(self, app: Flask) -> None:
            api = ToolApiProviderUpdateApi()
            method = unwrap(api.post)

            payload = {
                "credentials": empty_mapping(),
                "schema_type": "openapi",
                "schema": "{}",
                "provider": "p",
                "original_provider": "o",
                "icon": emoji_icon(),
                "privacy_policy": "",
                "custom_disclaimer": "",
            }

            with (
                app.test_request_context("/", json=payload),
                patch(
                    "controllers.console.workspace.tool_providers.ApiToolManageService.update_api_tool_provider",
                    return_value={"result": "success"},
                ) as update_api_tool_provider,
            ):
                assert method(api, ApiToolProviderUpdatePayload(**payload), "t", make_account()) == {
                    "result": "success"
                }

            update_api_tool_provider.assert_called_once()
            assert update_api_tool_provider.call_args.args[4] == emoji_icon()

        def test_delete(self, app: Flask) -> None:
            api = ToolApiProviderDeleteApi()
            method = unwrap(api.post)

            with (
                app.test_request_context("/", json={"provider": "p"}),
                patch(
                    "controllers.console.workspace.tool_providers.ApiToolManageService.delete_api_tool_provider",
                    return_value={"result": "success"},
                ),
            ):
                req = ApiToolProviderDeletePayload(provider="p")
                assert method(api, req, "t", make_account())["result"] == "success"

        def test_get(self, app: Flask) -> None:
            api = ToolApiProviderGetApi()
            method = unwrap(api.get)

            with (
                app.test_request_context("/?provider=p"),
                patch(
                    "controllers.console.workspace.tool_providers.ApiToolManageService.get_api_tool_provider",
                    return_value=api_provider_detail_payload(),
                ),
            ):
                assert method(api, "t", make_account())["schema"] == "{}"

    class TestWorkflowApis:
        def test_create(self, app: Flask) -> None:
            api = ToolWorkflowProviderCreateApi()
            method = unwrap(api.post)

            payload = {
                "workflow_app_id": "123e4567-e89b-12d3-a456-426614174000",
                "name": "n",
                "label": "l",
                "description": "d",
                "icon": emoji_icon(),
                "parameters": empty_list(),
            }

            with (
                app.test_request_context("/", json=payload),
                patch(
                    "controllers.console.workspace.tool_providers.WorkflowToolManageService.create_workflow_tool",
                    return_value={"result": "success"},
                ) as create_workflow_tool,
            ):
                assert method(api, WorkflowToolCreatePayload(**payload), "t", make_account()) == {"result": "success"}

            create_workflow_tool.assert_called_once()
            assert create_workflow_tool.call_args.kwargs["icon"] == emoji_icon()

        def test_update_invalid(self, app: Flask) -> None:
            api = ToolWorkflowProviderUpdateApi()
            method = unwrap(api.post)

            payload = {
                "workflow_tool_id": "123e4567-e89b-12d3-a456-426614174000",
                "name": "Tool",
                "label": "Tool Label",
                "description": "A tool",
                "icon": emoji_icon(),
            }

            with (
                app.test_request_context("/", json=payload),
                patch(
                    "controllers.console.workspace.tool_providers.WorkflowToolManageService.update_workflow_tool",
                    return_value={"result": "success"},
                ) as update_workflow_tool,
            ):
                result = method(api, WorkflowToolUpdatePayload(**payload), "t", make_account())
                assert result == {"result": "success"}

            update_workflow_tool.assert_called_once()
            assert update_workflow_tool.call_args.args[5] == emoji_icon()

        def test_delete(self, app: Flask) -> None:
            api = ToolWorkflowProviderDeleteApi()
            method = unwrap(api.post)

            with (
                app.test_request_context("/", json={"workflow_tool_id": "123e4567-e89b-12d3-a456-426614174000"}),
                patch(
                    "controllers.console.workspace.tool_providers.WorkflowToolManageService.delete_workflow_tool",
                    return_value={"result": "success"},
                ),
            ):
                req = WorkflowToolDeletePayload(workflow_tool_id="123e4567-e89b-12d3-a456-426614174000")
                assert method(api, req, "t", make_account())["result"] == "success"

        def test_get_error(self, app: Flask) -> None:
            api = ToolWorkflowProviderGetApi()
            method = unwrap(api.get)

            with (
                app.test_request_context("/"),
            ):
                with pytest.raises(
                    ValueError,
                    match=(
                        "1 validation error for WorkflowToolGetQuery\\\n  Value error, "
                        "workflow_tool_id or workflow_app_id is required"
                    ),
                ):
                    method(api, "t", make_account())

    class TestLists:
        def test_builtin_list(self, app: Flask) -> None:
            api = ToolBuiltinListApi()
            method = unwrap(api.get)

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.workspace.tool_providers.BuiltinToolManageService.list_builtin_tools",
                    return_value=[provider_entity(provider_id="builtin-1")],
                ),
            ):
                assert method(api, "t", make_account())[0]["id"] == "builtin-1"

        def test_api_list(self, app: Flask) -> None:
            api = ToolApiListApi()
            method = unwrap(api.get)

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.workspace.tool_providers.ApiToolManageService.list_api_tools",
                    return_value=[provider_entity(provider_id="api-1", provider_type="api")],
                ),
            ):
                assert method(api, "t")[0]["id"] == "api-1"

        def test_workflow_list(self, app: Flask) -> None:
            api = ToolWorkflowListApi()
            method = unwrap(api.get)

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.workspace.tool_providers.WorkflowToolManageService.list_tenant_workflow_tools",
                    return_value=[provider_entity(provider_id="workflow-1", provider_type="workflow")],
                ),
            ):
                assert method(api, "t", make_account())[0]["id"] == "workflow-1"

    class TestLabels:
        def test_labels(self, app: Flask) -> None:
            api = ToolLabelsApi()
            method = unwrap(api.get)

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.workspace.tool_providers.ToolLabelsService.list_tool_labels",
                    return_value=[tool_label_payload()],
                ),
            ):
                assert method(api)[0]["name"] == "utilities"

    class TestOAuth:
        def test_oauth_no_client(self, app: Flask) -> None:
            api = ToolPluginOAuthApi()
            method = unwrap(api.get)

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_oauth_client",
                    return_value=None,
                ),
            ):
                with pytest.raises(Forbidden):
                    method(api, "t", make_account(), "provider")

        def test_oauth_callback_no_cookie(self, app: Flask) -> None:
            api = ToolOAuthCallback()
            method = unwrap(api.get)

            with app.test_request_context("/"):
                with pytest.raises(Forbidden):
                    method(api, "provider")

    class TestOAuthCustomClient:
        def test_save_custom_client(self, app: Flask) -> None:
            api = ToolOAuthCustomClient()
            method = unwrap(api.post)

            with (
                app.test_request_context("/", json={"client_params": {"a": 1}}),
                patch(
                    "controllers.console.workspace.tool_providers.BuiltinToolManageService.save_custom_oauth_client_params",
                    return_value={"result": "success"},
                ),
            ):
                req = ToolOAuthCustomClientPayload(client_params={"a": 1})
                assert method(api, req, "t", "provider") == {"result": "success"}

        def test_get_custom_client(self, app: Flask) -> None:
            api = ToolOAuthCustomClient()
            method = unwrap(api.get)

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_custom_oauth_client_params",
                    return_value={"client_id": "x"},
                ),
            ):
                assert method(api, "t", "provider") == {"client_id": "x"}

        def test_delete_custom_client(self, app: Flask) -> None:
            api = ToolOAuthCustomClient()
            method = unwrap(api.delete)

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.workspace.tool_providers.BuiltinToolManageService.delete_custom_oauth_client_params",
                    return_value={"result": "success"},
                ),
            ):
                assert method(api, "t", "provider") == {"result": "success"}


"""Endpoint tests for controllers.console.workspace.tool_providers."""


if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


_CONTROLLER_MODULE: ModuleType | None = None
_WRAPS_MODULE: ModuleType | None = None


def _mock_account(user_id: str = "user-123") -> _tool_providers_Account:
    user = _tool_providers_Account(name="Test User", email=f"{user_id}@example.com")
    user.id = _stable_uuid(f"account:{user_id}")
    user.role = TenantAccountRole.NORMAL
    return user


def _stable_uuid(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, value))


def _persist_workspace(session: Session, user: _tool_providers_Account, tenant_name: str) -> Tenant:
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
    session_factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    database_session = scoped_session(session_factory)
    try:
        with (
            patch("extensions.ext_database.db.session", database_session),
            patch(
                "controllers.console.workspace.tool_providers.application_services",
                return_value=SimpleNamespace(
                    credential_queries=CredentialQueryRepository(session_factory=session_factory)
                ),
            ),
        ):
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
    user: _tool_providers_Account,
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


# --- OAuth start + callback: visibility passthrough (PR #39840 review) ---
#
# The OAuth flow stashes the user-chosen visibility in the proxy context on the
# start endpoint, then reads it back on the callback to persist the credential.
# These tests pin down: (a) the value round-trips for the two supported levels,
# and (b) unknown/missing values collapse to ONLY_ME on both ends.


_OAUTH_PROVIDER_PATH = "langgenius/github/github"


def _invoke_oauth_start(
    controller_module: ModuleType,
    app: Flask,
    user: _tool_providers_Account,
    tenant_id: str,
    *,
    query_string: str = "",
    provider: str = _OAUTH_PROVIDER_PATH,
):
    """Call ToolPluginOAuthApi.get bypassing decorators (matches the pattern
    used by test_builtin_provider_credentials_get_reads_repeated_include_ids)."""
    api = controller_module.ToolPluginOAuthApi()
    path = f"/oauth/plugin/{provider}/tool/authorization-url"
    if query_string:
        path = f"{path}?{query_string}"
    with app.test_request_context(path, method="GET"):
        return unwrap(api.get)(api, tenant_id, user, provider=provider)


@contextmanager
def _mock_oauth_start_deps(controller_module: ModuleType, monkeypatch: pytest.MonkeyPatch):
    """Mock everything ToolPluginOAuthApi.get calls out to and capture the
    create_proxy_context kwargs so tests can assert on extra_data."""
    monkeypatch.setattr(
        controller_module.BuiltinToolManageService,
        "get_oauth_client",
        lambda *_args, **_kwargs: PluginOAuthClientConfig(
            "langgenius/github:1.0.0@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {"client_id": "abc"}
        ),
    )
    create_proxy_context = MagicMock(return_value="ctx-id")
    monkeypatch.setattr(controller_module.OAuthProxyService, "create_proxy_context", create_proxy_context)
    auth_response = MagicMock(authorization_url="https://oauth.example.com/authorize", state="s")
    oauth_handler_instance = MagicMock()
    oauth_handler_instance.get_authorization_url.return_value = auth_response
    monkeypatch.setattr(controller_module, "OAuthHandler", MagicMock(return_value=oauth_handler_instance))
    # dump_response is called with the pydantic response class; short-circuit it.
    monkeypatch.setattr(
        controller_module, "dump_response", lambda _cls, obj: {"authorization_url": obj.authorization_url}
    )
    yield create_proxy_context


def _invoke_oauth_callback(
    controller_module: ModuleType,
    app: Flask,
    *,
    stored_visibility: str | None,
    provider: str = _OAUTH_PROVIDER_PATH,
):
    api = controller_module.ToolOAuthCallback()
    ctx = {"user_id": "user-oauth", "tenant_id": "tenant-oauth", "plugin_id": "langgenius/github", "provider": "github"}
    if stored_visibility is not None:
        ctx["visibility"] = stored_visibility
    with app.test_request_context(
        f"/oauth/plugin/{provider}/tool/callback",
        method="GET",
        headers={"Cookie": "context_id=ctx-id"},
    ):
        with patch.object(controller_module.OAuthProxyService, "use_proxy_context", return_value=ctx):
            return unwrap(api.get)(api, provider=provider)


@contextmanager
def _mock_oauth_callback_deps(controller_module: ModuleType, monkeypatch: pytest.MonkeyPatch):
    """Mock everything ToolOAuthCallback.get calls out to and capture the
    add_builtin_tool_provider kwargs so tests can assert visibility."""
    monkeypatch.setattr(
        controller_module.BuiltinToolManageService,
        "get_oauth_client",
        lambda *_args, **_kwargs: PluginOAuthClientConfig(
            "langgenius/github:1.0.0@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {"client_id": "abc"}
        ),
    )
    add_provider = MagicMock()
    monkeypatch.setattr(controller_module.BuiltinToolManageService, "add_builtin_tool_provider", add_provider)
    credentials_response = MagicMock(credentials={"access_token": "tok"}, expires_at=-1)
    oauth_handler_instance = MagicMock()
    oauth_handler_instance.get_credentials.return_value = credentials_response
    monkeypatch.setattr(controller_module, "OAuthHandler", MagicMock(return_value=oauth_handler_instance))
    monkeypatch.setattr(controller_module, "redirect", lambda url: {"redirect": url})
    yield add_provider


class TestToolProvidersCases:
    @staticmethod
    @pytest.fixture
    def app() -> Flask:
        flask_app = Flask(__name__)
        flask_app.config["TESTING"] = True
        return flask_app

    @staticmethod
    @pytest.fixture
    def controller_module(
        monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], sqlite_session_factory
    ):
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
            with ExitStack() as stack:
                for target, value in patch_targets:
                    stack.enter_context(patch(target, value))
                _CONTROLLER_MODULE = importlib.import_module(module_name)

        module = _CONTROLLER_MODULE

        # Ensure decorators that consult deployment edition do not reach the database.
        global _WRAPS_MODULE
        wraps_module = importlib.import_module("controllers.console.wraps")
        _WRAPS_MODULE = wraps_module
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)

        login_module = importlib.import_module("libs.login")
        monkeypatch.setattr(login_module, "check_csrf_token", lambda *args, **kwargs: None)
        monkeypatch.setattr(
            module,
            "application_services",
            lambda: SimpleNamespace(
                credential_queries=CredentialQueryRepository(session_factory=sqlite_session_factory)
            ),
        )
        return module

    @staticmethod
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

    @staticmethod
    def test_builtin_provider_add_passes_payload(
        app: Flask, controller_module: ModuleType, monkeypatch: pytest.MonkeyPatch
    ):
        user = _mock_account()
        user.role = TenantAccountRole.ADMIN
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

    @staticmethod
    def test_builtin_provider_tools_get(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
        user = _mock_account("user-tenant-789")
        _set_current_account(monkeypatch, controller_module, user, "tenant-789")

        service_payload, expected_response = _tool_response(controller_module, "tool-a")
        service_mock = MagicMock(return_value=[service_payload])
        monkeypatch.setattr(
            controller_module.BuiltinToolManageService, "list_builtin_tool_provider_tools", service_mock
        )

        with app.test_request_context(
            "/workspaces/current/tool-provider/builtin/my-provider/tools",
            method="GET",
        ):
            response = controller_module.ToolBuiltinProviderListToolsApi().get(provider="my-provider")

        assert response == [expected_response]
        service_mock.assert_called_once_with("tenant-789", "my-provider")

    @staticmethod
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

    @staticmethod
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

    @staticmethod
    @pytest.mark.parametrize(
        "sqlite_session",
        [(_tool_providers_Account, Tenant, TenantAccountJoin, BuiltinToolProvider, CredentialPermission)],
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

    @staticmethod
    @pytest.mark.parametrize(
        "sqlite_session",
        [(_tool_providers_Account, Tenant, TenantAccountJoin, BuiltinToolProvider, CredentialPermission)],
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
    def test_tool_labels_list(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
        user = _mock_account("user-label")
        _set_current_account(monkeypatch, controller_module, user, "tenant-labels")
        service_payload, expected_response = _tool_label_response(controller_module, "a")
        monkeypatch.setattr(controller_module.ToolLabelsService, "list_tool_labels", lambda: [service_payload])

        with app.test_request_context("/tool-labels"):
            resp = controller_module.ToolLabelsApi().get()

        assert resp == [expected_response]

    # --- _resolve_identity_mode: gating + None-resolution (PR #36839 review) ---

    @staticmethod
    def test_resolve_identity_mode_none_keeps_current_when_enterprise(
        controller_module, config_overrides: Callable[..., None]
    ):
        """None means 'leave unchanged' — fall back to the stored mode (update path)."""
        identity_mode = importlib.import_module("core.entities.mcp_provider").IdentityMode
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)

        resolved = controller_module._resolve_identity_mode(None, current=identity_mode.IDP_TOKEN)

        assert resolved == identity_mode.IDP_TOKEN

    @staticmethod
    def test_resolve_identity_mode_explicit_value_overrides_current(
        controller_module, config_overrides: Callable[..., None]
    ):
        """An explicit value wins over the stored mode."""
        identity_mode = importlib.import_module("core.entities.mcp_provider").IdentityMode
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)

        resolved = controller_module._resolve_identity_mode(identity_mode.OFF, current=identity_mode.IDP_TOKEN)

        assert resolved == identity_mode.OFF

    @staticmethod
    def test_resolve_identity_mode_coerces_non_off_to_off_when_not_enterprise(
        controller_module, config_overrides: Callable[..., None]
    ):
        """Gate: a non-EE deployment must never persist a non-OFF mode — the
        runtime won't forward, so the stored row must not imply it does."""
        identity_mode = importlib.import_module("core.entities.mcp_provider").IdentityMode
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)

        # Both an explicit idp_token request AND an inherited non-OFF current
        # must collapse to OFF.
        assert (
            controller_module._resolve_identity_mode(identity_mode.IDP_TOKEN, current=identity_mode.OFF)
            == identity_mode.OFF
        )
        assert controller_module._resolve_identity_mode(None, current=identity_mode.IDP_TOKEN) == identity_mode.OFF

    @staticmethod
    def test_resolve_identity_mode_off_is_passthrough_when_not_enterprise(
        controller_module, config_overrides: Callable[..., None]
    ):
        """OFF is always fine — the gate only neutralizes non-OFF values."""
        identity_mode = importlib.import_module("core.entities.mcp_provider").IdentityMode
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)

        assert controller_module._resolve_identity_mode(None, current=identity_mode.OFF) == identity_mode.OFF

    @staticmethod
    @pytest.mark.parametrize(
        ("query_visibility", "expected_stored"),
        [
            ("only_me", "only_me"),
            ("all_team_members", "all_team_members"),
        ],
    )
    def test_tool_plugin_oauth_url_stashes_valid_visibility(
        app: Flask,
        controller_module: ModuleType,
        monkeypatch: pytest.MonkeyPatch,
        query_visibility: str,
        expected_stored: str,
    ):
        user = _mock_account("user-oauth")
        _set_current_account(monkeypatch, controller_module, user, "tenant-oauth")

        with _mock_oauth_start_deps(controller_module, monkeypatch) as create_proxy_context:
            _invoke_oauth_start(
                controller_module,
                app,
                user,
                "tenant-oauth",
                query_string=f"visibility={query_visibility}",
            )

        _, kwargs = create_proxy_context.call_args
        assert kwargs["extra_data"] == {
            "visibility": expected_stored,
            "plugin_unique_identifier": "langgenius/github:1.0.0@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }

    @staticmethod
    @pytest.mark.parametrize("query_string", ["", "visibility=partial_members", "visibility=nonsense"])
    def test_tool_plugin_oauth_url_unknown_visibility_falls_back_to_only_me(
        app: Flask,
        controller_module: ModuleType,
        monkeypatch: pytest.MonkeyPatch,
        query_string: str,
    ):
        """Missing, partial_members (rejected for plugin creds), and garbage inputs
        all collapse to only_me — OAuth tokens are personal by default."""
        user = _mock_account("user-oauth-fallback")
        _set_current_account(monkeypatch, controller_module, user, "tenant-oauth")

        with _mock_oauth_start_deps(controller_module, monkeypatch) as create_proxy_context:
            _invoke_oauth_start(
                controller_module,
                app,
                user,
                "tenant-oauth",
                query_string=query_string,
            )

        _, kwargs = create_proxy_context.call_args
        assert kwargs["extra_data"] == {
            "visibility": "only_me",
            "plugin_unique_identifier": "langgenius/github:1.0.0@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }

    @staticmethod
    def test_tool_oauth_callback_rejects_replaced_package_before_dispatch(
        app: Flask, controller_module: ModuleType, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        context = {
            "user_id": "user-oauth",
            "tenant_id": "tenant-oauth",
            "plugin_id": "langgenius/github",
            "provider": "github",
            "plugin_unique_identifier": f"langgenius/github:1.0.0@{'a' * 64}",
        }
        config = PluginOAuthClientConfig(f"langgenius/github:2.0.0@{'b' * 64}", {"client_secret": "test-secret"})
        monkeypatch.setattr(controller_module.OAuthProxyService, "use_proxy_context", lambda _context_id: context)
        monkeypatch.setattr(
            controller_module.BuiltinToolManageService, "get_oauth_client", lambda *_args, **_kwargs: config
        )

        def unexpected_dispatch(*_args: object, **_kwargs: object) -> None:
            raise AssertionError("Changed packages must not receive OAuth credentials")

        monkeypatch.setattr(controller_module.OAuthHandler, "get_credentials", unexpected_dispatch)
        api = controller_module.ToolOAuthCallback()
        with app.test_request_context("/", headers={"Cookie": "context_id=ctx-id"}):
            with pytest.raises(Forbidden, match="Plugin changed"):
                unwrap(api.get)(api, provider=_OAUTH_PROVIDER_PATH)

    @staticmethod
    @pytest.mark.parametrize(
        ("stored", "expected"),
        [
            ("only_me", "only_me"),
            ("all_team_members", "all_team_members"),
        ],
    )
    def test_tool_oauth_callback_persists_stored_visibility(
        app: Flask,
        controller_module: ModuleType,
        monkeypatch: pytest.MonkeyPatch,
        stored: str,
        expected: str,
    ):
        with _mock_oauth_callback_deps(controller_module, monkeypatch) as add_provider:
            _invoke_oauth_callback(controller_module, app, stored_visibility=stored)

        _, kwargs = add_provider.call_args
        assert kwargs["visibility"] == expected
        assert kwargs["api_type"] == controller_module.CredentialType.OAUTH2

    @staticmethod
    @pytest.mark.parametrize("stored", [None, "partial_members", "garbage"])
    def test_tool_oauth_callback_unknown_stored_visibility_falls_back_to_only_me(
        app: Flask,
        controller_module: ModuleType,
        monkeypatch: pytest.MonkeyPatch,
        stored: str | None,
    ):
        """Older proxy contexts (pre-feature) and anything unexpected must default
        to only_me — matches the safe-default we apply on the start endpoint."""
        with _mock_oauth_callback_deps(controller_module, monkeypatch) as add_provider:
            _invoke_oauth_callback(controller_module, app, stored_visibility=stored)

        _, kwargs = add_provider.call_args
        assert kwargs["visibility"] == "only_me"
