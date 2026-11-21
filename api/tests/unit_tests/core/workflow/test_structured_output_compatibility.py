"""Exercise provider capability compatibility through the real workflow LLM adapter."""

from __future__ import annotations

import json
import time
from collections.abc import Generator, Mapping, Sequence
from dataclasses import dataclass

import pytest

from core.helper.ssrf_proxy import graphon_ssrf_proxy
from core.model_manager import ModelInstance
from core.workflow.node_runtime import (
    DifyPreparedLLM,
    DifyPreparedPollingLLM,
    DifyPromptMessageSerializer,
    build_dify_llm_file_saver,
    resolve_dify_run_context,
)
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage, SystemPromptMessage
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelFeature, ParameterRule, ParameterType
from graphon.node_events import StreamCompletedEvent
from graphon.nodes.llm.entities import LLMNodeData
from graphon.nodes.llm.node import LLMNode
from graphon.runtime import RuntimeState, VariablePool
from tests.helpers.unit.core.model_fixtures import make_model_config, make_model_instance
from tests.workflow_test_utils import build_test_graph_init_params

_PROVIDER = "openai"
_MODEL = "gpt-4o-mini"
_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "profile": {
            "type": "object",
            "properties": {"active": {"type": "boolean"}},
            "required": ["active"],
        },
        "flags": {"type": "array", "items": {"type": "boolean"}},
    },
    "required": ["profile", "flags"],
}
_VALID_OUTPUT = {"profile": {"active": False}, "flags": [False, True]}
_FEATURE_CASES = [
    pytest.param(None, id="unknown"),
    pytest.param([], id="empty"),
    pytest.param([ModelFeature.TOOL_CALL], id="tool-call-only"),
    pytest.param([ModelFeature.STRUCTURED_OUTPUT], id="native-structured-output"),
]


@dataclass(frozen=True)
class _ProviderCall:
    prompt_messages: Sequence[PromptMessage]
    model_parameters: dict[str, object]


def _provider_model(
    monkeypatch: pytest.MonkeyPatch,
    *,
    features: list[ModelFeature] | None,
    response: Mapping[str, object],
    streamed: bool,
) -> tuple[ModelInstance, AIModelEntity, list[_ProviderCall]]:
    """Replace provider schema discovery and responses, retaining the Dify/parser path."""
    model_instance = make_model_instance(provider=_PROVIDER, model=_MODEL)
    schema = make_model_config(provider=_PROVIDER, model=_MODEL, mode="chat").model_schema.model_copy(
        update={
            "features": features,
            "parameter_rules": [
                ParameterRule(
                    name="response_format",
                    label=I18nObject(en_US="Response format"),
                    type=ParameterType.STRING,
                    options=["json_schema", "json_object"],
                )
            ],
        }
    )
    calls: list[_ProviderCall] = []
    text = json.dumps(response)

    def get_model_schema(*_args: object, **_kwargs: object) -> AIModelEntity:
        return schema

    def invoke_model(
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: dict[str, object],
        stream: bool,
        **_kwargs: object,
    ) -> LLMResult | Generator[LLMResultChunk]:
        calls.append(_ProviderCall(prompt_messages=prompt_messages, model_parameters=model_parameters))
        assert stream is True
        usage = LLMUsage.empty_usage()
        if not streamed:
            return LLMResult(
                model=_MODEL,
                prompt_messages=prompt_messages,
                message=AssistantPromptMessage(content=text),
                usage=usage,
            )
        return (
            LLMResultChunk(
                model=_MODEL,
                prompt_messages=prompt_messages,
                delta=LLMResultChunkDelta(
                    index=index,
                    message=AssistantPromptMessage(content=part),
                    usage=usage if index == 1 else None,
                    finish_reason="stop" if index == 1 else None,
                ),
            )
            for index, part in enumerate((text[: len(text) // 2], text[len(text) // 2 :]))
        )

    monkeypatch.setattr(model_instance.model_type_instance, "get_model_schema", get_model_schema)
    monkeypatch.setattr(model_instance, "invoke_llm", invoke_model)
    return model_instance, schema, calls


def _structured_node(prepared: DifyPreparedLLM) -> LLMNode:
    init_params = build_test_graph_init_params()
    run_context = resolve_dify_run_context(init_params.run_context)
    return LLMNode(
        node_id="llm",
        data=LLMNodeData.model_validate(
            {
                "title": "Boolean output",
                "type": "llm",
                "model": {"provider": _PROVIDER, "name": _MODEL, "mode": "chat"},
                "prompt_template": [{"role": "user", "text": "Return the requested boolean fields."}],
                "context": {"enabled": False},
                "structured_output_switch_on": True,
                "structured_output": {"schema": _OUTPUT_SCHEMA},
            }
        ),
        init_params=init_params,
        runtime_state=RuntimeState(
            workflow_id=init_params.workflow_id, variable_pool=VariablePool(), start_at=time.perf_counter()
        ),
        model_instance=prepared,
        llm_file_saver=build_dify_llm_file_saver(run_context=run_context, http_client=graphon_ssrf_proxy),
        prompt_message_serializer=DifyPromptMessageSerializer(),
    )


def _assert_schema_route(call: _ProviderCall, *, native: bool) -> None:
    parameters = call.model_parameters
    system_prompts = [message for message in call.prompt_messages if isinstance(message, SystemPromptMessage)]
    if native:
        schema_parameter = parameters["json_schema"]
        assert isinstance(schema_parameter, str)
        assert json.loads(schema_parameter) == {"name": "llm_response", "schema": _OUTPUT_SCHEMA}
        assert parameters["response_format"] == "json_schema"
        assert not system_prompts
    else:
        assert "json_schema" not in parameters
        assert parameters["response_format"] == "json_object"
        assert len(system_prompts) == 1
        assert isinstance(system_prompts[0].content, str)
        assert json.dumps(_OUTPUT_SCHEMA, ensure_ascii=False) in system_prompts[0].content


@pytest.mark.parametrize("features", _FEATURE_CASES)
@pytest.mark.parametrize("streamed", [False, True], ids=["blocking", "streaming"])
def test_structured_output_reaches_provider_and_preserves_nested_booleans(
    monkeypatch: pytest.MonkeyPatch, features: list[ModelFeature] | None, streamed: bool
) -> None:
    model_instance, provider_schema, calls = _provider_model(
        monkeypatch, features=features, response=_VALID_OUTPUT, streamed=streamed
    )
    original_schema = provider_schema.model_dump(mode="json")
    node = _structured_node(DifyPreparedLLM(model_instance))

    completions = [event.node_run_result for event in node._run() if isinstance(event, StreamCompletedEvent)]

    assert len(completions) == 1
    result = completions[0]
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED, result.error
    assert result.outputs is not None
    output = result.outputs["structured_output"]
    assert output == _VALID_OUTPUT
    assert output["profile"]["active"] is False
    assert output["flags"][0] is False
    assert output["flags"][1] is True
    assert len(calls) == 1
    _assert_schema_route(calls[0], native=bool(features and ModelFeature.STRUCTURED_OUTPUT in features))
    assert provider_schema.model_dump(mode="json") == original_schema


@pytest.mark.parametrize(
    ("response", "error_path"),
    [
        pytest.param({"profile": {"active": "false"}, "flags": [False]}, "$.profile.active", id="nested"),
        pytest.param({"profile": {"active": False}, "flags": ["false"]}, "$.flags[0]", id="array"),
    ],
)
@pytest.mark.parametrize(
    "features",
    [pytest.param([ModelFeature.TOOL_CALL], id="prompt"), pytest.param([ModelFeature.STRUCTURED_OUTPUT], id="native")],
)
@pytest.mark.parametrize("streamed", [False, True], ids=["blocking", "streaming"])
def test_string_boolean_still_fails_strict_result_validation(
    monkeypatch: pytest.MonkeyPatch,
    response: dict[str, object],
    error_path: str,
    features: list[ModelFeature],
    streamed: bool,
) -> None:
    model_instance, _, calls = _provider_model(monkeypatch, features=features, response=response, streamed=streamed)
    node = _structured_node(DifyPreparedLLM(model_instance))

    completions = [event.node_run_result for event in node._run() if isinstance(event, StreamCompletedEvent)]

    assert len(completions) == 1
    result = completions[0]
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error_type == "LLMNodeError"
    assert result.error is not None
    assert f"stage=result, path={error_path}" in result.error
    assert "is not of type 'boolean'" in result.error
    assert not result.outputs
    assert len(calls) == 1
    _assert_schema_route(calls[0], native=ModelFeature.STRUCTURED_OUTPUT in features)


@pytest.mark.parametrize("features", _FEATURE_CASES)
def test_effective_capabilities_do_not_mutate_provider_schema_or_accumulate(
    monkeypatch: pytest.MonkeyPatch, features: list[ModelFeature] | None
) -> None:
    model_instance, provider_schema, _ = _provider_model(
        monkeypatch, features=features, response=_VALID_OUTPUT, streamed=False
    )
    original_schema = provider_schema.model_dump(mode="json")
    prepared = DifyPreparedLLM(model_instance)

    for _ in range(3):
        effective_schema = prepared.get_model_schema()
        if features is None:
            assert effective_schema.features is None
        else:
            assert effective_schema.features is not None
            assert effective_schema.features.count(ModelFeature.STRUCTURED_OUTPUT) == 1
            assert all(feature in effective_schema.features for feature in features)
        assert provider_schema.model_dump(mode="json") == original_schema


@pytest.mark.parametrize("native", [False, True], ids=["without-native-schema", "with-native-schema"])
def test_polling_adapter_preserves_provider_capabilities(monkeypatch: pytest.MonkeyPatch, native: bool) -> None:
    features = [ModelFeature.POLLING]
    if native:
        features.append(ModelFeature.STRUCTURED_OUTPUT)
    model_instance, provider_schema, calls = _provider_model(
        monkeypatch, features=features, response=_VALID_OUTPUT, streamed=False
    )
    prepared = DifyPreparedPollingLLM(model_instance)

    assert prepared.get_model_schema() is provider_schema
    assert prepared.get_model_schema().features == features
    assert prepared.get_model_schema().support_structure_output is native
    assert prepared.get_model_schema().support_polling is True
    if not native:
        node = _structured_node(prepared)
        completions = [event.node_run_result for event in node._run() if isinstance(event, StreamCompletedEvent)]
        assert len(completions) == 1
        assert completions[0].status == WorkflowNodeExecutionStatus.FAILED
        assert "stage=capability" in (completions[0].error or "")
        assert not calls
