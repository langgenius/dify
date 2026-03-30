from types import SimpleNamespace
from unittest.mock import Mock, patch

from graphon.model_runtime.entities.model_entities import ModelType

from core.workflow.nodes.agent.runtime_support import AgentRuntimeSupport


def test_fetch_model_reuses_single_model_assembly():
    provider_configuration = SimpleNamespace(
        get_current_credentials=Mock(return_value={"api_key": "x"}),
        provider=SimpleNamespace(provider="openai"),
    )
    model_type_instance = SimpleNamespace(get_model_schema=Mock(return_value="schema"))
    provider_model_bundle = SimpleNamespace(
        configuration=provider_configuration,
        model_type_instance=model_type_instance,
    )
    model_instance = Mock()
    assembly = SimpleNamespace(
        provider_manager=Mock(),
        model_manager=Mock(),
    )
    assembly.provider_manager.get_provider_model_bundle.return_value = provider_model_bundle
    assembly.model_manager.get_model_instance.return_value = model_instance

    with patch(
        "core.workflow.nodes.agent.runtime_support.create_plugin_model_assembly",
        return_value=assembly,
    ) as mock_assembly:
        resolved_instance, resolved_schema = AgentRuntimeSupport().fetch_model(
            tenant_id="tenant-1",
            user_id="user-1",
            value={"provider": "openai", "model": "gpt-4o-mini", "model_type": "llm"},
        )

    assert resolved_instance is model_instance
    assert resolved_schema == "schema"
    mock_assembly.assert_called_once_with(tenant_id="tenant-1", user_id="user-1")
    assembly.provider_manager.get_provider_model_bundle.assert_called_once_with(
        tenant_id="tenant-1",
        provider="openai",
        model_type=ModelType.LLM,
    )
    assembly.model_manager.get_model_instance.assert_called_once_with(
        tenant_id="tenant-1",
        provider="openai",
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
    )
