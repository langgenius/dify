import pytest
from dify_agent.layers.dify_plugin import DifyPluginToolConfig, DifyPluginToolsLayerConfig
from pydantic import ValidationError

from core.app.entities.app_invoke_entities import DifyRunContext
from core.workflow.nodes.agent_v2.dify_tools_builder import WorkflowAgentToolLayers
from core.workflow.nodes.agent_v2.memory_builder import build_memory_layer_config, model_tools_config
from models.agent_config_entities import AgentExternalMemoryConfig, AgentSoulConfig


def reference(name):
    return {
        "provider_type": "plugin",
        "plugin_id": "example/memory",
        "provider": "memory",
        "tool_name": name,
        "credential_type": "api-key",
        "credential_ref": {"type": "provider", "id": "credential-1"},
    }


def soul():
    return AgentSoulConfig.model_validate(
        {
            "memory": {"external": {"prepare": reference("recall"), "observe": reference("record")}},
            "tools": {"dify_tools": [reference("recall"), reference("record"), reference("search")]},
        }
    )


def test_memory_callbacks_are_resolved_with_trusted_tenant_context_and_hidden_from_model():
    class Builder:
        def build_layers(self, *, tenant_id, app_id, user_id, tools, invoke_from):
            assert (tenant_id, app_id, user_id) == ("tenant-1", "app-1", "user-1")
            assert invoke_from.value == "debugger"
            return WorkflowAgentToolLayers(
                plugin_tools=DifyPluginToolsLayerConfig(
                    tools=[
                        DifyPluginToolConfig(
                            plugin_id=tool.plugin_id,
                            provider=tool.provider,
                            tool_name=tool.tool_name,
                            credential_type=tool.credential_type,
                            credentials={"token": "resolved-secret"},
                        )
                        for tool in tools.dify_tools
                    ]
                )
            )

    config = soul()
    context = DifyRunContext(
        tenant_id="tenant-1", app_id="app-1", user_id="user-1", user_from="account", invoke_from="debugger"
    )
    memory = build_memory_layer_config(config, context, Builder())
    assert memory is not None
    assert memory.prepare.tool_name == "recall"
    assert memory.observe.credentials == {"token": "resolved-secret"}
    assert "resolved-secret" not in config.model_dump_json()
    assert [tool.tool_name for tool in model_tools_config(config).dify_tools] == ["search"]
    assert len(config.tools.dify_tools) == 3


def test_unavailable_memory_provider_does_not_prevent_a_run(caplog):
    class Unavailable:
        def build_layers(self, **_kwargs):
            raise RuntimeError("sensitive internal error")

    context = DifyRunContext(
        tenant_id="tenant-1", app_id="app-1", user_id="user-1", user_from="account", invoke_from="debugger"
    )
    assert build_memory_layer_config(soul(), context, Unavailable()) is None
    assert "provider_configuration_unavailable" in caplog.text
    assert "sensitive internal error" not in caplog.text


@pytest.mark.parametrize(
    "changes",
    [{"subject_kind": "business"}, {"max_bytes": 50000}, {"prepare": {**reference("recall"), "tool_name": None}}],
)
def test_invalid_memory_configuration_is_rejected(changes):
    with pytest.raises(ValidationError):
        AgentExternalMemoryConfig.model_validate(
            {"prepare": reference("recall"), "observe": reference("record"), **changes}
        )
