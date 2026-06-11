from __future__ import annotations

from collections.abc import Generator
from typing import Any

import pytest

from core.agent.entities import AgentToolEntity
from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolDescription,
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
    ToolParameter,
)
from core.workflow.nodes.agent_v2.plugin_tools_builder import (
    WorkflowAgentPluginToolsBuilder,
    WorkflowAgentPluginToolsBuildError,
)
from models.agent_config_entities import AgentSoulToolsConfig


class FakeRuntimeProvider:
    def __init__(self, tool: Tool | Exception) -> None:
        # Either a Tool to hand back, or an exception to raise on lookup. The
        # latter lets tests exercise the error-mapping branches in
        # ``WorkflowAgentPluginToolsBuilder._fetch_tool_runtime``.
        self.tool = tool
        self.last_agent_tool: AgentToolEntity | None = None
        self.last_invoke_from: InvokeFrom | None = None

    def get_agent_tool_runtime(
        self,
        tenant_id: str,
        app_id: str,
        agent_tool: AgentToolEntity,
        user_id: str | None = None,
        invoke_from: InvokeFrom = InvokeFrom.DEBUGGER,
        variable_pool: Any | None = None,
    ) -> Tool:
        self.last_agent_tool = agent_tool
        self.last_invoke_from = invoke_from
        if isinstance(self.tool, Exception):
            raise self.tool
        return self.tool


class FakeTool(Tool):
    def tool_provider_type(self):
        raise NotImplementedError

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> ToolInvokeMessage | list[ToolInvokeMessage] | Generator[ToolInvokeMessage, None, None]:
        raise NotImplementedError


def _tool(*, runtime_parameters: dict[str, Any] | None = None) -> FakeTool:
    if runtime_parameters is None:
        runtime_parameters = {"region": "us"}
    parameters = [
        ToolParameter(
            name="query",
            label=I18nObject(en_US="Query"),
            type=ToolParameter.ToolParameterType.STRING,
            form=ToolParameter.ToolParameterForm.LLM,
            required=True,
            llm_description="Search query",
        ),
        ToolParameter(
            name="region",
            label=I18nObject(en_US="Region"),
            type=ToolParameter.ToolParameterType.STRING,
            form=ToolParameter.ToolParameterForm.FORM,
            required=True,
        ),
    ]
    entity = ToolEntity(
        identity=ToolIdentity(
            author="langgenius",
            name="search",
            label=I18nObject(en_US="Search"),
            provider="search",
        ),
        description=ToolDescription(human=I18nObject(en_US="Search"), llm="Search the web."),
        parameters=parameters,
    )
    runtime = ToolRuntime(
        tenant_id="tenant-1",
        user_id="user-1",
        credentials={"api_key": "secret"},
        runtime_parameters=runtime_parameters,
    )
    return FakeTool(entity=entity, runtime=runtime)


def _build(
    builder: WorkflowAgentPluginToolsBuilder,
    tools: AgentSoulToolsConfig,
    *,
    invoke_from: InvokeFrom = InvokeFrom.DEBUGGER,
):
    """Shorthand for ``builder.build(...)`` with the standard tenant/app/user
    triple, so each test only highlights what's actually unique to it."""
    return builder.build(
        tenant_id="tenant-1",
        app_id="app-1",
        user_id="user-1",
        tools=tools,
        invoke_from=invoke_from,
    )


def test_builds_dify_plugin_tools_layer_from_existing_tool_runtime():
    runtime_provider = FakeRuntimeProvider(_tool())
    builder = WorkflowAgentPluginToolsBuilder(tool_runtime_provider=runtime_provider)
    tools = AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {
                    "provider_id": "langgenius/search/search",
                    "tool_name": "search",
                    "credential_type": "api-key",
                    "credential_id": "credential-1",
                    "runtime_parameters": {"region": "us"},
                }
            ]
        }
    )

    result = _build(builder, tools)

    assert result is not None
    prepared = result.tools[0]
    assert prepared.plugin_id == "langgenius/search"
    assert prepared.provider == "search"
    assert prepared.tool_name == "search"
    assert prepared.name == "search"
    assert prepared.credentials == {"api_key": "secret"}
    assert prepared.runtime_parameters == {"region": "us"}
    assert prepared.parameters_json_schema["properties"]["query"]["type"] == "string"
    assert "region" not in prepared.parameters_json_schema["properties"]
    assert runtime_provider.last_agent_tool is not None
    assert runtime_provider.last_agent_tool.credential_id == "credential-1"
    # Default ``provider_type`` is now ``"plugin"`` — the agent tool entity
    # must surface that so ToolManager hits the plugin provider table, not the
    # built-in legacy table.
    assert runtime_provider.last_agent_tool.provider_type.value == "plugin"


def test_rejects_duplicate_exposed_tool_names():
    builder = WorkflowAgentPluginToolsBuilder(tool_runtime_provider=FakeRuntimeProvider(_tool()))
    tools = AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {
                    "provider_id": "langgenius/search/search",
                    "tool_name": "search",
                    "credential_type": "api-key",
                    "credential_id": "credential-1",
                    "runtime_parameters": {"region": "us"},
                },
                {
                    "provider_id": "langgenius/search/search",
                    "tool_name": "search",
                    "credential_type": "api-key",
                    "credential_id": "credential-1",
                    "runtime_parameters": {"region": "us"},
                },
            ]
        }
    )

    with pytest.raises(WorkflowAgentPluginToolsBuildError) as exc_info:
        _build(builder, tools)

    assert exc_info.value.error_code == "agent_tool_name_duplicated"


def test_rejects_missing_required_runtime_parameter():
    builder = WorkflowAgentPluginToolsBuilder(tool_runtime_provider=FakeRuntimeProvider(_tool(runtime_parameters={})))
    tools = AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {
                    "provider_id": "langgenius/search/search",
                    "tool_name": "search",
                    "credential_type": "api-key",
                    "credential_id": "credential-1",
                }
            ]
        }
    )

    with pytest.raises(WorkflowAgentPluginToolsBuildError) as exc_info:
        _build(builder, tools)

    assert exc_info.value.error_code == "agent_tool_runtime_parameter_missing"


# ──────────────────────────────────────────────────────────────────────────────
# invoke_from is threaded through to ToolManager
# ──────────────────────────────────────────────────────────────────────────────


def test_invoke_from_is_forwarded_to_tool_runtime_provider():
    """``WorkflowAgentRuntimeRequestBuilder`` passes the *real* runtime
    invocation source (DEBUGGER for draft test run, SERVICE_API for published
    run, etc.). ToolManager uses ``invoke_from`` for credential quotas / rate
    limits / audit tags, so any default-falling-back here would silently
    misattribute usage. Lock in the forwarding behaviour for both
    representative invoke_from values."""
    for invoke_from in (InvokeFrom.DEBUGGER, InvokeFrom.SERVICE_API, InvokeFrom.WEB_APP):
        runtime_provider = FakeRuntimeProvider(_tool())
        builder = WorkflowAgentPluginToolsBuilder(tool_runtime_provider=runtime_provider)
        tools = AgentSoulToolsConfig.model_validate(
            {
                "dify_tools": [
                    {
                        "provider_id": "langgenius/search/search",
                        "tool_name": "search",
                        "credential_type": "api-key",
                        "credential_id": "credential-1",
                        "runtime_parameters": {"region": "us"},
                    }
                ]
            }
        )

        _build(builder, tools, invoke_from=invoke_from)

        assert runtime_provider.last_invoke_from == invoke_from


# ──────────────────────────────────────────────────────────────────────────────
# disabled tools / plugin_id+provider fallback / unauthorized credentials
# ──────────────────────────────────────────────────────────────────────────────


def test_disabled_tools_are_skipped():
    runtime_provider = FakeRuntimeProvider(_tool())
    builder = WorkflowAgentPluginToolsBuilder(tool_runtime_provider=runtime_provider)
    tools = AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {
                    "provider_id": "langgenius/search/search",
                    "tool_name": "search",
                    "credential_type": "api-key",
                    "credential_id": "credential-1",
                    "runtime_parameters": {"region": "us"},
                    "enabled": False,
                }
            ]
        }
    )

    # All entries are disabled → builder short-circuits and returns None so the
    # request_builder skips adding the tools layer entirely.
    assert _build(builder, tools) is None
    assert runtime_provider.last_agent_tool is None  # ToolManager never queried


def test_plugin_id_plus_provider_fallback_when_provider_id_missing():
    """Frontend may send ``plugin_id`` + ``provider`` instead of the
    concatenated ``provider_id``; the builder must accept both shapes."""
    runtime_provider = FakeRuntimeProvider(_tool())
    builder = WorkflowAgentPluginToolsBuilder(tool_runtime_provider=runtime_provider)
    tools = AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {
                    "plugin_id": "langgenius/search",
                    "provider": "search",
                    "tool_name": "search",
                    "credential_type": "api-key",
                    "credential_id": "credential-1",
                    "runtime_parameters": {"region": "us"},
                }
            ]
        }
    )

    result = _build(builder, tools)

    assert result is not None
    assert runtime_provider.last_agent_tool is not None
    assert runtime_provider.last_agent_tool.provider_id == "langgenius/search/search"
    assert result.tools[0].plugin_id == "langgenius/search"
    assert result.tools[0].provider == "search"


def test_unauthorized_tool_without_credentials():
    """``credential_type=unauthorized`` removes the ``credential_ref.id``
    requirement (e.g. public Wikipedia / current_time tools)."""

    def _no_credentials_tool() -> FakeTool:
        tool = _tool()
        assert tool.runtime is not None
        tool.runtime.credentials = {}
        return tool

    runtime_provider = FakeRuntimeProvider(_no_credentials_tool())
    builder = WorkflowAgentPluginToolsBuilder(tool_runtime_provider=runtime_provider)
    tools = AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {
                    "provider_id": "langgenius/time/time",
                    "tool_name": "current_time",
                    "credential_type": "unauthorized",
                    "runtime_parameters": {"region": "us"},
                }
            ]
        }
    )

    result = _build(builder, tools)
    assert result is not None
    assert result.tools[0].credential_type == "unauthorized"
    assert result.tools[0].credentials == {}


# ──────────────────────────────────────────────────────────────────────────────
# Error-code mapping: declaration not found / credential invalid / config
# ──────────────────────────────────────────────────────────────────────────────


def _standard_tools_payload() -> AgentSoulToolsConfig:
    return AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {
                    "provider_id": "langgenius/search/search",
                    "tool_name": "search",
                    "credential_type": "api-key",
                    "credential_id": "credential-1",
                    "runtime_parameters": {"region": "us"},
                }
            ]
        }
    )


def test_tool_provider_not_found_maps_to_declaration_not_found():
    from core.tools.errors import ToolProviderNotFoundError

    builder = WorkflowAgentPluginToolsBuilder(
        tool_runtime_provider=FakeRuntimeProvider(ToolProviderNotFoundError("provider gone"))
    )
    with pytest.raises(WorkflowAgentPluginToolsBuildError) as exc_info:
        _build(builder, _standard_tools_payload())
    assert exc_info.value.error_code == "agent_tool_declaration_not_found"


def test_credential_validation_error_maps_to_credential_invalid():
    from core.tools.errors import ToolProviderCredentialValidationError

    builder = WorkflowAgentPluginToolsBuilder(
        tool_runtime_provider=FakeRuntimeProvider(ToolProviderCredentialValidationError("creds expired"))
    )
    with pytest.raises(WorkflowAgentPluginToolsBuildError) as exc_info:
        _build(builder, _standard_tools_payload())
    assert exc_info.value.error_code == "agent_tool_credential_invalid"


def test_generic_value_error_maps_to_config_invalid():
    """Bare ``ValueError`` from ToolManager (e.g. "runtime not found") becomes
    ``agent_tool_config_invalid`` — distinct from
    ``agent_tool_declaration_not_found`` so callers can render a different
    hint."""
    builder = WorkflowAgentPluginToolsBuilder(tool_runtime_provider=FakeRuntimeProvider(ValueError("runtime missing")))
    with pytest.raises(WorkflowAgentPluginToolsBuildError) as exc_info:
        _build(builder, _standard_tools_payload())
    assert exc_info.value.error_code == "agent_tool_config_invalid"


# ──────────────────────────────────────────────────────────────────────────────
# Non-scalar credentials rejected instead of silently str()'d
# ──────────────────────────────────────────────────────────────────────────────


def test_rejects_non_scalar_credential_value():
    """If a credential ever shows up shaped like ``{"access_token": "..."}``,
    ``str(value)`` would forward a Python repr to the plugin daemon. The
    builder should refuse and surface an explicit error code so an operator
    fixes the credential schema instead of debugging a daemon JSON parse
    failure."""

    def _dict_credential_tool() -> FakeTool:
        tool = _tool()
        assert tool.runtime is not None
        tool.runtime.credentials = {"oauth": {"access_token": "secret", "expires_in": 3600}}
        return tool

    builder = WorkflowAgentPluginToolsBuilder(tool_runtime_provider=FakeRuntimeProvider(_dict_credential_tool()))
    with pytest.raises(WorkflowAgentPluginToolsBuildError) as exc_info:
        _build(builder, _standard_tools_payload())
    assert exc_info.value.error_code == "agent_tool_credential_shape_invalid"


# ──────────────────────────────────────────────────────────────────────────────
# Legacy payload normalization
# ──────────────────────────────────────────────────────────────────────────────


def test_legacy_provider_name_and_tool_parameters_normalized():
    """Old Composer save payloads used ``provider_name`` / ``tool_parameters``
    keys. The ``@model_validator(mode="before")`` on AgentSoulDifyToolConfig
    rewrites them in-place so reading historical Agent Soul snapshots from the
    DB still works."""
    config = AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {
                    "provider_name": "langgenius/search/search",
                    "tool_name": "search",
                    "credential_type": "api-key",
                    "credential_id": "credential-1",
                    "tool_parameters": {"region": "us"},
                }
            ]
        }
    )

    tool = config.dify_tools[0]
    assert tool.provider_id == "langgenius/search/search"
    assert tool.runtime_parameters == {"region": "us"}
    assert tool.credential_ref is not None
    assert tool.credential_ref.id == "credential-1"


# ── provider-level entries (tool_name omitted = all tools of the provider) ───


def test_provider_level_entry_expands_to_all_tools():
    runtime_provider = FakeRuntimeProvider(_tool())
    listed: list[tuple[str, str]] = []

    def lister(*, tenant_id: str, provider_id: str) -> list[str]:
        listed.append((tenant_id, provider_id))
        return ["search", "image_search"]

    builder = WorkflowAgentPluginToolsBuilder(tool_runtime_provider=runtime_provider, provider_tools_lister=lister)
    tools = AgentSoulToolsConfig.model_validate(
        {"dify_tools": [{"provider_id": "langgenius/search/search", "credential_type": "unauthorized"}]}
    )

    result = _build(builder, tools)

    assert result is not None
    assert [tool.tool_name for tool in result.tools] == ["search", "image_search"]
    assert listed == [("tenant-1", "langgenius/search/search")]


def test_explicit_tool_entry_wins_over_provider_expansion():
    builder = WorkflowAgentPluginToolsBuilder(
        tool_runtime_provider=FakeRuntimeProvider(_tool()),
        provider_tools_lister=lambda *, tenant_id, provider_id: ["search", "image_search"],
    )
    tools = AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {"provider_id": "langgenius/search/search", "credential_type": "unauthorized"},
                {
                    "provider_id": "langgenius/search/search",
                    "tool_name": "search",
                    "credential_type": "unauthorized",
                    "runtime_parameters": {"region": "eu"},
                },
            ]
        }
    )

    result = _build(builder, tools)

    # the expansion skips "search" (explicit entry wins); no duplicate error
    assert result is not None
    assert sorted(tool.tool_name for tool in result.tools) == ["image_search", "search"]


def test_provider_level_entry_with_no_tools_maps_to_declaration_not_found():
    builder = WorkflowAgentPluginToolsBuilder(
        tool_runtime_provider=FakeRuntimeProvider(_tool()),
        provider_tools_lister=lambda *, tenant_id, provider_id: [],
    )
    tools = AgentSoulToolsConfig.model_validate(
        {"dify_tools": [{"provider_id": "langgenius/search/search", "credential_type": "unauthorized"}]}
    )

    with pytest.raises(WorkflowAgentPluginToolsBuildError) as exc_info:
        _build(builder, tools)
    assert exc_info.value.error_code == "agent_tool_declaration_not_found"


def test_provider_level_entry_unknown_provider_maps_to_declaration_not_found():
    from core.tools.errors import ToolProviderNotFoundError

    def lister(*, tenant_id: str, provider_id: str) -> list[str]:
        raise ToolProviderNotFoundError("provider gone")

    builder = WorkflowAgentPluginToolsBuilder(
        tool_runtime_provider=FakeRuntimeProvider(_tool()), provider_tools_lister=lister
    )
    tools = AgentSoulToolsConfig.model_validate(
        {"dify_tools": [{"provider_id": "langgenius/search/search", "credential_type": "unauthorized"}]}
    )

    with pytest.raises(WorkflowAgentPluginToolsBuildError) as exc_info:
        _build(builder, tools)
    assert exc_info.value.error_code == "agent_tool_declaration_not_found"


def test_list_provider_tool_names_reads_builtin_provider(monkeypatch):
    """The default provider-tools lister maps ToolManager's provider controller
    to the plain name list the expansion step consumes."""
    from types import SimpleNamespace

    from core.workflow.nodes.agent_v2 import plugin_tools_builder as module

    provider = SimpleNamespace(
        get_tools=lambda: [
            SimpleNamespace(entity=SimpleNamespace(identity=SimpleNamespace(name="ddg_search"))),
            SimpleNamespace(entity=SimpleNamespace(identity=SimpleNamespace(name="ddg_news"))),
        ]
    )
    captured: dict[str, str] = {}

    def fake_get_builtin_provider(provider_id, tenant_id):
        captured["provider_id"] = provider_id
        captured["tenant_id"] = tenant_id
        return provider

    monkeypatch.setattr(module.ToolManager, "get_builtin_provider", staticmethod(fake_get_builtin_provider))

    names = module._list_provider_tool_names(tenant_id="tenant-1", provider_id="langgenius/duckduckgo/duckduckgo")

    assert names == ["ddg_search", "ddg_news"]
    assert captured == {"provider_id": "langgenius/duckduckgo/duckduckgo", "tenant_id": "tenant-1"}
