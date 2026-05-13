import pytest
from pydantic import ValidationError
from pydantic_ai.messages import FinalResultEvent

from agenton.compositor import CompositorSessionSnapshot
from agenton.layers import ExitIntent
from agenton_collections.layers.plain import PLAIN_PROMPT_LAYER_TYPE_ID, PromptLayerConfig
import dify_agent.protocol as protocol_exports
from dify_agent.layers.dify_plugin import DIFY_PLUGIN_LAYER_TYPE_ID, DIFY_PLUGIN_LLM_LAYER_TYPE_ID
from dify_agent.layers.output import DIFY_OUTPUT_LAYER_TYPE_ID, DifyOutputLayerConfig
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID, DIFY_AGENT_OUTPUT_LAYER_ID
from dify_agent.protocol.schemas import (
    RUN_EVENT_ADAPTER,
    CreateRunRequest,
    LayerExitSignals,
    PydanticAIStreamRunEvent,
    RunComposition,
    RunFailedEvent,
    RunFailedEventData,
    RunLayerSpec,
    RunStartedEvent,
    RunSucceededEvent,
    RunSucceededEventData,
    normalize_composition,
)
from dify_agent.layers.dify_plugin.configs import DifyPluginLLMLayerConfig, DifyPluginLayerConfig


def test_run_event_adapter_round_trips_typed_variants() -> None:
    events = [
        RunStartedEvent(run_id="run-1"),
        PydanticAIStreamRunEvent(run_id="run-1", data=FinalResultEvent(tool_name=None, tool_call_id=None)),
        RunSucceededEvent(
            run_id="run-1",
            data=RunSucceededEventData(
                output={"answer": ["done"]},
                session_snapshot=CompositorSessionSnapshot(layers=[]),
            ),
        ),
        RunFailedEvent(run_id="run-1", data=RunFailedEventData(error="boom", reason="shutdown")),
    ]

    for event in events:
        payload = RUN_EVENT_ADAPTER.dump_json(event)
        decoded = RUN_EVENT_ADAPTER.validate_json(payload)

        assert decoded.type == event.type
        assert decoded.run_id == event.run_id


def test_pydantic_ai_event_data_uses_agent_stream_event_model() -> None:
    event = RUN_EVENT_ADAPTER.validate_python(
        {
            "run_id": "run-1",
            "type": "pydantic_ai_event",
            "data": {"event_kind": "final_result", "tool_name": None, "tool_call_id": None},
        }
    )

    assert isinstance(event, PydanticAIStreamRunEvent)
    assert isinstance(event.data, FinalResultEvent)


def test_create_run_request_rejects_old_compositor_payload_and_model_layer_id_is_public() -> None:
    assert DIFY_AGENT_MODEL_LAYER_ID == "llm"
    assert DIFY_AGENT_OUTPUT_LAYER_ID == "output"
    with pytest.raises(ValidationError):
        _ = CreateRunRequest.model_validate(
            {
                "compositor": {"layers": []},
            }
        )


def test_create_run_request_accepts_dto_first_public_composition_and_normalizes_graph_config() -> None:
    prompt_config = PromptLayerConfig(prefix="system", user="hello")
    plugin_config = DifyPluginLayerConfig(tenant_id="tenant-1", plugin_id="langgenius/openai")
    llm_config = DifyPluginLLMLayerConfig(
        model_provider="openai",
        model="demo-model",
        credentials={"api_key": "secret"},
    )
    output_config = DifyOutputLayerConfig(
        json_schema={
            "type": "object",
            "properties": {"title": {"type": "string"}},
            "required": ["title"],
            "additionalProperties": False,
        }
    )
    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(name="prompt", type=PLAIN_PROMPT_LAYER_TYPE_ID, config=prompt_config),
                RunLayerSpec(name="plugin", type=DIFY_PLUGIN_LAYER_TYPE_ID, config=plugin_config),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type=DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
                    deps={"plugin": "plugin"},
                    config=llm_config,
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_OUTPUT_LAYER_ID,
                    type=DIFY_OUTPUT_LAYER_TYPE_ID,
                    config=output_config,
                ),
            ]
        )
    )

    graph_config, layer_configs = normalize_composition(request.composition)
    payload = request.model_dump(mode="json")

    assert payload["composition"]["layers"][0]["config"] == {"prefix": "system", "user": "hello", "suffix": []}
    assert [layer.model_dump(mode="json") for layer in graph_config.layers] == [
        {"name": "prompt", "type": PLAIN_PROMPT_LAYER_TYPE_ID, "deps": {}, "metadata": {}},
        {"name": "plugin", "type": DIFY_PLUGIN_LAYER_TYPE_ID, "deps": {}, "metadata": {}},
        {
            "name": DIFY_AGENT_MODEL_LAYER_ID,
            "type": DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
            "deps": {"plugin": "plugin"},
            "metadata": {},
        },
        {
            "name": DIFY_AGENT_OUTPUT_LAYER_ID,
            "type": DIFY_OUTPUT_LAYER_TYPE_ID,
            "deps": {},
            "metadata": {},
        },
    ]
    assert layer_configs == {
        "prompt": prompt_config,
        "plugin": plugin_config,
        DIFY_AGENT_MODEL_LAYER_ID: llm_config,
        DIFY_AGENT_OUTPUT_LAYER_ID: output_config,
    }


def test_on_exit_default_to_suspend_and_are_public() -> None:
    assert protocol_exports.LayerExitSignals is LayerExitSignals
    assert protocol_exports.RunComposition is RunComposition
    assert protocol_exports.RunLayerSpec is RunLayerSpec
    assert protocol_exports.normalize_composition is normalize_composition
    assert protocol_exports.DIFY_AGENT_OUTPUT_LAYER_ID == DIFY_AGENT_OUTPUT_LAYER_ID
    request = CreateRunRequest.model_validate({"composition": {"layers": []}})

    assert request.on_exit.default is ExitIntent.SUSPEND
    assert request.on_exit.layers == {}


def test_on_exit_accept_layer_overrides() -> None:
    request = CreateRunRequest.model_validate(
        {
            "composition": {"layers": []},
            "on_exit": {
                "default": "delete",
                "layers": {"prompt": "suspend", "llm": "delete"},
            },
        }
    )

    assert request.on_exit.default is ExitIntent.DELETE
    assert request.on_exit.layers == {"prompt": ExitIntent.SUSPEND, "llm": ExitIntent.DELETE}


def test_layer_exit_signals_reject_extra_fields() -> None:
    with pytest.raises(ValidationError):
        _ = LayerExitSignals.model_validate({"default": "suspend", "unknown": "value"})


@pytest.mark.parametrize("event_type", ["agent_output", "session_snapshot"])
def test_removed_non_terminal_payload_events_are_rejected(event_type: str) -> None:
    with pytest.raises(ValidationError):
        _ = RUN_EVENT_ADAPTER.validate_python({"run_id": "run-1", "type": event_type, "data": {}})
