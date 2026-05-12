import asyncio

import httpx
import pytest
from pydantic_ai.models.test import TestModel

from agenton.compositor import CompositorSessionSnapshot, LayerSessionSnapshot
from agenton.layers import ExitIntent, LifecycleState
from agenton_collections.layers.plain import PromptLayerConfig
from dify_agent.layers.dify_plugin.configs import DifyPluginLLMLayerConfig, DifyPluginLayerConfig
from dify_agent.layers.dify_plugin.llm_layer import DifyPluginLLMLayer
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID
from dify_agent.protocol.schemas import (
    CreateRunRequest,
    LayerExitSignals,
    RunComposition,
    RunLayerSpec,
    RunSucceededEvent,
)
from dify_agent.runtime.event_sink import InMemoryRunEventSink
from dify_agent.runtime.runner import AgentRunRunner, AgentRunValidationError


def _request(
    user: str | list[str] = "hello",
    *,
    llm_layer_name: str = DIFY_AGENT_MODEL_LAYER_ID,
    plugin_layer_name: str = "plugin",
    on_exit: LayerExitSignals | None = None,
) -> CreateRunRequest:
    return CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="prompt",
                    type="plain.prompt",
                    config=PromptLayerConfig(prefix="system", user=user),
                ),
                RunLayerSpec(
                    name=plugin_layer_name,
                    type="dify.plugin",
                    config=DifyPluginLayerConfig(tenant_id="tenant-1", plugin_id="langgenius/openai"),
                ),
                RunLayerSpec(
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
        on_exit=on_exit or LayerExitSignals(),
    )


def test_runner_emits_terminal_success_and_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    seen_clients: list[httpx.AsyncClient] = []

    def fake_get_model(self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient):
        assert self.config.model == "demo-model"
        assert self.deps.plugin.config.plugin_id == "langgenius/openai"
        seen_clients.append(http_client)
        return TestModel(custom_output_text="done")  # pyright: ignore[reportReturnType]

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    request = _request(plugin_layer_name="renamed-plugin")
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=request,
                run_id="run-1",
                plugin_daemon_http_client=client,
            ).run()
            assert seen_clients == [client]
            assert client.is_closed is False

    asyncio.run(scenario())

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
    assert [layer.lifecycle_state for layer in terminal.data.session_snapshot.layers] == [
        LifecycleState.SUSPENDED,
        LifecycleState.SUSPENDED,
        LifecycleState.SUSPENDED,
    ]
    assert sink.statuses["run-1"] == "succeeded"


def test_runner_applies_on_exit_overrides_to_success_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="done")  # pyright: ignore[reportReturnType]

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    request = _request(
        on_exit=LayerExitSignals(
            default=ExitIntent.SUSPEND,
            layers={"prompt": ExitIntent.DELETE, DIFY_AGENT_MODEL_LAYER_ID: ExitIntent.DELETE},
        )
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=request,
                run_id="run-exit",
                plugin_daemon_http_client=client,
            ).run()

    asyncio.run(scenario())

    terminal = sink.events["run-exit"][-1]
    assert isinstance(terminal, RunSucceededEvent)
    assert {layer.name: layer.lifecycle_state for layer in terminal.data.session_snapshot.layers} == {
        "prompt": LifecycleState.CLOSED,
        "plugin": LifecycleState.SUSPENDED,
        DIFY_AGENT_MODEL_LAYER_ID: LifecycleState.CLOSED,
    }


def test_runner_rejects_unknown_on_exit_layer_id() -> None:
    request = _request(on_exit=LayerExitSignals(layers={"missing": ExitIntent.DELETE}))
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(AgentRunValidationError, match="missing"):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-unknown-signal",
                    plugin_daemon_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert [event.type for event in sink.events["run-unknown-signal"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-unknown-signal"] == "failed"


def test_runner_honors_explicit_empty_layer_providers() -> None:
    request = _request()
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(AgentRunValidationError, match="plain.prompt"):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-empty-providers",
                    plugin_daemon_http_client=client,
                    layer_providers=(),
                ).run()

    asyncio.run(scenario())

    assert [event.type for event in sink.events["run-empty-providers"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-empty-providers"] == "failed"


def test_runner_fails_empty_user_prompts() -> None:
    request = _request("")
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(AgentRunValidationError):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-2",
                    plugin_daemon_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert [event.type for event in sink.events["run-2"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-2"] == "failed"


def test_runner_fails_blank_string_user_prompt_list() -> None:
    request = _request(["", "   "])
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(AgentRunValidationError):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-3",
                    plugin_daemon_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert [event.type for event in sink.events["run-3"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-3"] == "failed"


def test_runner_requires_llm_layer_id() -> None:
    request = _request(llm_layer_name="not-llm")
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(AgentRunValidationError, match="llm"):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-4",
                    plugin_daemon_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert [event.type for event in sink.events["run-4"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-4"] == "failed"


def test_runner_rejects_closed_session_snapshot_as_validation_error() -> None:
    request = _request()
    request.session_snapshot = CompositorSessionSnapshot(
        layers=[
            LayerSessionSnapshot(
                name="prompt",
                lifecycle_state=LifecycleState.CLOSED,
                runtime_state={},
            ),
            LayerSessionSnapshot(
                name="plugin",
                lifecycle_state=LifecycleState.NEW,
                runtime_state={},
            ),
            LayerSessionSnapshot(
                name=DIFY_AGENT_MODEL_LAYER_ID,
                lifecycle_state=LifecycleState.NEW,
                runtime_state={},
            ),
        ]
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(AgentRunValidationError, match="CLOSED snapshots cannot be entered"):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-closed-snapshot",
                    plugin_daemon_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert [event.type for event in sink.events["run-closed-snapshot"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-closed-snapshot"] == "failed"
