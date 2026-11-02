import json
from dataclasses import dataclass

import pytest

from services.model_billing_dependency_adapters import StrategyModelSelectors, TypedModelDependencyExtractor
from services.model_billing_dependency_inventory import (
    AgentModelSelectors,
    ClassicModelSelectors,
    DatasetModelSelectors,
    ExtractedModelDependencies,
    ModelDependencyDocument,
    WorkflowModelSelectors,
)

PROVIDER = "langgenius/openai/openai"
LLM = {"provider": PROVIDER, "name": "gpt-4o-mini", "mode": "chat", "completion_params": {"temperature": 0.0}}


@dataclass
class Strategies:
    result: StrategyModelSelectors = StrategyModelSelectors(("selected_model",), True)

    def model_selectors(self, tenant_id: str, provider: str, strategy: str) -> StrategyModelSelectors:
        del tenant_id, provider, strategy
        return self.result

    def tool_model_selectors(self, tenant_id: str, provider: str, tool: str | None) -> StrategyModelSelectors:
        del tenant_id, provider, tool
        return self.result


def extract(payload: object, *, strategies: Strategies | None = None) -> ExtractedModelDependencies:
    document = ModelDependencyDocument("tenant", "workflow", "app", "dormant-version", payload)
    return TypedModelDependencyExtractor(strategies=strategies or Strategies()).extract("tenant", (document,))


def classic(**changes: object) -> ClassicModelSelectors:
    fields: dict[str, object] = {
        "model": json.dumps(LLM),
        "dataset": None,
        "agent": None,
        "suggested_questions": None,
        "speech_to_text": None,
        "text_to_speech": None,
    }
    fields.update(changes)
    return ClassicModelSelectors(**fields)  # type: ignore[arg-type]


def test_classic_and_resumable_override_keep_exact_original_provider_no_user_data_mutation() -> None:
    config = {**LLM, "completion_params": {"stop": ["done"], "temperature": 0.0}}
    payload = classic(override=json.dumps({"model": config}))
    result = extract(payload)
    assert [(item.provider, item.model) for item in result.references] == [(PROVIDER, "gpt-4o-mini")]
    assert json.loads(payload.override or "{}")["model"]["completion_params"]["stop"] == ["done"]
    assert not result.problems


def test_audio_and_suggested_questions_capture_actual_workspace_default_calls() -> None:
    payload = classic(
        speech_to_text='{"enabled":true}',
        text_to_speech='{"enabled":true}',
        suggested_questions=json.dumps({"enabled": True, "model": LLM}),
    )
    result = extract(payload)
    defaults = {(item.path, item.model_type) for item in result.references if item.kind == "tenant_default"}
    assert {kind for _, kind in defaults} == {"llm", "tts", "speech2text"}
    assert len([item for item in result.references if item.kind == "fixed"]) == 2


def test_disabled_secondary_selector_residue_is_not_a_dependency() -> None:
    config = {
        "datasets": {"datasets": [{"dataset": {"id": "kb", "enabled": True}}]},
        "retrieval_model": "multiple",
        "reranking_enabled": False,
        "reranking_model": {"provider": "old", "model": "residual"},
    }
    result = extract(classic(dataset=json.dumps(config), text_to_speech='{"enabled":false}'))
    assert [item.model for item in result.references] == ["gpt-4o-mini"]


def test_retrieval_rerank_weighted_embedding_and_automatic_metadata_are_owned_secondary_selectors() -> None:
    graph = {
        "nodes": [
            {
                "id": "r",
                "data": {
                    "type": "knowledge-retrieval",
                    "retrieval_mode": "multiple",
                    "multiple_retrieval_config": {"reranking_model": {"provider": "tongyi", "model": "qwen3-rerank"}},
                    "metadata_filtering_mode": "automatic",
                    "metadata_model_config": LLM,
                },
            }
        ]
    }
    result = extract(WorkflowModelSelectors(json.dumps(graph), None))
    assert {(item.model_type, item.model) for item in result.references} == {
        ("llm", "gpt-4o-mini"),
        ("rerank", "qwen3-rerank"),
    }
    weighted = {
        "reranking_mode": "weighted_score",
        "weights": {
            "vector_setting": {
                "vector_weight": 0.5,
                "embedding_provider_name": "openai",
                "embedding_model_name": "text-embedding-3-small",
            },
            "keyword_setting": {"keyword_weight": 0.5},
        },
    }
    result = extract(DatasetModelSelectors("high_quality", PROVIDER, "text-embedding-3-large", weighted))
    assert {item.model for item in result.references} == {"text-embedding-3-small", "text-embedding-3-large"}


@pytest.mark.parametrize("kind", ["llm", "question-classifier", "parameter-extractor"])
def test_owned_workflow_llm_schemas_include_dormant_nodes(kind: str) -> None:
    result = extract(
        WorkflowModelSelectors(json.dumps({"nodes": [{"id": "dormant", "data": {"type": kind, "model": LLM}}]}), None)
    )
    assert result.references[0].path == "nodes.dormant.model"
    assert not result.problems


def test_arbitrary_json_dictionary_named_model_is_not_treated_as_a_runtime_selector() -> None:
    graph = {"nodes": [{"id": "code", "data": {"type": "code", "model": LLM}}], "model": LLM}
    result = extract(WorkflowModelSelectors(json.dumps(graph), None))
    assert result.references == result.problems == ()


@pytest.mark.parametrize("mode", ["variable", "mixed"])
def test_dynamic_strategy_model_selector_is_explicit_unresolved_not_guessed_default(mode: str) -> None:
    graph = {
        "nodes": [
            {
                "id": "a",
                "data": {
                    "type": "agent",
                    "title": "Agent",
                    "agent_strategy_provider_name": "langgenius/agent/agent",
                    "agent_strategy_name": "react",
                    "agent_parameters": {"selected_model": {"type": mode, "value": ["node", "output"]}},
                },
            }
        ]
    }
    result = extract(WorkflowModelSelectors(json.dumps(graph), None))
    assert len(result.references) == 1
    assert result.references[0].kind == "dynamic"
    assert result.references[0].provider is None


def test_constant_strategy_selector_uses_declared_parameter_not_arbitrary_model_field() -> None:
    graph = {
        "nodes": [
            {
                "id": "a",
                "data": {
                    "type": "agent",
                    "title": "Agent",
                    "agent_strategy_provider_name": "langgenius/agent/agent",
                    "agent_strategy_name": "react",
                    "agent_parameters": {
                        "selected_model": {
                            "type": "constant",
                            "value": {"provider": PROVIDER, "model": "gpt-4o-mini", "model_type": "llm"},
                        },
                        "model": {"type": "constant", "value": {"provider": "fake", "model": "not-a-selector"}},
                    },
                },
            }
        ]
    }
    result = extract(WorkflowModelSelectors(json.dumps(graph), None))
    assert [item.model for item in result.references] == ["gpt-4o-mini"]


def test_opaque_strategy_with_model_permission_is_not_an_empty_inventory() -> None:
    graph = {
        "nodes": [
            {
                "id": "a",
                "data": {
                    "type": "agent",
                    "title": "Agent",
                    "agent_strategy_provider_name": "langgenius/agent/agent",
                    "agent_strategy_name": "opaque",
                },
            }
        ]
    }
    result = extract(
        WorkflowModelSelectors(json.dumps(graph), None), strategies=Strategies(StrategyModelSelectors((), True))
    )
    assert result.references[0].kind == "dynamic"


def test_agent_soul_credential_reference_does_not_falsely_claim_byok() -> None:
    soul = {
        "model": {
            "plugin_id": "langgenius/openai",
            "model_provider": PROVIDER,
            "model": "gpt-4o-mini",
            "credential_ref": {"type": "custom", "id": "not-consumed-by-runtime"},
        }
    }
    result = extract(AgentModelSelectors(soul))
    assert result.references[0].credential_id is None
    assert result.references[0].model == "gpt-4o-mini"


def test_dataset_summary_qa_generation_and_annotation_include_nonprimary_models() -> None:
    payload = DatasetModelSelectors(
        "high_quality",
        PROVIDER,
        "text-embedding-3-small",
        {},
        summary={"enable": True, "model_provider_name": PROVIDER, "model_name": "gpt-4o"},
        has_qa_documents=True,
    )
    result = extract(payload)
    assert {(item.kind, item.model_type, item.model) for item in result.references} == {
        ("fixed", "text-embedding", "text-embedding-3-small"),
        ("fixed", "llm", "gpt-4o"),
        ("tenant_default", "llm", None),
    }
    result = extract(
        classic(
            model=None,
            annotation_binding_id="binding",
            annotation_provider=PROVIDER,
            annotation_model="text-embedding-3-small",
        )
    )
    assert result.references[0].path == "annotation.embedding"


def test_external_dataset_does_not_claim_internal_embedding_or_reranking_usage() -> None:
    result = extract(
        DatasetModelSelectors(
            "high_quality",
            PROVIDER,
            "residual",
            {"reranking_model": {"provider": PROVIDER, "model": "old"}},
            external=True,
        )
    )
    assert result.references == result.problems == ()


def test_corrupt_or_incomplete_saved_selector_stays_a_problem_not_empty_success() -> None:
    assert extract(classic(model='{"provider":"openai"}')).problems
    assert extract(classic(model="not-json")).problems


@pytest.mark.parametrize("wrapped", [False, True])
def test_plugin_tool_declared_model_selector_preserves_constant_configuration(wrapped: bool) -> None:
    selector: dict[str, object] = {"provider": PROVIDER, "model": "gpt-4o-mini", "model_type": "llm"}
    value = {"type": "constant", "value": selector} if wrapped else selector
    data = {
        "type": "tool",
        "title": "Tool",
        "provider_id": "langgenius/example/example",
        "provider_type": "plugin",
        "provider_name": "example",
        "tool_name": "invoke",
        "tool_label": "Invoke",
        "tool_configurations": {"selected_model": value},
        "tool_parameters": dict[str, object](),
    }
    result = extract(WorkflowModelSelectors(json.dumps({"nodes": [{"id": "tool", "data": data}]}), None))
    assert [(item.model, item.kind) for item in result.references] == [("gpt-4o-mini", "fixed")]
    assert result.problems == ()


def test_plugin_tool_variable_or_opaque_callback_remains_dynamic_but_proven_nonmodel_tool_does_not() -> None:
    data = {
        "type": "tool",
        "title": "Tool",
        "provider_id": "langgenius/example/example",
        "provider_type": "plugin",
        "provider_name": "example",
        "tool_name": "invoke",
        "tool_label": "Invoke",
        "tool_configurations": dict[str, object](),
        "tool_parameters": {"selected_model": {"type": "variable", "value": ["node", "model"]}},
    }
    payload = WorkflowModelSelectors(json.dumps({"nodes": [{"id": "tool", "data": data}]}), None)
    assert extract(payload).references[0].kind == "dynamic"
    assert extract(payload, strategies=Strategies(StrategyModelSelectors((), True))).references[0].kind == "dynamic"
    assert extract(payload, strategies=Strategies(StrategyModelSelectors((), False))).references == ()


def test_enabled_classic_agent_plugin_tool_model_selector_is_included() -> None:
    tools = {
        "enabled": True,
        "tools": [
            {
                "enabled": True,
                "provider_type": "plugin",
                "provider_id": "langgenius/example/example",
                "tool_name": "invoke",
                "tool_parameters": {
                    "selected_model": {"provider": PROVIDER, "model": "secondary", "model_type": "llm"}
                },
            }
        ],
    }
    result = extract(classic(agent=json.dumps(tools)))
    assert {item.model for item in result.references} == {"gpt-4o-mini", "secondary"}


def test_api_tool_dictionary_named_model_does_not_claim_plugin_model_callback() -> None:
    tools = {
        "enabled": True,
        "tools": [
            {
                "enabled": True,
                "provider_type": "api",
                "provider_id": "api-provider",
                "tool_name": "http",
                "tool_parameters": {"selected_model": {"provider": PROVIDER, "model": "external", "model_type": "llm"}},
            }
        ],
    }
    assert [item.model for item in extract(classic(agent=json.dumps(tools))).references] == ["gpt-4o-mini"]
