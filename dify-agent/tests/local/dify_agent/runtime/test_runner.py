import asyncio

import pytest
from pydantic_ai.models.test import TestModel

from agenton.compositor import CompositorConfig, LayerNodeConfig
from agenton.layers import ExitIntent, LayerControl, LifecycleState
from agenton_collections.layers.plain import PromptLayerConfig
from dify_agent.layers.dify_plugin.configs import DifyPluginLLMLayerConfig, DifyPluginLayerConfig
from dify_agent.layers.dify_plugin.llm_layer import DifyPluginLLMLayer
from dify_agent.layers.dify_plugin.plugin_layer import DifyPluginRuntimeHandles
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID
from dify_agent.protocol.schemas import CreateRunRequest, LayerExitSignals, RunSucceededEvent
from dify_agent.runtime.event_sink import InMemoryRunEventSink
from dify_agent.runtime.runner import AgentRunRunner, AgentRunValidationError


def _request(
    user: str | list[str] = "hello",
    *,
    llm_layer_name: str = DIFY_AGENT_MODEL_LAYER_ID,
    plugin_layer_name: str = "plugin",
    layer_exit_signals: LayerExitSignals | None = None,
) -> CreateRunRequest:
    return CreateRunRequest(
        compositor=CompositorConfig(
            layers=[
                LayerNodeConfig(
                    name="prompt",
                    type="plain.prompt",
                    config=PromptLayerConfig(prefix="system", user=user),
                ),
                LayerNodeConfig(
                    name=plugin_layer_name,
                    type="dify.plugin",
                    config=DifyPluginLayerConfig(tenant_id="tenant-1", plugin_id="langgenius/openai"),
                ),
                LayerNodeConfig(
                    name=llm_layer_name,
                    type="dify.plugin.llm",
                    deps={"plugin": plugin_layer_name},
                    config=DifyPluginLLMLayerConfig(
                        model_provider="openai",
                        model="demo-model",
                        credentials={"api_key": "secret"},
                    ),
                ),
            ]
        ),
        layer_exit_signals=layer_exit_signals or LayerExitSignals(),
    )


def test_runner_emits_terminal_success_and_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get_model(self: DifyPluginLLMLayer, control: LayerControl):
        assert self.config.model == "demo-model"
        plugin_control = control.control_for(self.deps.plugin)
        plugin_handles = plugin_control.runtime_handles
        assert isinstance(plugin_handles, DifyPluginRuntimeHandles)
        assert plugin_handles.http_client is not None
        return TestModel(custom_output_text="done")  # pyright: ignore[reportReturnType]

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    request = _request(plugin_layer_name="renamed-plugin")
    sink = InMemoryRunEventSink()

    asyncio.run(AgentRunRunner(sink=sink, request=request, run_id="run-1").run())

    event_types = [event.type for event in sink.events["run-1"]]
    assert event_types[0] == "run_started"
    assert "pydantic_ai_event" in event_types
    assert "agent_output" not in event_types
    assert "session_snapshot" not in event_types
    assert event_types[-1:] == ["run_succeeded"]
    terminal = sink.events["run-1"][-1]
    assert isinstance(terminal, RunSucceededEvent)
    assert terminal.data.output == "done"
    assert [layer.name for layer in terminal.data.session_snapshot.layers] == [
        "prompt",
        "renamed-plugin",
        DIFY_AGENT_MODEL_LAYER_ID,
    ]
    assert [layer.state for layer in terminal.data.session_snapshot.layers] == [
        LifecycleState.SUSPENDED,
        LifecycleState.SUSPENDED,
        LifecycleState.SUSPENDED,
    ]
    assert sink.statuses["run-1"] == "succeeded"


def test_runner_applies_layer_exit_signal_overrides_to_success_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get_model(_self: DifyPluginLLMLayer, _control: LayerControl):
        return TestModel(custom_output_text="done")  # pyright: ignore[reportReturnType]

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    request = _request(
        layer_exit_signals=LayerExitSignals(
            default=ExitIntent.SUSPEND,
            layers={"prompt": ExitIntent.DELETE, DIFY_AGENT_MODEL_LAYER_ID: ExitIntent.DELETE},
        )
    )
    sink = InMemoryRunEventSink()

    asyncio.run(AgentRunRunner(sink=sink, request=request, run_id="run-exit").run())

    terminal = sink.events["run-exit"][-1]
    assert isinstance(terminal, RunSucceededEvent)
    assert {layer.name: layer.state for layer in terminal.data.session_snapshot.layers} == {
        "prompt": LifecycleState.CLOSED,
        "plugin": LifecycleState.SUSPENDED,
        DIFY_AGENT_MODEL_LAYER_ID: LifecycleState.CLOSED,
    }


def test_runner_rejects_unknown_layer_exit_signal_id() -> None:
    request = _request(layer_exit_signals=LayerExitSignals(layers={"missing": ExitIntent.DELETE}))
    sink = InMemoryRunEventSink()

    with pytest.raises(AgentRunValidationError, match="missing"):
        asyncio.run(AgentRunRunner(sink=sink, request=request, run_id="run-unknown-signal").run())

    assert [event.type for event in sink.events["run-unknown-signal"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-unknown-signal"] == "failed"


def test_runner_applies_layer_exit_signals_before_model_resolution_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get_model(self: DifyPluginLLMLayer, control: LayerControl):
        plugin_control = control.control_for(self.deps.plugin)
        assert control.exit_intent is ExitIntent.DELETE
        assert plugin_control.exit_intent is ExitIntent.SUSPEND
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    request = _request(
        layer_exit_signals=LayerExitSignals(
            default=ExitIntent.DELETE,
            layers={"plugin": ExitIntent.SUSPEND},
        )
    )
    sink = InMemoryRunEventSink()

    with pytest.raises(AgentRunValidationError, match="model unavailable"):
        asyncio.run(AgentRunRunner(sink=sink, request=request, run_id="run-model-failure").run())

    assert [event.type for event in sink.events["run-model-failure"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-model-failure"] == "failed"


def test_runner_fails_empty_user_prompts() -> None:
    request = _request("")
    sink = InMemoryRunEventSink()

    with pytest.raises(AgentRunValidationError):
        asyncio.run(AgentRunRunner(sink=sink, request=request, run_id="run-2").run())

    assert [event.type for event in sink.events["run-2"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-2"] == "failed"


def test_runner_fails_blank_string_user_prompt_list() -> None:
    request = _request(["", "   "])
    sink = InMemoryRunEventSink()

    with pytest.raises(AgentRunValidationError):
        asyncio.run(AgentRunRunner(sink=sink, request=request, run_id="run-3").run())

    assert [event.type for event in sink.events["run-3"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-3"] == "failed"


def test_runner_requires_llm_layer_id() -> None:
    request = _request(llm_layer_name="not-llm")
    sink = InMemoryRunEventSink()

    with pytest.raises(AgentRunValidationError, match="llm"):
        asyncio.run(AgentRunRunner(sink=sink, request=request, run_id="run-4").run())

    assert [event.type for event in sink.events["run-4"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-4"] == "failed"
