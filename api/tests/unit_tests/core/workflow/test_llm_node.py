from collections.abc import Generator
from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock, sentinel

import pytest

from core.workflow.llm_node import DifyLLMNode
from graphon.nodes.llm.node import LLMNode
from graphon.nodes.llm.runtime_protocols import LLMPollingCapableProtocol


def test_dify_llm_node_finalizes_polling_when_generator_is_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    def invoke(*args: object, **kwargs: object) -> Generator[object]:
        _ = args
        assert kwargs["file_outputs"] == []
        yield sentinel.event
        yield sentinel.unconsumed

    monkeypatch.setattr(LLMNode, "_invoke_llm_with_polling", invoke)
    finalizer = Mock()
    node = object.__new__(DifyLLMNode)
    node._polling_finalizer = finalizer

    events = node._invoke_llm_with_polling(
        file_outputs=[],
        polling_model=cast(LLMPollingCapableProtocol, SimpleNamespace()),
        prompt_messages=[],
        stop=None,
    )

    assert next(events) is sentinel.event
    events.close()

    finalizer.assert_called_once_with()


def test_dify_llm_node_finalizes_polling_when_polling_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    def invoke(*args: object, **kwargs: object) -> Generator[object]:
        _ = args, kwargs
        yield sentinel.event
        raise RuntimeError("polling failed")

    monkeypatch.setattr(LLMNode, "_invoke_llm_with_polling", invoke)
    finalizer = Mock()
    node = object.__new__(DifyLLMNode)
    node._polling_finalizer = finalizer
    events = node._invoke_llm_with_polling(
        file_outputs=[],
        polling_model=cast(LLMPollingCapableProtocol, SimpleNamespace()),
        prompt_messages=[],
        stop=None,
    )

    assert next(events) is sentinel.event
    with pytest.raises(RuntimeError, match="polling failed"):
        next(events)

    finalizer.assert_called_once_with()


@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize("prompt_mode", ["chat", "completion", "jinja2"])
def test_openui_option_survives_graphon_validation_and_injects_only_enabled_node(
    enabled: bool,
    prompt_mode: str,
) -> None:
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom
    from core.workflow.node_runtime import DifyPreparedLLM, DifyPromptMessageSerializer, build_dify_llm_file_saver
    from graphon.entities.base_node_data import BaseNodeData
    from graphon.http.client import HttpxHttpClient
    from graphon.nodes.llm.entities import LLMNodeCompletionModelPromptTemplate, LLMNodeData
    from graphon.runtime import RuntimeState, VariablePool
    from graphon.runtime.init_params import InitParams
    from libs.generative_ui_prompt import load_generative_ui_prompt
    from tests.helpers.unit.core.model_fixtures import make_model_instance

    raw = {
        "type": "llm",
        "title": "Answer",
        "generative_ui_enabled": enabled,
        "model": {"provider": "openai", "name": "gpt-4", "mode": "chat" if prompt_mode == "chat" else "completion"},
        "context": {"enabled": False},
        "prompt_template": (
            [{"role": "user", "text": "Original prompt"}]
            if prompt_mode == "chat"
            else {
                "text": "Original prompt",
                "edition_type": "jinja2" if prompt_mode == "jinja2" else "basic",
                "jinja2_text": "Original prompt" if prompt_mode == "jinja2" else None,
            }
        ),
    }
    data = LLMNodeData.model_validate(BaseNodeData.model_validate(raw).model_dump())
    model = DifyPreparedLLM(make_model_instance(provider="openai", model="gpt-4"))
    run_context = DifyRunContext(
        tenant_id="tenant",
        app_id="app",
        user_id="user",
        user_from="account",
        invoke_from=InvokeFrom.DEBUGGER,
    )
    node = DifyLLMNode(
        node_id="answer",
        data=data,
        init_params=InitParams(workflow_id="workflow", graph_config={}, run_context={}, call_depth=0),
        runtime_state=RuntimeState(variable_pool=VariablePool(), start_at=0, workflow_id="workflow"),
        model_instance=model,
        llm_file_saver=build_dify_llm_file_saver(run_context=run_context, http_client=HttpxHttpClient()),
        prompt_message_serializer=DifyPromptMessageSerializer(),
        polling_finalizer=model.finalize_llm_polling,
    )
    prompt = node.node_data.prompt_template
    if isinstance(prompt, LLMNodeCompletionModelPromptTemplate):
        text = prompt.jinja2_text if prompt_mode == "jinja2" else prompt.text
        assert text is not None
    else:
        text = "\n".join(message.text for message in prompt)
    assert "Original prompt" in text
    assert (load_generative_ui_prompt() in text) is enabled
    assert (node.node_data.model_extra or {})["generative_ui_enabled"] is enabled
    assert node.node_data.reasoning_format == ("separated" if enabled else "tagged")
