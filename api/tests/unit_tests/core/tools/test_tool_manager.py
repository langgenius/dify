from __future__ import annotations

"""Unit tests for ToolManager behavior with mocked providers and collaborators."""

import json
import threading
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import (
    ApiProviderAuthType,
    ToolParameter,
    ToolProviderType,
)
from core.tools.errors import ToolProviderNotFoundError
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.tool_manager import ToolManager


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


def _cm(session: Any):
    context = Mock()
    context.__enter__ = Mock(return_value=session)
    context.__exit__ = Mock(return_value=False)
    return context


def _setup_list_providers_from_api_mocks(
    monkeypatch,
    *,
    session: Mock,
    hardcoded_controller: SimpleNamespace,
    plugin_controller: PluginToolProviderController,
    api_controller: SimpleNamespace,
    workflow_controller: SimpleNamespace,
):
    mock_db = Mock()
    mock_db.engine = object()
    monkeypatch.setattr("core.tools.tool_manager.db", mock_db)
    monkeypatch.setattr("core.tools.tool_manager.Session", lambda *args, **kwargs: _cm(session))
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
        Mock(side_effect=[{"api-1": ["search"]}, {"wf-1": ["utility"]}]),
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


def test_get_tool_runtime_builtin_with_credentials_decrypts_and_forks():
    tool = Mock()
    tool.fork_tool_runtime.return_value = "runtime-tool"
    controller = SimpleNamespace(
        get_tool=Mock(return_value=tool),
        need_credentials=True,
        get_credentials_schema_by_type=Mock(return_value=[]),
    )
    builtin_provider = SimpleNamespace(
        id="cred-1",
        credential_type=CredentialType.API_KEY.value,
        credentials={"encrypted": "value"},
        expires_at=-1,
        user_id="user-1",
    )

    with patch.object(ToolManager, "get_builtin_provider", return_value=controller):
        with patch("core.helper.credential_utils.check_credential_policy_compliance"):
            with patch("core.tools.tool_manager.db") as mock_db:
                mock_db.session.query.return_value.where.return_value.order_by.return_value.first.return_value = (
                    builtin_provider
                )
                encrypter = Mock()
                encrypter.decrypt.return_value = {"api_key": "secret"}
                cache = Mock()
                with patch("core.tools.tool_manager.create_provider_encrypter", return_value=(encrypter, cache)):
                    result = ToolManager.get_tool_runtime(
                        provider_type=ToolProviderType.BUILT_IN,
                        provider_id="time",
                        tool_name="weekday",
                        tenant_id="tenant-1",
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
@patch("core.tools.tool_manager.db")
@patch("core.tools.tool_manager.time.time", return_value=1000)
@patch("core.helper.credential_utils.check_credential_policy_compliance")
def test_get_tool_runtime_builtin_refreshes_expired_oauth_credentials(
    mock_check,
    mock_time,
    mock_db,
    mock_get_oauth_client,
    mock_oauth_handler_cls,
    mock_create_provider_encrypter,
):
    tool = Mock()
    tool.fork_tool_runtime.return_value = "runtime-tool"
    controller = SimpleNamespace(
        get_tool=Mock(return_value=tool),
        need_credentials=True,
        get_credentials_schema_by_type=Mock(return_value=[]),
    )
    builtin_provider = SimpleNamespace(
        id="cred-1",
        credential_type=CredentialType.OAUTH2.value,
        credentials={"encrypted": "value"},
        encrypted_credentials=None,
        expires_at=1,
        user_id="user-1",
    )
    refreshed = SimpleNamespace(credentials={"token": "new"}, expires_at=123456)

    mock_db.session.query.return_value.where.return_value.order_by.return_value.first.return_value = builtin_provider
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
            tenant_id="tenant-1",
        )

    assert result == "runtime-tool"
    assert builtin_provider.expires_at == refreshed.expires_at
    assert builtin_provider.encrypted_credentials == json.dumps({"token": "encrypted"})
    mock_db.session.commit.assert_called_once()
    cache.delete.assert_called_once()


def test_get_tool_runtime_builtin_plugin_provider_deleted_raises():
    plugin_controller = object.__new__(PluginToolProviderController)
    plugin_controller.entity = SimpleNamespace(credentials_schema=[{"name": "k"}], oauth_schema=None)
    plugin_controller.get_tool = Mock(return_value=Mock())
    plugin_controller.get_credentials_schema_by_type = Mock(return_value=[])

    with patch.object(ToolManager, "get_builtin_provider", return_value=plugin_controller):
        with patch("core.tools.tool_manager.is_valid_uuid", return_value=True):
            with patch("core.tools.tool_manager.db") as mock_db:
                mock_db.session.scalar.return_value = None
                with pytest.raises(ToolProviderNotFoundError, match="provider has been deleted"):
                    ToolManager.get_tool_runtime(
                        provider_type=ToolProviderType.BUILT_IN,
                        provider_id="time",
                        tool_name="weekday",
                        tenant_id="tenant-1",
                        credential_id="uuid-id",
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


def test_get_tool_runtime_workflow_path():
    workflow_provider = SimpleNamespace(tenant_id="tenant-1")
    workflow_tool = Mock()
    workflow_tool.fork_tool_runtime.return_value = "wf-runtime"
    workflow_controller = Mock()
    workflow_controller.get_tools.return_value = [workflow_tool]
    session = Mock()
    session.begin.return_value = _cm(None)
    session.scalar.return_value = workflow_provider

    with patch("core.tools.tool_manager.db") as mock_db:
        mock_db.engine = object()
        with patch("core.tools.tool_manager.Session", return_value=_cm(session)):
            with patch(
                "core.tools.tool_manager.ToolTransformService.workflow_provider_to_controller",
                return_value=workflow_controller,
            ):
                assert (
                    ToolManager.get_tool_runtime(
                        provider_type=ToolProviderType.WORKFLOW,
                        provider_id="wf-1",
                        tool_name="wf",
                        tenant_id="tenant-1",
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

    with patch.object(ToolManager, "get_tool_runtime", return_value=tool_runtime):
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
                    invoke_from=InvokeFrom.DEBUGGER,
                    variable_pool=None,
                )

    assert result is tool_runtime
    assert tool_runtime.runtime.runtime_parameters["query"] == "decrypted"


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
    with patch.object(ToolManager, "get_tool_runtime", return_value=tool_runtime2):
        with patch.object(ToolManager, "_convert_tool_parameters_type", return_value={"query": "workflow"}):
            manager = Mock()
            manager.decrypt_tool_parameters.return_value = {"query": "workflow-dec"}
            with patch("core.tools.tool_manager.ToolParameterConfigurationManager", return_value=manager):
                workflow_result = ToolManager.get_workflow_tool_runtime(
                    tenant_id="tenant-1",
                    app_id="app-1",
                    node_id="node-1",
                    workflow_tool=workflow_tool,
                    invoke_from=InvokeFrom.DEBUGGER,
                    variable_pool=None,
                )

    assert workflow_result is tool_runtime2
    assert tool_runtime2.runtime.runtime_parameters["query"] == "workflow-dec"


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

    with patch.object(ToolManager, "get_tool_runtime", return_value=tool_entity):
        result = ToolManager.get_tool_runtime_from_plugin(
            tool_type=ToolProviderType.API,
            tenant_id="tenant-1",
            provider="api-1",
            tool_name="search",
            tool_parameters={"q": "hello", "llm": "ignore"},
        )

    assert result is tool_entity
    assert tool_entity.runtime.runtime_parameters == {"q": "hello"}


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


def test_list_default_builtin_providers_for_postgres_and_mysql():
    provider_records = [SimpleNamespace(id="id-1"), SimpleNamespace(id="id-2")]

    for scheme in ("postgresql", "mysql"):
        session = Mock()
        session.execute.return_value.all.return_value = [SimpleNamespace(id="id-1"), SimpleNamespace(id="id-2")]
        session.query.return_value.where.return_value.all.return_value = provider_records

        with patch("core.tools.tool_manager.dify_config", SimpleNamespace(SQLALCHEMY_DATABASE_URI_SCHEME=scheme)):
            with patch("core.tools.tool_manager.db") as mock_db:
                mock_db.engine = object()
                with patch("core.tools.tool_manager.Session", return_value=_cm(session)):
                    providers = ToolManager.list_default_builtin_providers("tenant-1")

        assert providers == provider_records


def test_list_providers_from_api_covers_builtin_api_workflow_and_mcp(monkeypatch):
    hardcoded_controller = SimpleNamespace(entity=SimpleNamespace(identity=SimpleNamespace(name="hardcoded")))
    plugin_controller = object.__new__(PluginToolProviderController)
    plugin_controller.entity = SimpleNamespace(identity=SimpleNamespace(name="plugin-provider"))

    api_db_provider_good = SimpleNamespace(id="api-1")
    api_db_provider_bad = SimpleNamespace(id="api-2")
    api_controller = SimpleNamespace(provider_id="api-1")

    workflow_db_provider_good = SimpleNamespace(id="wf-1")
    workflow_db_provider_bad = SimpleNamespace(id="wf-2")
    workflow_controller = SimpleNamespace(provider_id="wf-1")

    session = Mock()
    session.scalars.side_effect = [
        SimpleNamespace(all=lambda: [api_db_provider_good, api_db_provider_bad]),
        SimpleNamespace(all=lambda: [workflow_db_provider_good, workflow_db_provider_bad]),
    ]

    _setup_list_providers_from_api_mocks(
        monkeypatch,
        session=session,
        hardcoded_controller=hardcoded_controller,
        plugin_controller=plugin_controller,
        api_controller=api_controller,
        workflow_controller=workflow_controller,
    )
    providers = ToolManager.list_providers_from_api(user_id="user-1", tenant_id="tenant-1", typ="")

    names = {provider.name for provider in providers}
    assert {"hardcoded", "plugin-provider", "api-provider", "workflow-provider", "mcp-provider"} <= names


def test_get_api_provider_controller_returns_controller_and_credentials():
    provider = SimpleNamespace(
        id="api-1",
        tenant_id="tenant-1",
        name="api-provider",
        description="desc",
        credentials={"auth_type": "api_key_query"},
        credentials_str='{"auth_type": "api_key_query", "api_key_value": "secret"}',
        schema_type="openapi",
        schema="schema",
        tools=[],
        icon='{"background": "#000", "content": "A"}',
        privacy_policy="privacy",
        custom_disclaimer="disclaimer",
    )
    db_query = Mock()
    db_query.where.return_value.first.return_value = provider
    controller = Mock()

    with patch("core.tools.tool_manager.db") as mock_db:
        mock_db.session.query.return_value = db_query
        with patch(
            "core.tools.tool_manager.ApiToolProviderController.from_db", return_value=controller
        ) as mock_from_db:
            built_controller, credentials = ToolManager.get_api_provider_controller("tenant-1", "api-1")

    assert built_controller is controller
    assert credentials == provider.credentials
    mock_from_db.assert_called_with(provider, ApiProviderAuthType.API_KEY_QUERY)
    controller.load_bundled_tools.assert_called_once_with(provider.tools)


def test_user_get_api_provider_masks_credentials_and_adds_labels():
    provider = SimpleNamespace(
        id="api-1",
        tenant_id="tenant-1",
        name="api-provider",
        description="desc",
        credentials={"auth_type": "api_key_query"},
        credentials_str='{"auth_type": "api_key_query", "api_key_value": "secret"}',
        schema_type="openapi",
        schema="schema",
        tools=[],
        icon='{"background": "#000", "content": "A"}',
        privacy_policy="privacy",
        custom_disclaimer="disclaimer",
    )
    db_query = Mock()
    db_query.where.return_value.first.return_value = provider
    controller = Mock()

    with patch("core.tools.tool_manager.db") as mock_db:
        mock_db.session.query.return_value = db_query
        with patch("core.tools.tool_manager.ApiToolProviderController.from_db", return_value=controller):
            encrypter = Mock()
            encrypter.decrypt.return_value = {"api_key_value": "secret"}
            encrypter.mask_plugin_credentials.return_value = {"api_key_value": "***"}
            with patch("core.tools.tool_manager.create_tool_provider_encrypter", return_value=(encrypter, Mock())):
                with patch("core.tools.tool_manager.ToolLabelManager.get_tool_labels", return_value=["search"]):
                    user_payload = ToolManager.user_get_api_provider("api-provider", "tenant-1")

    assert user_payload["credentials"]["api_key_value"] == "***"
    assert user_payload["labels"] == ["search"]


def test_get_api_provider_controller_not_found_raises():
    with patch("core.tools.tool_manager.db") as mock_db:
        mock_db.session.query.return_value.where.return_value.first.return_value = None
        with pytest.raises(ToolProviderNotFoundError, match="api provider missing not found"):
            ToolManager.get_api_provider_controller("tenant-1", "missing")


def test_get_mcp_provider_controller_returns_controller():
    provider_entity = SimpleNamespace(provider_icon={"background": "#111", "content": "M"})
    controller = Mock()
    session = Mock()

    with patch("core.tools.tool_manager.db") as mock_db:
        mock_db.engine = object()
        with patch("core.tools.tool_manager.Session", return_value=_cm(session)):
            with patch("core.tools.tool_manager.MCPToolManageService") as mock_service_cls:
                mock_service = mock_service_cls.return_value
                mock_service.get_provider.return_value = provider_entity
                with patch("core.tools.tool_manager.MCPToolProviderController.from_db", return_value=controller):
                    built = ToolManager.get_mcp_provider_controller("tenant-1", "mcp-1")
                assert built is controller


def test_generate_mcp_tool_icon_url_returns_provider_icon():
    provider_entity = SimpleNamespace(provider_icon={"background": "#111", "content": "M"})
    session = Mock()

    with patch("core.tools.tool_manager.db") as mock_db:
        mock_db.engine = object()
        with patch("core.tools.tool_manager.Session", return_value=_cm(session)):
            with patch("core.tools.tool_manager.MCPToolManageService") as mock_service_cls:
                mock_service = mock_service_cls.return_value
                mock_service.get_provider_entity.return_value = provider_entity
                assert ToolManager.generate_mcp_tool_icon_url("tenant-1", "mcp-1") == provider_entity.provider_icon


def test_get_mcp_provider_controller_missing_raises():
    session = Mock()

    with patch("core.tools.tool_manager.db") as mock_db:
        mock_db.engine = object()
        with patch("core.tools.tool_manager.Session", return_value=_cm(session)):
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


def test_generate_tool_icon_urls_for_workflow_and_api():
    workflow_provider = SimpleNamespace(icon='{"background": "#222", "content": "W"}')
    api_provider = SimpleNamespace(icon='{"background": "#333", "content": "A"}')
    with patch("core.tools.tool_manager.db") as mock_db:
        mock_db.session.query.return_value.where.return_value.first.side_effect = [workflow_provider, api_provider]
        assert ToolManager.generate_workflow_tool_icon_url("tenant-1", "wf-1") == {"background": "#222", "content": "W"}
        assert ToolManager.generate_api_tool_icon_url("tenant-1", "api-1") == {"background": "#333", "content": "A"}


def test_generate_tool_icon_urls_missing_workflow_and_api_use_default():
    with patch("core.tools.tool_manager.db") as mock_db:
        mock_db.session.query.return_value.where.return_value.first.return_value = None
        assert ToolManager.generate_workflow_tool_icon_url("tenant-1", "missing")["background"] == "#252525"
        assert ToolManager.generate_api_tool_icon_url("tenant-1", "missing")["background"] == "#252525"


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
