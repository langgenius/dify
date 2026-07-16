"""Unit tests for ToolManager with persisted providers and isolated external collaborators."""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock, patch

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import (
    ApiProviderAuthType,
    ToolInvokeFrom,
    ToolParameter,
    ToolProviderType,
)
from core.tools.errors import ToolProviderNotFoundError
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.tool_manager import ToolManager
from models.base import TypeBase
from models.tools import ApiToolProvider, BuiltinToolProvider, WorkflowToolProvider


@dataclass(frozen=True)
class _ToolDatabase:
    engine: Engine
    session: Session


@pytest.fixture
def tool_database(sqlite_engine: Engine) -> Iterator[_ToolDatabase]:
    """Provide isolated provider tables through the same engine/session split used in production."""

    tables = [
        TypeBase.metadata.tables[model.__tablename__]
        for model in (BuiltinToolProvider, ApiToolProvider, WorkflowToolProvider)
    ]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    with Session(sqlite_engine, expire_on_commit=False) as session:
        yield _ToolDatabase(engine=sqlite_engine, session=session)


def _builtin_provider(
    *,
    provider_id: str,
    tenant_id: str,
    provider: str = "time",
    name: str = "Time credentials",
    encrypted_credentials: str = '{"encrypted":"value"}',
    is_default: bool = True,
    credential_type: CredentialType = CredentialType.API_KEY,
    expires_at: int = -1,
) -> BuiltinToolProvider:
    record = BuiltinToolProvider(
        tenant_id=tenant_id,
        user_id="00000000-0000-0000-0000-000000000099",
        provider=provider,
        name=name,
        encrypted_credentials=encrypted_credentials,
        is_default=is_default,
        credential_type=credential_type,
        expires_at=expires_at,
    )
    record.id = provider_id
    return record


def _api_provider(
    *, provider_id: str, tenant_id: str, name: str = "api-provider", icon: str = '{"background":"#000","content":"A"}'
) -> ApiToolProvider:
    record = ApiToolProvider(
        name=name,
        icon=icon,
        schema="{}",
        schema_type_str="openapi",
        user_id="00000000-0000-0000-0000-000000000099",
        tenant_id=tenant_id,
        description="desc",
        tools_str="[]",
        credentials_str='{"auth_type":"api_key_query","api_key_value":"secret"}',
        privacy_policy="privacy",
        custom_disclaimer="disclaimer",
    )
    record.id = provider_id
    return record


def _workflow_provider(
    *,
    provider_id: str,
    tenant_id: str,
    name: str = "workflow-provider",
    icon: str = '{"background":"#222","content":"W"}',
) -> WorkflowToolProvider:
    record = WorkflowToolProvider(
        name=name,
        label=name,
        icon=icon,
        app_id=provider_id,
        version="1",
        user_id="00000000-0000-0000-0000-000000000099",
        tenant_id=tenant_id,
        description="desc",
        parameter_configuration="[]",
    )
    record.id = provider_id
    return record


class _SimpleContextVar:
    def __init__(self):
        self._is_set = False
        self._value: Any = None

    def get(self):
        if not self._is_set:
            raise LookupError
        return self._value

    def set(self, value: Any):
        self._value = value
        self._is_set = True


def _setup_list_providers_from_api_mocks(
    monkeypatch,
    *,
    tool_database: _ToolDatabase,
    hardcoded_controller: SimpleNamespace,
    plugin_controller: PluginToolProviderController,
    api_controller: SimpleNamespace,
    workflow_controller: SimpleNamespace,
):
    monkeypatch.setattr("core.tools.tool_manager.db", tool_database)
    monkeypatch.setattr(
        "core.tools.tool_manager.dify_config",
        SimpleNamespace(
            SQLALCHEMY_DATABASE_URI_SCHEME="mysql",
            POSITION_TOOL_INCLUDES_SET=None,
            POSITION_TOOL_EXCLUDES_SET=None,
        ),
    )
    monkeypatch.setattr(
        ToolManager,
        "list_builtin_providers",
        Mock(return_value=[hardcoded_controller, plugin_controller]),
    )
    monkeypatch.setattr(
        ToolManager,
        "list_default_builtin_providers",
        Mock(return_value=[SimpleNamespace(provider="hardcoded")]),
    )
    monkeypatch.setattr("core.tools.tool_manager.is_filtered", lambda *args, **kwargs: False)
    monkeypatch.setattr(
        "core.tools.tool_manager.ToolTransformService.builtin_provider_to_user_provider",
        lambda **kwargs: SimpleNamespace(name=kwargs["provider_controller"].entity.identity.name),
    )
    monkeypatch.setattr(
        "core.tools.tool_manager.ToolTransformService.api_provider_to_controller",
        Mock(side_effect=[api_controller, RuntimeError("invalid")]),
    )
    monkeypatch.setattr(
        "core.tools.tool_manager.ToolTransformService.api_provider_to_user_provider",
        Mock(return_value=SimpleNamespace(name="api-provider")),
    )
    monkeypatch.setattr(
        "core.tools.tool_manager.ToolTransformService.workflow_provider_to_controller",
        Mock(side_effect=[workflow_controller, RuntimeError("deleted app")]),
    )
    monkeypatch.setattr(
        "core.tools.tool_manager.ToolTransformService.workflow_provider_to_user_provider",
        Mock(return_value=SimpleNamespace(name="workflow-provider")),
    )
    monkeypatch.setattr(
        "core.tools.tool_manager.ToolLabelManager.get_tools_labels",
        Mock(
            side_effect=[
                {api_controller.provider_id: ["search"]},
                {workflow_controller.provider_id: ["utility"]},
            ]
        ),
    )
    mock_mcp_service = Mock()
    mock_mcp_service.list_providers.return_value = [SimpleNamespace(name="mcp-provider")]
    monkeypatch.setattr("core.tools.tool_manager.MCPToolManageService", Mock(return_value=mock_mcp_service))
    monkeypatch.setattr("core.tools.tool_manager.BuiltinToolProviderSort.sort", lambda providers: providers)


@pytest.fixture(autouse=True)
def _reset_tool_manager_state():
    old_hardcoded = ToolManager._hardcoded_providers.copy()
    old_loaded = ToolManager._builtin_providers_loaded
    old_labels = ToolManager._builtin_tools_labels.copy()
    try:
        yield
    finally:
        ToolManager._hardcoded_providers = old_hardcoded
        ToolManager._builtin_providers_loaded = old_loaded
        ToolManager._builtin_tools_labels = old_labels


def test_get_hardcoded_provider_loads_cache_when_empty():
    provider = Mock()
    ToolManager._hardcoded_providers = {}

    def _load():
        ToolManager._hardcoded_providers["weather"] = provider

    with patch.object(ToolManager, "load_hardcoded_providers_cache", side_effect=_load) as mock_load:
        assert ToolManager.get_hardcoded_provider("weather") is provider

    mock_load.assert_called_once()


def test_get_builtin_provider_returns_plugin_for_missing_hardcoded():
    hardcoded = Mock()
    plugin_provider = Mock()
    ToolManager._hardcoded_providers = {"time": hardcoded}

    with patch.object(ToolManager, "get_plugin_provider", return_value=plugin_provider):
        assert ToolManager.get_builtin_provider("time", "tenant-1") is hardcoded
        assert ToolManager.get_builtin_provider("plugin/time", "tenant-1") is plugin_provider


def test_get_plugin_provider_uses_context_cache():
    provider_context = _SimpleContextVar()
    lock_context = _SimpleContextVar()
    lock_context.set(threading.Lock())
    provider_entity = SimpleNamespace(declaration=Mock(), plugin_id="pid", plugin_unique_identifier="uid")

    with patch("core.tools.tool_manager.contexts.plugin_tool_providers", provider_context):
        with patch("core.tools.tool_manager.contexts.plugin_tool_providers_lock", lock_context):
            with patch("core.tools.tool_manager.PluginToolManager") as mock_manager_cls:
                mock_manager_cls.return_value.fetch_tool_provider.return_value = provider_entity
                controller = SimpleNamespace(name="controller")
                with patch("core.tools.tool_manager.PluginToolProviderController", return_value=controller):
                    built = ToolManager.get_plugin_provider("provider-a", "tenant-1")
                    cached = ToolManager.get_plugin_provider("provider-a", "tenant-1")

    assert built is controller
    assert cached is controller
    mock_manager_cls.return_value.fetch_tool_provider.assert_called_once()


def test_get_plugin_provider_raises_when_provider_missing():
    provider_context = _SimpleContextVar()
    lock_context = _SimpleContextVar()
    lock_context.set(threading.Lock())

    with patch("core.tools.tool_manager.contexts.plugin_tool_providers", provider_context):
        with patch("core.tools.tool_manager.contexts.plugin_tool_providers_lock", lock_context):
            with patch("core.tools.tool_manager.PluginToolManager") as mock_manager_cls:
                mock_manager_cls.return_value.fetch_tool_provider.return_value = None
                with pytest.raises(ToolProviderNotFoundError, match="plugin provider provider-a not found"):
                    ToolManager.get_plugin_provider("provider-a", "tenant-1")


def test_get_tool_runtime_builtin_without_credentials():
    tool = Mock()
    tool.fork_tool_runtime.return_value = "runtime-tool"
    controller = SimpleNamespace(get_tool=Mock(return_value=tool), need_credentials=False)

    with patch.object(ToolManager, "get_builtin_provider", return_value=controller):
        result = ToolManager.get_tool_runtime(
            provider_type=ToolProviderType.BUILT_IN,
            provider_id="time",
            tool_name="current_time",
            tenant_id="tenant-1",
        )

    assert result == "runtime-tool"
    runtime = tool.fork_tool_runtime.call_args.kwargs["runtime"]
    assert runtime.tenant_id == "tenant-1"
    assert runtime.credentials == {}


def test_get_tool_runtime_builtin_missing_tool_raises():
    controller = SimpleNamespace(get_tool=Mock(return_value=None), need_credentials=False)

    with patch.object(ToolManager, "get_builtin_provider", return_value=controller):
        with pytest.raises(ToolProviderNotFoundError, match="builtin tool missing not found"):
            ToolManager.get_tool_runtime(
                provider_type=ToolProviderType.BUILT_IN,
                provider_id="time",
                tool_name="missing",
                tenant_id="tenant-1",
            )


def test_get_tool_runtime_builtin_with_credentials_decrypts_and_forks(
    monkeypatch: pytest.MonkeyPatch, tool_database: _ToolDatabase
):
    tool = Mock()
    tool.fork_tool_runtime.return_value = "runtime-tool"
    controller = SimpleNamespace(
        get_tool=Mock(return_value=tool),
        need_credentials=True,
        get_credentials_schema_by_type=Mock(return_value=[]),
    )
    tenant_id = "00000000-0000-0000-0000-000000000001"
    builtin_provider = _builtin_provider(
        provider_id="00000000-0000-0000-0000-000000000002",
        tenant_id=tenant_id,
    )
    tool_database.session.add(builtin_provider)
    tool_database.session.commit()
    monkeypatch.setattr("core.tools.tool_manager.db", tool_database)

    with patch.object(ToolManager, "get_builtin_provider", return_value=controller):
        with patch("core.helper.credential_utils.check_credential_policy_compliance"):
            encrypter = Mock()
            encrypter.decrypt.return_value = {"api_key": "secret"}
            cache = Mock()
            with patch("core.tools.tool_manager.create_provider_encrypter", return_value=(encrypter, cache)):
                result = ToolManager.get_tool_runtime(
                    provider_type=ToolProviderType.BUILT_IN,
                    provider_id="time",
                    tool_name="weekday",
                    tenant_id=tenant_id,
                )

    assert result == "runtime-tool"
    runtime = tool.fork_tool_runtime.call_args.kwargs["runtime"]
    assert runtime.credentials == {"api_key": "secret"}
    assert runtime.credential_type == CredentialType.API_KEY


@patch("core.tools.tool_manager.create_provider_encrypter")
@patch("core.plugin.impl.oauth.OAuthHandler")
@patch(
    "services.tools.builtin_tools_manage_service.BuiltinToolManageService.get_oauth_client",
    return_value={"client_id": "id"},
)
@patch("core.tools.tool_manager.time.time", return_value=1000)
@patch("core.helper.credential_utils.check_credential_policy_compliance")
def test_get_tool_runtime_builtin_refreshes_expired_oauth_credentials(
    mock_check,
    mock_time,
    mock_get_oauth_client,
    mock_oauth_handler_cls,
    mock_create_provider_encrypter,
    monkeypatch: pytest.MonkeyPatch,
    tool_database: _ToolDatabase,
):
    tool = Mock()
    tool.fork_tool_runtime.return_value = "runtime-tool"
    controller = SimpleNamespace(
        get_tool=Mock(return_value=tool),
        need_credentials=True,
        get_credentials_schema_by_type=Mock(return_value=[]),
    )
    tenant_id = "00000000-0000-0000-0000-000000000001"
    provider_id = "00000000-0000-0000-0000-000000000002"
    builtin_provider = _builtin_provider(
        provider_id=provider_id,
        tenant_id=tenant_id,
        credential_type=CredentialType.OAUTH2,
        expires_at=1,
    )
    refreshed = SimpleNamespace(credentials={"token": "new"}, expires_at=123456)

    tool_database.session.add(builtin_provider)
    tool_database.session.commit()
    monkeypatch.setattr("core.tools.tool_manager.db", tool_database)
    encrypter = Mock()
    encrypter.decrypt.return_value = {"token": "old"}
    encrypter.encrypt.return_value = {"token": "encrypted"}
    cache = Mock()
    mock_create_provider_encrypter.return_value = (encrypter, cache)
    mock_oauth_handler_cls.return_value.refresh_credentials.return_value = refreshed

    with patch.object(ToolManager, "get_builtin_provider", return_value=controller):
        result = ToolManager.get_tool_runtime(
            provider_type=ToolProviderType.BUILT_IN,
            provider_id="time",
            tool_name="weekday",
            tenant_id=tenant_id,
        )

    assert result == "runtime-tool"
    assert builtin_provider.expires_at == refreshed.expires_at
    assert builtin_provider.encrypted_credentials == json.dumps({"token": "encrypted"})
    tool_database.session.expire_all()
    persisted = tool_database.session.get(BuiltinToolProvider, provider_id)
    assert persisted is not None
    assert persisted.expires_at == refreshed.expires_at
    assert persisted.encrypted_credentials == json.dumps({"token": "encrypted"})
    cache.delete.assert_called_once()


def test_get_tool_runtime_builtin_plugin_provider_deleted_raises(
    monkeypatch: pytest.MonkeyPatch, tool_database: _ToolDatabase
):
    plugin_controller = object.__new__(PluginToolProviderController)
    plugin_controller.entity = SimpleNamespace(credentials_schema=[{"name": "k"}], oauth_schema=None)
    plugin_controller.get_tool = Mock(return_value=Mock())
    plugin_controller.get_credentials_schema_by_type = Mock(return_value=[])

    monkeypatch.setattr("core.tools.tool_manager.db", tool_database)
    with patch.object(ToolManager, "get_builtin_provider", return_value=plugin_controller):
        with pytest.raises(ToolProviderNotFoundError, match="provider has been deleted"):
            ToolManager.get_tool_runtime(
                provider_type=ToolProviderType.BUILT_IN,
                provider_id="time",
                tool_name="weekday",
                tenant_id="00000000-0000-0000-0000-000000000001",
                credential_id="00000000-0000-0000-0000-000000000002",
            )


def test_get_tool_runtime_api_path():
    api_tool = Mock()
    api_tool.fork_tool_runtime.return_value = "api-runtime"
    api_provider = Mock()
    api_provider.get_tool.return_value = api_tool

    with patch.object(ToolManager, "get_api_provider_controller", return_value=(api_provider, {"c": "enc"})):
        encrypter = Mock()
        encrypter.decrypt.return_value = {"c": "dec"}
        with patch("core.tools.tool_manager.create_tool_provider_encrypter", return_value=(encrypter, Mock())):
            assert (
                ToolManager.get_tool_runtime(
                    provider_type=ToolProviderType.API,
                    provider_id="api-1",
                    tool_name="search",
                    tenant_id="tenant-1",
                )
                == "api-runtime"
            )


def test_get_tool_runtime_workflow_path(monkeypatch: pytest.MonkeyPatch, tool_database: _ToolDatabase):
    tenant_id = "00000000-0000-0000-0000-000000000001"
    provider_id = "00000000-0000-0000-0000-000000000002"
    workflow_provider = _workflow_provider(provider_id=provider_id, tenant_id=tenant_id)
    tool_database.session.add(workflow_provider)
    tool_database.session.commit()
    monkeypatch.setattr("core.tools.tool_manager.db", tool_database)
    workflow_tool = Mock()
    workflow_tool.fork_tool_runtime.return_value = "wf-runtime"
    workflow_controller = Mock()
    workflow_controller.get_tools.return_value = [workflow_tool]
    with patch(
        "core.tools.tool_manager.ToolTransformService.workflow_provider_to_controller",
        return_value=workflow_controller,
    ):
        assert (
            ToolManager.get_tool_runtime(
                provider_type=ToolProviderType.WORKFLOW,
                provider_id=provider_id,
                tool_name="wf",
                tenant_id=tenant_id,
            )
            == "wf-runtime"
        )


def test_get_tool_runtime_plugin_path():
    with patch.object(
        ToolManager,
        "get_plugin_provider",
        return_value=SimpleNamespace(get_tool=lambda _: "plugin-tool"),
    ):
        assert (
            ToolManager.get_tool_runtime(
                provider_type=ToolProviderType.PLUGIN,
                provider_id="plugin-1",
                tool_name="p",
                tenant_id="tenant-1",
            )
            == "plugin-tool"
        )


def test_get_tool_runtime_mcp_path():
    with patch.object(
        ToolManager,
        "get_mcp_provider_controller",
        return_value=SimpleNamespace(get_tool=lambda _: "mcp-tool"),
    ):
        assert (
            ToolManager.get_tool_runtime(
                provider_type=ToolProviderType.MCP,
                provider_id="mcp-1",
                tool_name="m",
                tenant_id="tenant-1",
            )
            == "mcp-tool"
        )


def test_get_tool_runtime_app_not_implemented():
    with pytest.raises(NotImplementedError, match="app provider not implemented"):
        ToolManager.get_tool_runtime(
            provider_type=ToolProviderType.APP,
            provider_id="app",
            tool_name="x",
            tenant_id="tenant-1",
        )


def test_get_agent_runtime_apply_runtime_parameters():
    parameter = ToolParameter.get_simple_instance(
        name="query",
        llm_description="query",
        typ=ToolParameter.ToolParameterType.STRING,
        required=False,
    )
    parameter.form = ToolParameter.ToolParameterForm.FORM

    tool_runtime = SimpleNamespace(runtime=ToolRuntime(tenant_id="tenant-1", runtime_parameters={}))
    tool_runtime.get_merged_runtime_parameters = Mock(return_value=[parameter])

    with patch.object(ToolManager, "get_tool_runtime", return_value=tool_runtime) as mock_get_tool_runtime:
        with patch.object(ToolManager, "_convert_tool_parameters_type", return_value={"query": "hello"}):
            manager = Mock()
            manager.decrypt_tool_parameters.return_value = {"query": "decrypted"}
            with patch("core.tools.tool_manager.ToolParameterConfigurationManager", return_value=manager):
                agent_tool = SimpleNamespace(
                    provider_type=ToolProviderType.API,
                    provider_id="api-1",
                    tool_name="search",
                    tool_parameters={"query": "hello"},
                    credential_id=None,
                )
                result = ToolManager.get_agent_tool_runtime(
                    tenant_id="tenant-1",
                    app_id="app-1",
                    agent_tool=agent_tool,
                    user_id="user-1",
                    invoke_from=InvokeFrom.DEBUGGER,
                    variable_pool=None,
                )

    assert result is tool_runtime
    assert tool_runtime.runtime.runtime_parameters["query"] == "decrypted"
    mock_get_tool_runtime.assert_called_once_with(
        provider_type=ToolProviderType.API,
        provider_id="api-1",
        tool_name="search",
        tenant_id="tenant-1",
        user_id="user-1",
        invoke_from=InvokeFrom.DEBUGGER,
        tool_invoke_from=ToolInvokeFrom.AGENT,
        credential_id=None,
    )


def test_get_workflow_runtime_apply_runtime_parameters():
    parameter = ToolParameter.get_simple_instance(
        name="query",
        llm_description="query",
        typ=ToolParameter.ToolParameterType.STRING,
        required=False,
    )
    parameter.form = ToolParameter.ToolParameterForm.FORM

    workflow_tool = SimpleNamespace(
        provider_type=ToolProviderType.API,
        provider_id="api-1",
        tool_name="search",
        tool_configurations={"query": "hello"},
        credential_id=None,
    )
    tool_runtime2 = SimpleNamespace(runtime=ToolRuntime(tenant_id="tenant-1", runtime_parameters={}))
    tool_runtime2.get_merged_runtime_parameters = Mock(return_value=[parameter])
    with patch.object(ToolManager, "get_tool_runtime", return_value=tool_runtime2) as mock_get_tool_runtime:
        with patch.object(ToolManager, "_convert_tool_parameters_type", return_value={"query": "workflow"}):
            manager = Mock()
            manager.decrypt_tool_parameters.return_value = {"query": "workflow-dec"}
            with patch("core.tools.tool_manager.ToolParameterConfigurationManager", return_value=manager):
                workflow_result = ToolManager.get_workflow_tool_runtime(
                    tenant_id="tenant-1",
                    app_id="app-1",
                    node_id="node-1",
                    workflow_tool=workflow_tool,
                    user_id="user-1",
                    invoke_from=InvokeFrom.DEBUGGER,
                    variable_pool=None,
                )

    assert workflow_result is tool_runtime2
    assert tool_runtime2.runtime.runtime_parameters["query"] == "workflow-dec"
    mock_get_tool_runtime.assert_called_once_with(
        provider_type=ToolProviderType.API,
        provider_id="api-1",
        tool_name="search",
        tenant_id="tenant-1",
        user_id="user-1",
        invoke_from=InvokeFrom.DEBUGGER,
        tool_invoke_from=ToolInvokeFrom.WORKFLOW,
        credential_id=None,
    )


def test_get_agent_runtime_raises_when_runtime_missing():
    tool_runtime = SimpleNamespace(runtime=None, get_merged_runtime_parameters=lambda: [])
    agent_tool = SimpleNamespace(
        provider_type=ToolProviderType.API,
        provider_id="api-1",
        tool_name="search",
        tool_parameters={},
        credential_id=None,
    )
    with patch.object(ToolManager, "get_tool_runtime", return_value=tool_runtime):
        with patch.object(ToolManager, "_convert_tool_parameters_type", return_value={}):
            with patch("core.tools.tool_manager.ToolParameterConfigurationManager", return_value=Mock()):
                with pytest.raises(ValueError, match="runtime not found"):
                    ToolManager.get_agent_tool_runtime(
                        tenant_id="tenant-1",
                        app_id="app-1",
                        agent_tool=agent_tool,
                    )


def test_get_tool_runtime_from_plugin_only_uses_form_parameters():
    form_param = ToolParameter.get_simple_instance(
        name="q",
        llm_description="query",
        typ=ToolParameter.ToolParameterType.STRING,
        required=False,
    )
    form_param.form = ToolParameter.ToolParameterForm.FORM
    llm_param = ToolParameter.get_simple_instance(
        name="llm",
        llm_description="llm",
        typ=ToolParameter.ToolParameterType.STRING,
        required=False,
    )
    llm_param.form = ToolParameter.ToolParameterForm.LLM

    tool_entity = SimpleNamespace(runtime=ToolRuntime(tenant_id="tenant-1", runtime_parameters={}))
    tool_entity.get_merged_runtime_parameters = Mock(return_value=[form_param, llm_param])

    with patch.object(ToolManager, "get_tool_runtime", return_value=tool_entity) as mock_get_tool_runtime:
        result = ToolManager.get_tool_runtime_from_plugin(
            tool_type=ToolProviderType.API,
            tenant_id="tenant-1",
            provider="api-1",
            tool_name="search",
            tool_parameters={"q": "hello", "llm": "ignore"},
            user_id="user-1",
        )

    assert result is tool_entity
    assert tool_entity.runtime.runtime_parameters == {"q": "hello"}
    mock_get_tool_runtime.assert_called_once_with(
        provider_type=ToolProviderType.API,
        provider_id="api-1",
        tool_name="search",
        tenant_id="tenant-1",
        user_id="user-1",
        invoke_from=InvokeFrom.SERVICE_API,
        tool_invoke_from=ToolInvokeFrom.PLUGIN,
        credential_id=None,
    )


def test_hardcoded_provider_icon_success():
    provider = SimpleNamespace(entity=SimpleNamespace(identity=SimpleNamespace(icon="icon.svg")))
    with patch.object(ToolManager, "get_hardcoded_provider", return_value=provider):
        with patch("core.tools.tool_manager.path.exists", return_value=True):
            with patch("core.tools.tool_manager.mimetypes.guess_type", return_value=("image/svg+xml", None)):
                icon_path, mime = ToolManager.get_hardcoded_provider_icon("time")
    assert icon_path.endswith("icon.svg")
    assert mime == "image/svg+xml"


def test_hardcoded_provider_icon_missing_raises():
    provider = SimpleNamespace(entity=SimpleNamespace(identity=SimpleNamespace(icon="icon.svg")))
    with patch.object(ToolManager, "get_hardcoded_provider", return_value=provider):
        with patch("core.tools.tool_manager.path.exists", return_value=False):
            with pytest.raises(ToolProviderNotFoundError, match="icon not found"):
                ToolManager.get_hardcoded_provider_icon("time")


def test_list_hardcoded_providers_cache_hit():
    ToolManager._hardcoded_providers = {"p": Mock()}
    ToolManager._builtin_providers_loaded = True
    assert list(ToolManager.list_hardcoded_providers()) == list(ToolManager._hardcoded_providers.values())


def test_clear_hardcoded_providers_cache_resets():
    ToolManager._hardcoded_providers = {"p": Mock()}
    ToolManager._builtin_providers_loaded = True
    ToolManager.clear_hardcoded_providers_cache()
    assert ToolManager._hardcoded_providers == {}
    assert ToolManager._builtin_providers_loaded is False


def test_list_hardcoded_providers_internal_loader():
    good_provider = SimpleNamespace(
        entity=SimpleNamespace(identity=SimpleNamespace(name="good")),
        get_tools=lambda: [SimpleNamespace(entity=SimpleNamespace(identity=SimpleNamespace(name="tool-a", label="A")))],
    )
    provider_class = Mock(return_value=good_provider)

    with patch("core.tools.tool_manager.listdir", return_value=["good", "bad", "__skip"]):
        with patch("core.tools.tool_manager.path.isdir", side_effect=lambda p: "good" in p or "bad" in p):
            with patch(
                "core.tools.tool_manager.load_single_subclass_from_source",
                side_effect=[provider_class, RuntimeError("boom")],
            ):
                ToolManager._hardcoded_providers = {}
                ToolManager._builtin_tools_labels = {}
                providers = list(ToolManager._list_hardcoded_providers())

    assert providers == [good_provider]
    assert ToolManager._hardcoded_providers["good"] is good_provider
    assert ToolManager._builtin_tools_labels["tool-a"] == "A"
    assert ToolManager._builtin_providers_loaded is True


def test_get_tool_label_loads_cache_and_handles_missing():
    ToolManager._builtin_tools_labels = {}

    def _load():
        ToolManager._builtin_tools_labels["tool-a"] = "Label A"

    with patch.object(ToolManager, "load_hardcoded_providers_cache", side_effect=_load):
        assert ToolManager.get_tool_label("tool-a") == "Label A"
        assert ToolManager.get_tool_label("missing") is None


def test_list_default_builtin_providers_uses_persisted_defaults(
    monkeypatch: pytest.MonkeyPatch, tool_database: _ToolDatabase
):
    tenant_id = "00000000-0000-0000-0000-000000000001"
    default_provider = _builtin_provider(
        provider_id="00000000-0000-0000-0000-000000000002",
        tenant_id=tenant_id,
        name="default",
        is_default=True,
    )
    older_provider = _builtin_provider(
        provider_id="00000000-0000-0000-0000-000000000003",
        tenant_id=tenant_id,
        name="older",
        is_default=False,
    )
    other_tenant_provider = _builtin_provider(
        provider_id="00000000-0000-0000-0000-000000000004",
        tenant_id="00000000-0000-0000-0000-000000000005",
        name="foreign",
    )
    default_provider.created_at = datetime(2026, 1, 2)
    older_provider.created_at = datetime(2026, 1, 1)
    tool_database.session.add_all([default_provider, older_provider, other_tenant_provider])
    tool_database.session.commit()
    monkeypatch.setattr("core.tools.tool_manager.db", tool_database)
    monkeypatch.setattr(
        "core.tools.tool_manager.dify_config",
        SimpleNamespace(SQLALCHEMY_DATABASE_URI_SCHEME="mysql"),
    )

    providers = ToolManager.list_default_builtin_providers(tenant_id)

    assert [provider.id for provider in providers] == [default_provider.id]


def test_list_providers_from_api_covers_builtin_api_workflow_and_mcp(
    monkeypatch: pytest.MonkeyPatch, tool_database: _ToolDatabase
):
    tenant_id = "00000000-0000-0000-0000-000000000001"
    hardcoded_controller = SimpleNamespace(entity=SimpleNamespace(identity=SimpleNamespace(name="hardcoded")))
    plugin_controller = object.__new__(PluginToolProviderController)
    plugin_controller.entity = SimpleNamespace(identity=SimpleNamespace(name="plugin-provider"))

    api_db_provider_good = _api_provider(
        provider_id="00000000-0000-0000-0000-000000000002", tenant_id=tenant_id, name="api-good"
    )
    api_db_provider_bad = _api_provider(
        provider_id="00000000-0000-0000-0000-000000000003", tenant_id=tenant_id, name="api-bad"
    )
    api_controller = SimpleNamespace(provider_id=api_db_provider_good.id)

    workflow_db_provider_good = _workflow_provider(
        provider_id="00000000-0000-0000-0000-000000000004", tenant_id=tenant_id, name="workflow-good"
    )
    workflow_db_provider_bad = _workflow_provider(
        provider_id="00000000-0000-0000-0000-000000000005", tenant_id=tenant_id, name="workflow-bad"
    )
    workflow_controller = SimpleNamespace(provider_id=workflow_db_provider_good.id)
    tool_database.session.add_all(
        [
            api_db_provider_good,
            api_db_provider_bad,
            _api_provider(
                provider_id="00000000-0000-0000-0000-000000000006",
                tenant_id="00000000-0000-0000-0000-000000000099",
                name="foreign-api",
            ),
            workflow_db_provider_good,
            workflow_db_provider_bad,
            _workflow_provider(
                provider_id="00000000-0000-0000-0000-000000000007",
                tenant_id="00000000-0000-0000-0000-000000000099",
                name="foreign-workflow",
            ),
        ]
    )
    tool_database.session.commit()

    _setup_list_providers_from_api_mocks(
        monkeypatch,
        tool_database=tool_database,
        hardcoded_controller=hardcoded_controller,
        plugin_controller=plugin_controller,
        api_controller=api_controller,
        workflow_controller=workflow_controller,
    )
    providers = ToolManager.list_providers_from_api(user_id="user-1", tenant_id=tenant_id, typ="")

    names = {provider.name for provider in providers}
    assert {"hardcoded", "plugin-provider", "api-provider", "workflow-provider", "mcp-provider"} <= names


def test_get_api_provider_controller_returns_controller_and_credentials(
    monkeypatch: pytest.MonkeyPatch, tool_database: _ToolDatabase
):
    tenant_id = "00000000-0000-0000-0000-000000000001"
    provider = _api_provider(provider_id="00000000-0000-0000-0000-000000000002", tenant_id=tenant_id)
    tool_database.session.add(provider)
    tool_database.session.commit()
    monkeypatch.setattr("core.tools.tool_manager.db", tool_database)
    controller = Mock()

    with patch("core.tools.tool_manager.ApiToolProviderController.from_db", return_value=controller) as mock_from_db:
        built_controller, credentials = ToolManager.get_api_provider_controller(tenant_id, provider.id)

    assert built_controller is controller
    assert credentials == provider.credentials
    mock_from_db.assert_called_with(provider, ApiProviderAuthType.API_KEY_QUERY)
    controller.load_bundled_tools.assert_called_once_with(provider.tools)


def test_user_get_api_provider_masks_credentials_and_adds_labels(
    monkeypatch: pytest.MonkeyPatch, tool_database: _ToolDatabase
):
    tenant_id = "00000000-0000-0000-0000-000000000001"
    provider = _api_provider(provider_id="00000000-0000-0000-0000-000000000002", tenant_id=tenant_id)
    tool_database.session.add(provider)
    tool_database.session.commit()
    monkeypatch.setattr("core.tools.tool_manager.db", tool_database)
    controller = Mock()

    with patch("core.tools.tool_manager.ApiToolProviderController.from_db", return_value=controller):
        encrypter = Mock()
        encrypter.decrypt.return_value = {"api_key_value": "secret"}
        encrypter.mask_plugin_credentials.return_value = {"api_key_value": "***"}
        with patch("core.tools.tool_manager.create_tool_provider_encrypter", return_value=(encrypter, Mock())):
            with patch("core.tools.tool_manager.ToolLabelManager.get_tool_labels", return_value=["search"]):
                user_payload = ToolManager.user_get_api_provider(provider.name, tenant_id)

    assert user_payload["credentials"]["api_key_value"] == "***"
    assert user_payload["labels"] == ["search"]


def test_get_api_provider_controller_not_found_raises(monkeypatch: pytest.MonkeyPatch, tool_database: _ToolDatabase):
    provider_id = "00000000-0000-0000-0000-000000000002"
    tool_database.session.add(
        _api_provider(
            provider_id=provider_id,
            tenant_id="00000000-0000-0000-0000-000000000099",
        )
    )
    tool_database.session.commit()
    monkeypatch.setattr("core.tools.tool_manager.db", tool_database)

    with pytest.raises(ToolProviderNotFoundError, match=f"api provider {provider_id} not found"):
        ToolManager.get_api_provider_controller("00000000-0000-0000-0000-000000000001", provider_id)


def test_get_mcp_provider_controller_returns_controller(monkeypatch: pytest.MonkeyPatch, tool_database: _ToolDatabase):
    provider_entity = SimpleNamespace(provider_icon={"background": "#111", "content": "M"})
    controller = Mock()
    monkeypatch.setattr("core.tools.tool_manager.db", tool_database)
    with patch("core.tools.tool_manager.MCPToolManageService") as mock_service_cls:
        mock_service = mock_service_cls.return_value
        mock_service.get_provider.return_value = provider_entity
        with patch("core.tools.tool_manager.MCPToolProviderController.from_db", return_value=controller):
            built = ToolManager.get_mcp_provider_controller("tenant-1", "mcp-1")
        assert built is controller
        assert isinstance(mock_service_cls.call_args.kwargs["session"], Session)


def test_generate_mcp_tool_icon_url_returns_provider_icon(
    monkeypatch: pytest.MonkeyPatch, tool_database: _ToolDatabase
):
    provider_entity = SimpleNamespace(provider_icon={"background": "#111", "content": "M"})
    monkeypatch.setattr("core.tools.tool_manager.db", tool_database)
    with patch("core.tools.tool_manager.MCPToolManageService") as mock_service_cls:
        mock_service = mock_service_cls.return_value
        mock_service.get_provider_entity.return_value = provider_entity
        assert ToolManager.generate_mcp_tool_icon_url("tenant-1", "mcp-1") == provider_entity.provider_icon
        assert isinstance(mock_service_cls.call_args.kwargs["session"], Session)


def test_get_mcp_provider_controller_missing_raises(monkeypatch: pytest.MonkeyPatch, tool_database: _ToolDatabase):
    monkeypatch.setattr("core.tools.tool_manager.db", tool_database)
    with patch("core.tools.tool_manager.MCPToolManageService") as mock_service_cls:
        mock_service_cls.return_value.get_provider.side_effect = ValueError("missing")
        with pytest.raises(ToolProviderNotFoundError, match="mcp provider mcp-1 not found"):
            ToolManager.get_mcp_provider_controller("tenant-1", "mcp-1")


def test_generate_tool_icon_urls_for_builtin_and_plugin():
    with patch("core.tools.tool_manager.dify_config.CONSOLE_API_URL", "https://console.example.com"):
        builtin_url = ToolManager.generate_builtin_tool_icon_url("time")
        plugin_url = ToolManager.generate_plugin_tool_icon_url("tenant-1", "icon.svg")

    assert builtin_url.endswith("/tool-provider/builtin/time/icon")
    assert "/plugin/icon" in plugin_url


def test_generate_tool_icon_urls_for_workflow_and_api(monkeypatch: pytest.MonkeyPatch, tool_database: _ToolDatabase):
    tenant_id = "00000000-0000-0000-0000-000000000001"
    workflow_provider = _workflow_provider(
        provider_id="00000000-0000-0000-0000-000000000002",
        tenant_id=tenant_id,
    )
    api_provider = _api_provider(
        provider_id="00000000-0000-0000-0000-000000000003",
        tenant_id=tenant_id,
        icon='{"background":"#333","content":"A"}',
    )
    tool_database.session.add_all([workflow_provider, api_provider])
    tool_database.session.commit()
    monkeypatch.setattr("core.tools.tool_manager.db", tool_database)

    assert ToolManager.generate_workflow_tool_icon_url(tenant_id, workflow_provider.id) == {
        "background": "#222",
        "content": "W",
    }
    assert ToolManager.generate_api_tool_icon_url(tenant_id, api_provider.id) == {
        "background": "#333",
        "content": "A",
    }


def test_generate_tool_icon_urls_missing_workflow_and_api_use_default(
    monkeypatch: pytest.MonkeyPatch, tool_database: _ToolDatabase
):
    tenant_id = "00000000-0000-0000-0000-000000000001"
    foreign_tenant_id = "00000000-0000-0000-0000-000000000099"
    workflow_provider_id = "00000000-0000-0000-0000-000000000002"
    api_provider_id = "00000000-0000-0000-0000-000000000003"
    tool_database.session.add_all(
        [
            _workflow_provider(provider_id=workflow_provider_id, tenant_id=foreign_tenant_id),
            _api_provider(provider_id=api_provider_id, tenant_id=foreign_tenant_id),
        ]
    )
    tool_database.session.commit()
    monkeypatch.setattr("core.tools.tool_manager.db", tool_database)

    assert ToolManager.generate_workflow_tool_icon_url(tenant_id, workflow_provider_id)["background"] == "#252525"
    assert ToolManager.generate_api_tool_icon_url(tenant_id, api_provider_id)["background"] == "#252525"


def test_get_tool_icon_for_builtin_provider_variants():
    plugin_provider = object.__new__(PluginToolProviderController)
    plugin_provider.entity = SimpleNamespace(identity=SimpleNamespace(icon="plugin.svg"))

    with patch.object(ToolManager, "get_builtin_provider", return_value=plugin_provider):
        with patch.object(ToolManager, "generate_plugin_tool_icon_url", return_value="plugin-icon"):
            assert ToolManager.get_tool_icon("tenant-1", ToolProviderType.BUILT_IN, "plugin-provider") == "plugin-icon"

    with patch.object(ToolManager, "get_builtin_provider", return_value=SimpleNamespace()):
        with patch.object(ToolManager, "generate_builtin_tool_icon_url", return_value="builtin-icon"):
            assert ToolManager.get_tool_icon("tenant-1", ToolProviderType.BUILT_IN, "time") == "builtin-icon"


def test_get_tool_icon_for_api_workflow_and_mcp():
    with patch.object(ToolManager, "generate_api_tool_icon_url", return_value={"background": "#000"}):
        assert ToolManager.get_tool_icon("tenant-1", ToolProviderType.API, "api-1") == {"background": "#000"}

    with patch.object(ToolManager, "generate_workflow_tool_icon_url", return_value={"background": "#111"}):
        assert ToolManager.get_tool_icon("tenant-1", ToolProviderType.WORKFLOW, "wf-1") == {"background": "#111"}

    with patch.object(ToolManager, "generate_mcp_tool_icon_url", return_value={"background": "#222"}):
        assert ToolManager.get_tool_icon("tenant-1", ToolProviderType.MCP, "mcp-1") == {"background": "#222"}


def test_get_tool_icon_plugin_error_returns_default():
    plugin_provider = object.__new__(PluginToolProviderController)
    plugin_provider.entity = SimpleNamespace(identity=SimpleNamespace(icon="plugin.svg"))

    with patch.object(ToolManager, "get_plugin_provider", return_value=plugin_provider):
        with patch.object(ToolManager, "generate_plugin_tool_icon_url", side_effect=RuntimeError("fail")):
            icon = ToolManager.get_tool_icon("tenant-1", ToolProviderType.PLUGIN, "plugin-provider")
            assert icon["background"] == "#252525"


def test_get_tool_icon_invalid_provider_type_raises():
    with pytest.raises(ValueError, match="provider type"):
        ToolManager.get_tool_icon("tenant-1", "invalid", "x")  # type: ignore[arg-type]


def test_convert_tool_parameters_type_agent_and_workflow_branches():
    file_param = ToolParameter.get_simple_instance(
        name="file",
        llm_description="file",
        typ=ToolParameter.ToolParameterType.FILE,
        required=True,
    )
    file_param.form = ToolParameter.ToolParameterForm.FORM

    with pytest.raises(ValueError, match="file type parameter file not supported in agent"):
        ToolManager._convert_tool_parameters_type(
            parameters=[file_param],
            variable_pool=None,
            tool_configurations={"file": "x"},
            typ="agent",
        )

    text_param = ToolParameter.get_simple_instance(
        name="text",
        llm_description="text",
        typ=ToolParameter.ToolParameterType.STRING,
        required=False,
    )
    text_param.form = ToolParameter.ToolParameterForm.FORM
    plain = ToolManager._convert_tool_parameters_type(
        parameters=[text_param],
        variable_pool=None,
        tool_configurations={"text": "hello"},
        typ="workflow",
    )
    assert plain == {"text": "hello"}

    variable_pool = Mock()
    variable_pool.get.return_value = SimpleNamespace(value="from-variable")
    variable_pool.convert_template.return_value = SimpleNamespace(text="from-template")

    mixed = ToolManager._convert_tool_parameters_type(
        parameters=[text_param],
        variable_pool=variable_pool,
        tool_configurations={"text": {"type": "mixed", "value": "Hello {{name}}"}},
        typ="workflow",
    )
    assert mixed == {"text": "from-template"}

    variable = ToolManager._convert_tool_parameters_type(
        parameters=[text_param],
        variable_pool=variable_pool,
        tool_configurations={"text": {"type": "variable", "value": ["sys", "query"]}},
        typ="workflow",
    )
    assert variable == {"text": "from-variable"}


def test_convert_tool_parameters_type_constant_branch():
    text_param = ToolParameter.get_simple_instance(
        name="text",
        llm_description="text",
        typ=ToolParameter.ToolParameterType.STRING,
        required=False,
    )
    text_param.form = ToolParameter.ToolParameterForm.FORM
    variable_pool = Mock()

    constant = ToolManager._convert_tool_parameters_type(
        parameters=[text_param],
        variable_pool=variable_pool,
        tool_configurations={"text": {"type": "constant", "value": "fixed"}},
        typ="workflow",
    )

    assert constant == {"text": "fixed"}


def test_convert_tool_parameters_type_model_selector_from_legacy_top_level_config():
    model_param = ToolParameter.get_simple_instance(
        name="vision_llm_model",
        llm_description="vision model",
        typ=ToolParameter.ToolParameterType.MODEL_SELECTOR,
        required=True,
    )
    model_param.form = ToolParameter.ToolParameterForm.FORM
    variable_pool = Mock()

    runtime_parameters = ToolManager._convert_tool_parameters_type(
        parameters=[model_param],
        variable_pool=variable_pool,
        tool_configurations={
            "vision_llm_model": {
                "type": "constant",
                "value": "",
                "provider": "langgenius/tongyi/tongyi",
                "model": "qwen3-vl-plus",
                "model_type": "llm",
                "mode": "chat",
            }
        },
        typ="workflow",
    )

    assert runtime_parameters == {
        "vision_llm_model": {
            "provider": "langgenius/tongyi/tongyi",
            "model": "qwen3-vl-plus",
            "model_type": "llm",
            "mode": "chat",
        }
    }


def test_convert_tool_parameters_type_model_selector_from_constant_value_config():
    model_param = ToolParameter.get_simple_instance(
        name="tts_model",
        llm_description="tts model",
        typ=ToolParameter.ToolParameterType.MODEL_SELECTOR,
        required=True,
    )
    model_param.form = ToolParameter.ToolParameterForm.FORM
    variable_pool = Mock()

    runtime_parameters = ToolManager._convert_tool_parameters_type(
        parameters=[model_param],
        variable_pool=variable_pool,
        tool_configurations={
            "tts_model": {
                "type": "constant",
                "value": {
                    "provider": "langgenius/tongyi/tongyi",
                    "model": "qwen3-tts-flash",
                    "model_type": "tts",
                    "language": "Chinese",
                    "voice": "Cherry",
                },
            }
        },
        typ="workflow",
    )

    assert runtime_parameters == {
        "tts_model": {
            "provider": "langgenius/tongyi/tongyi",
            "model": "qwen3-tts-flash",
            "model_type": "tts",
            "language": "Chinese",
            "voice": "Cherry",
        }
    }
