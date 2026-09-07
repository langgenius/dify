from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from dify_agent.protocol.knowledge_fs import KnowledgeFsError

from graphon.model_runtime.entities.model_entities import ModelFeature
from models.agent_config_entities import AgentSoulConfig
from services.agent import knowledge_runtime_config as mapping
from tests.unit_tests.config_override import apply_config_overrides


def soul():
    return AgentSoulConfig.model_validate(
        {
            "model": {"plugin_id": "author/plugin", "model_provider": "provider", "model": "model"},
            "knowledge": {
                "spaces": [{"id": "docs", "control_space_id": "00000000-0000-4000-8000-000000000001", "name": "Docs"}]
            },
        }
    )


@pytest.mark.parametrize("vision", [True, False])
def test_knowledge_vision_is_owned_by_agent_model_without_provider_env(monkeypatch, vision):
    apply_config_overrides(monkeypatch, AGENT_SHELL_ENABLED=True)
    factory = Mock()
    factory.return_value.init_model_instance.return_value.get_model_schema.return_value = SimpleNamespace(
        features=[ModelFeature.VISION] if vision else []
    )
    monkeypatch.setattr(mapping, "DifyModelFactory", factory)
    context = object()
    config = mapping.build_knowledge_fs_layer_config(soul(), run_context=context)
    assert config.agent_supports_vision is vision
    assert config.spaces[0].name == "Docs"
    factory.assert_called_once_with(run_context=context)
    factory.return_value.init_model_instance.assert_called_once_with("provider", "model")
    assert "provider" not in config.model_dump_json()


def test_no_knowledge_has_no_model_or_shell_dependency_and_import_requires_rebind(monkeypatch):
    apply_config_overrides(monkeypatch, AGENT_SHELL_ENABLED=False)
    assert mapping.build_knowledge_fs_layer_config(AgentSoulConfig(), run_context=object()) is None
    with pytest.raises(KnowledgeFsError, match="sandbox shell"):
        mapping.build_knowledge_fs_layer_config(soul(), run_context=object())
    imported = soul()
    imported.knowledge.spaces[0].is_missing = True
    with pytest.raises(KnowledgeFsError, match="Reselect"):
        mapping.build_knowledge_fs_layer_config(imported, run_context=object())
