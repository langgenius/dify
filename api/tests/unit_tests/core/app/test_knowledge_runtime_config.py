import pytest
from dify_agent.protocol.knowledge_fs import KnowledgeFsError

from core.app import knowledge_runtime_config as mapping
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from graphon.model_runtime.entities.model_entities import ModelFeature
from models.agent_config_entities import AgentSoulConfig
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.knowledge_fs_core_fakes import RecordingModelFactory, llm_schema


def soul() -> AgentSoulConfig:
    return AgentSoulConfig.model_validate(
        {
            "model": {"plugin_id": "author/plugin", "model_provider": "provider", "model": "model"},
            "knowledge": {
                "spaces": [{"id": "docs", "control_space_id": "00000000-0000-4000-8000-000000000001", "name": "Docs"}]
            },
        }
    )


def run_context() -> DifyRunContext:
    return DifyRunContext(
        tenant_id="tenant-1",
        app_id="app-1",
        user_id="user-1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )


@pytest.mark.parametrize("vision", [True, False])
def test_knowledge_vision_is_owned_by_agent_model_without_provider_env(
    monkeypatch: pytest.MonkeyPatch, vision: bool
) -> None:
    apply_config_overrides(monkeypatch, AGENT_SHELL_ENABLED=True)
    factory = RecordingModelFactory(schema=llm_schema(features=[ModelFeature.VISION] if vision else []))
    monkeypatch.setattr(mapping, "DifyModelFactory", factory)
    context = run_context()
    config = mapping.build_knowledge_fs_layer_config(soul(), run_context=context)
    assert config is not None
    assert config.agent_supports_vision is vision
    assert config.spaces[0].name == "Docs"
    assert len(factory.run_contexts) == 1
    assert factory.run_contexts[0] is context
    assert factory.model_lookups == [("provider", "model")]
    assert "provider" not in config.model_dump_json()


def test_no_knowledge_has_no_model_or_shell_dependency_and_import_requires_rebind(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apply_config_overrides(monkeypatch, AGENT_SHELL_ENABLED=False)
    assert mapping.build_knowledge_fs_layer_config(AgentSoulConfig(), run_context=run_context()) is None
    with pytest.raises(KnowledgeFsError, match="sandbox shell"):
        mapping.build_knowledge_fs_layer_config(soul(), run_context=run_context())
    imported = soul()
    imported.knowledge.spaces[0].is_missing = True
    with pytest.raises(KnowledgeFsError, match="Reselect"):
        mapping.build_knowledge_fs_layer_config(imported, run_context=run_context())
