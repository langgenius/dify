from collections.abc import Generator
from unittest.mock import sentinel

import pytest

from core.helper.ssrf_proxy import graphon_ssrf_proxy
from core.workflow.llm_node import DifyLLMNode
from core.workflow.node_runtime import DifyPreparedPollingLLM, DifyPromptMessageSerializer, build_dify_llm_file_saver
from graphon.nodes.llm.entities import LLMNodeData
from graphon.nodes.llm.node import LLMNode
from graphon.runtime import RuntimeState
from tests.helpers.unit.core.model_fixtures import make_model_instance
from tests.workflow_test_utils import build_test_graph_init_params, build_test_run_context, build_test_variable_pool


@pytest.fixture
def polling_model() -> DifyPreparedPollingLLM:
    return DifyPreparedPollingLLM(make_model_instance(provider="test-provider", model="test-model"))


@pytest.fixture
def node(polling_model: DifyPreparedPollingLLM) -> DifyLLMNode:
    return DifyLLMNode(
        node_id="llm",
        data=LLMNodeData.model_validate(
            {
                "type": "llm",
                "title": "LLM",
                "model": {"provider": "test-provider", "name": "test-model", "mode": "chat", "completion_params": {}},
                "prompt_template": [],
                "context": {"enabled": False},
            }
        ),
        init_params=build_test_graph_init_params(),
        runtime_state=RuntimeState(workflow_id="workflow", variable_pool=build_test_variable_pool(), start_at=0.0),
        model_instance=polling_model,
        llm_file_saver=build_dify_llm_file_saver(run_context=build_test_run_context(), http_client=graphon_ssrf_proxy),
        prompt_message_serializer=DifyPromptMessageSerializer(),
        polling_finalizer=polling_model.finalize_llm_polling,
    )


def test_dify_llm_node_finalizes_polling_when_generator_is_closed(
    monkeypatch: pytest.MonkeyPatch, node: DifyLLMNode, polling_model: DifyPreparedPollingLLM
) -> None:
    def invoke(*args: object, **kwargs: object) -> Generator[object]:
        _ = args
        assert kwargs["file_outputs"] == []
        yield sentinel.event
        yield sentinel.unconsumed

    monkeypatch.setattr(LLMNode, "_invoke_llm_with_polling", invoke)
    finalized: list[None] = []
    node._polling_finalizer = lambda: finalized.append(None)

    events = node._invoke_llm_with_polling(
        file_outputs=[],
        polling_model=polling_model,
        prompt_messages=[],
        stop=None,
    )

    assert next(events) is sentinel.event
    events.close()

    assert finalized == [None]


def test_dify_llm_node_finalizes_polling_when_polling_fails(
    monkeypatch: pytest.MonkeyPatch, node: DifyLLMNode, polling_model: DifyPreparedPollingLLM
) -> None:
    def invoke(*args: object, **kwargs: object) -> Generator[object]:
        _ = args, kwargs
        yield sentinel.event
        raise RuntimeError("polling failed")

    monkeypatch.setattr(LLMNode, "_invoke_llm_with_polling", invoke)
    finalized: list[None] = []
    node._polling_finalizer = lambda: finalized.append(None)
    events = node._invoke_llm_with_polling(
        file_outputs=[],
        polling_model=polling_model,
        prompt_messages=[],
        stop=None,
    )

    assert next(events) is sentinel.event
    with pytest.raises(RuntimeError, match="polling failed"):
        next(events)

    assert finalized == [None]


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
