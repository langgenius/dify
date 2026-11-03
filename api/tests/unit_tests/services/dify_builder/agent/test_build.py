"""Generated node configurations must survive Builder grounding and native defaults."""

import json
import threading
from collections.abc import Sequence

import pytest

from core.app.app_config.entities import ModelConfig
from core.workflow.generator.types import WorkflowGenerateResultDict
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage
from graphon.nodes.llm.entities import LLMNodeData
from services.dify_builder import graph_ops
from services.dify_builder.agent import build
from services.workflow_generation.runner import WorkflowGenerator

_PROVIDER = "langgenius/tokener/tokener"
_BUILDER_MODEL = "gpt-5.6-luna"
_WORKFLOW_MODEL = "gpt-4.1"
_TRANSLATION_PROMPT = "Translate {{#sys.query#}} into English without changing its meaning or format."


class TranslationModel:
    """Supply deterministic provider responses to the real generation pipeline."""

    def __init__(self, wrapped_node: str, *, correct_on_retry: bool) -> None:
        self.wrapped_node = wrapped_node
        self.correct_on_retry = correct_on_retry
        self.calls: dict[str, list[list[str]]] = {}
        self.lock = threading.Lock()
        self.configs: dict[str, dict[str, object]] = {
            "start": {"variables": []},
            "translate": {
                "model": {
                    "provider": _PROVIDER,
                    "name": _BUILDER_MODEL,
                    "mode": "chat",
                    "completion_params": {"temperature": 0.3},
                },
                "prompt_template": [{"role": "user", "text": _TRANSLATION_PROMPT}],
                "context": {"enabled": False, "variable_selector": []},
                "vision": {"enabled": False},
            },
            "answer": {"answer": "{{#translate.text#}}"},
        }

    def invoke_llm(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: dict[str, object],
        stream: bool,
    ) -> LLMResult:
        assert not stream
        del model_parameters
        messages = [message.get_text_content() or "" for message in prompt_messages]
        if "workflow planner" in messages[0].lower():
            payload = {
                "nodes": [
                    {"id": "start", "node_type": "start", "label": "Start"},
                    {"id": "translate", "node_type": "llm", "label": "Translate"},
                    {"id": "answer", "node_type": "answer", "label": "Answer"},
                ],
                "edges": [
                    {"source": "start", "target": "translate"},
                    {"source": "translate", "target": "answer"},
                ],
            }
        else:
            node_id = next(node_id for node_id in self.configs if f"id={node_id}, type=" in messages[1])
            with self.lock:
                calls = self.calls.setdefault(node_id, [])
                calls.append(messages)
                needs_wrapper = node_id == self.wrapped_node and (len(calls) == 1 or not self.correct_on_retry)
            config = self.configs[node_id]
            payload = {"config": {"data": config} if needs_wrapper else config}
        return LLMResult(
            model=_BUILDER_MODEL,
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(content=json.dumps(payload)),
            usage=LLMUsage.empty_usage(),
        )


def generate_translation(model: TranslationModel) -> WorkflowGenerateResultDict:
    return WorkflowGenerator.generate_workflow_graph(
        model_instance=model,
        model_parameters={},
        provider=_PROVIDER,
        model_name=_BUILDER_MODEL,
        model_mode="chat",
        mode="advanced-chat",
        instruction="Translate the user's message into English.",
    )


@pytest.mark.parametrize("wrapped_node", ["start", "translate", "answer"])
def test_corrected_node_configuration_keeps_selected_model_and_prompt(wrapped_node: str) -> None:
    model = TranslationModel(wrapped_node, correct_on_retry=True)

    generated = generate_translation(model)

    assert generated["errors"] == []
    assert len(model.calls[wrapped_node]) == 2
    correction = json.loads(model.calls[wrapped_node][1][-1])
    assert correction["code"] == "INVALID_SCHEMA"
    assert "config.data" in correction["detail"]
    assert _TRANSLATION_PROMPT not in correction["detail"]
    selected_model = ModelConfig.model_validate(
        {"provider": _PROVIDER, "name": _WORKFLOW_MODEL, "mode": "chat", "completion_params": {}}
    )

    candidate = build._prepare_build_candidate(dict(generated["graph"]), selected_model, "", mode="advanced-chat")
    assert candidate.rejections == []
    draft = graph_ops.filter_applicable({"nodes": [], "edges": []}, candidate.applicable)
    assert draft.rejected == []
    nodes = {node["id"]: node["data"] for node in draft.graph["nodes"]}
    assert all("data" not in data for data in nodes.values())
    assert nodes["start"]["variables"] == []
    assert nodes["answer"]["answer"] == "{{#translate.text#}}"
    llm = LLMNodeData.model_validate(nodes["translate"])
    assert (llm.model.provider, llm.model.name) == (_PROVIDER, _WORKFLOW_MODEL)
    assert llm.model.completion_params == {"temperature": 0.3}
    assert nodes["translate"]["prompt_template"] == [{"role": "user", "text": _TRANSLATION_PROMPT}]


@pytest.mark.parametrize("wrapped_node", ["start", "translate", "answer"])
def test_repeated_nested_configuration_does_not_produce_an_applicable_graph(wrapped_node: str) -> None:
    model = TranslationModel(wrapped_node, correct_on_retry=False)

    generated = generate_translation(model)

    assert generated["graph"]["nodes"] == []
    assert generated["graph"]["edges"] == []
    assert [error["code"] for error in generated["errors"]] == ["INVALID_SCHEMA"]
    assert "config.data" in generated["error"]
    assert len(model.calls[wrapped_node]) == 2
