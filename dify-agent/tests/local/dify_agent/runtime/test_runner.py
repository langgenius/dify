import asyncio
from collections.abc import Mapping
from typing import Any

import httpx
import pytest
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.models.test import TestModel
from pydantic_ai.settings import ModelSettings

from agenton.compositor import CompositorSessionSnapshot, LayerSessionSnapshot
from agenton.layers import ExitIntent, LifecycleState
from agenton_collections.layers.plain import PromptLayerConfig
from dify_agent.layers.dify_plugin.configs import DifyPluginLLMLayerConfig, DifyPluginLayerConfig
from dify_agent.layers.dify_plugin.llm_layer import DifyPluginLLMLayer
from dify_agent.layers.output import DIFY_OUTPUT_LAYER_TYPE_ID, DifyOutputLayerConfig
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID, DIFY_AGENT_OUTPUT_LAYER_ID
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
    output_config: Mapping[str, object] | DifyOutputLayerConfig | None = None,
) -> CreateRunRequest:
    layers = [
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
    if output_config is not None:
        layers.append(
            RunLayerSpec(
                name=DIFY_AGENT_OUTPUT_LAYER_ID,
                type=DIFY_OUTPUT_LAYER_TYPE_ID,
                config=output_config,
            )
        )

    return CreateRunRequest(
        composition=RunComposition(layers=layers),
        on_exit=on_exit or LayerExitSignals(),
    )


def _recursive_output_schema() -> dict[str, object]:
    return {
        "type": "object",
        "properties": {"node": {"$ref": "#/$defs/node"}},
        "$defs": {
            "node": {
                "type": "object",
                "properties": {"child": {"$ref": "#/$defs/node"}},
                "additionalProperties": False,
            }
        },
        "additionalProperties": False,
    }


class SequenceOutputTestModel(TestModel):
    outputs: list[str | dict[str, Any] | None]
    request_count: int

    def __init__(self, outputs: list[str | dict[str, Any] | None]) -> None:
        super().__init__(call_tools=[])
        self.outputs = outputs
        self.request_count = 0

    def _request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        if not model_request_parameters.output_tools:
            return super()._request(messages, model_settings, model_request_parameters)

        output_tool = model_request_parameters.output_tools[0]
        next_index = min(self.request_count, len(self.outputs) - 1)
        output_args = self.outputs[next_index]
        self.request_count += 1
        return ModelResponse(
            parts=[
                ToolCallPart(
                    output_tool.name,
                    output_args,
                    tool_call_id=f"pyd_ai_tool_call_id__{output_tool.name}_{self.request_count}",
                )
            ],
            model_name=self.model_name,
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


def test_runner_passes_output_layer_spec_to_agent_and_serializes_structured_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model = TestModel(
        custom_output_args={
            "title": "Database outage",
            "severity": "high",
            "actions": ["page on-call", "open incident bridge"],
        }
    )

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient):
        assert http_client.is_closed is False
        return model  # pyright: ignore[reportReturnType]

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    request = _request(
        output_config=DifyOutputLayerConfig(
            json_schema={
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "severity": {"type": "string", "enum": ["low", "medium", "high"]},
                    "actions": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["title", "severity", "actions"],
                "additionalProperties": False,
            },
            name="incident_summary",
            description="Structured incident summary returned by the agent.",
            strict=True,
        )
    )
    sink = InMemoryRunEventSink()
    expected_snapshot_layer_names = ["prompt", "plugin", DIFY_AGENT_MODEL_LAYER_ID, DIFY_AGENT_OUTPUT_LAYER_ID]

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=request,
                run_id="run-structured-output",
                plugin_daemon_http_client=client,
            ).run()

            first_terminal = sink.events["run-structured-output"][-1]
            assert isinstance(first_terminal, RunSucceededEvent)

            resumed_request = request.model_copy(deep=True)
            resumed_request.session_snapshot = first_terminal.data.session_snapshot

            await AgentRunRunner(
                sink=sink,
                request=resumed_request,
                run_id="run-structured-output-resume",
                plugin_daemon_http_client=client,
            ).run()

    asyncio.run(scenario())

    assert model.last_model_request_parameters is not None
    assert len(model.last_model_request_parameters.output_tools) == 1
    output_tool = model.last_model_request_parameters.output_tools[0]
    assert output_tool.name == "incident_summary"
    assert output_tool.description == "Structured incident summary returned by the agent."
    assert output_tool.parameters_json_schema["type"] == "object"
    assert output_tool.parameters_json_schema["title"] == "incident_summary"
    assert output_tool.parameters_json_schema["properties"] == {
        "title": {"type": "string"},
        "severity": {"type": "string", "enum": ["low", "medium", "high"]},
        "actions": {"type": "array", "items": {"type": "string"}},
    }
    assert output_tool.parameters_json_schema["required"] == ["title", "severity", "actions"]
    assert output_tool.parameters_json_schema["additionalProperties"] is False
    terminal = sink.events["run-structured-output"][-1]
    resumed_terminal = sink.events["run-structured-output-resume"][-1]
    assert isinstance(terminal, RunSucceededEvent)
    assert isinstance(resumed_terminal, RunSucceededEvent)
    assert terminal.data.output == {
        "title": "Database outage",
        "severity": "high",
        "actions": ["page on-call", "open incident bridge"],
    }
    assert resumed_terminal.data.output == terminal.data.output
    assert [layer.name for layer in terminal.data.session_snapshot.layers] == expected_snapshot_layer_names
    assert [layer.name for layer in resumed_terminal.data.session_snapshot.layers] == expected_snapshot_layer_names
    assert all(layer.lifecycle_state is LifecycleState.SUSPENDED for layer in terminal.data.session_snapshot.layers)
    assert all(
        layer.lifecycle_state is LifecycleState.SUSPENDED for layer in resumed_terminal.data.session_snapshot.layers
    )


def test_runner_retries_invalid_structured_output_and_eventually_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    model = SequenceOutputTestModel(
        outputs=[
            {"title": "Database outage", "severity": "high", "actions": "page on-call"},
            {"title": "Database outage", "severity": "high", "actions": ["page on-call"]},
        ]
    )

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient):
        assert http_client.is_closed is False
        return model  # pyright: ignore[reportReturnType]

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    request = _request(
        output_config=DifyOutputLayerConfig(
            json_schema={
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "severity": {"type": "string", "enum": ["low", "medium", "high"]},
                    "actions": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["title", "severity", "actions"],
                "additionalProperties": False,
            },
            name="incident_summary",
            description="Structured incident summary returned by the agent.",
        )
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=request,
                run_id="run-output-retry-success",
                plugin_daemon_http_client=client,
            ).run()

    asyncio.run(scenario())

    terminal = sink.events["run-output-retry-success"][-1]
    assert isinstance(terminal, RunSucceededEvent)
    assert terminal.data.output == {
        "title": "Database outage",
        "severity": "high",
        "actions": ["page on-call"],
    }
    assert model.request_count == 2


def test_runner_fails_when_invalid_structured_output_exhausts_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    model = TestModel(
        custom_output_args={
            "title": "Database outage",
            "severity": "high",
            "actions": "page on-call",
        }
    )

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient):
        assert http_client.is_closed is False
        return model  # pyright: ignore[reportReturnType]

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    request = _request(
        output_config=DifyOutputLayerConfig(
            json_schema={
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "severity": {"type": "string", "enum": ["low", "medium", "high"]},
                    "actions": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["title", "severity", "actions"],
                "additionalProperties": False,
            },
            name="incident_summary",
            description="Structured incident summary returned by the agent.",
        )
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(UnexpectedModelBehavior):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-output-retry-failed",
                    plugin_daemon_http_client=client,
                ).run()

    asyncio.run(scenario())

    event_types = [event.type for event in sink.events["run-output-retry-failed"]]
    assert event_types[0] == "run_started"
    assert event_types[-1] == "run_failed"
    assert "run_succeeded" not in event_types
    assert sink.statuses["run-output-retry-failed"] == "failed"


def test_runner_rejects_invalid_output_layer_before_model_resolution(monkeypatch: pytest.MonkeyPatch) -> None:
    model_requested = False

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient):
        del http_client
        nonlocal model_requested
        model_requested = True
        return TestModel(custom_output_text="done")  # pyright: ignore[reportReturnType]

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    request = _request(
        output_config={
            "name": "incident_summary",
            "json_schema": _recursive_output_schema(),
        }
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(AgentRunValidationError, match=r"Recursive \$defs refs are not supported"):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-invalid-output",
                    plugin_daemon_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert model_requested is False
    assert [event.type for event in sink.events["run-invalid-output"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-invalid-output"] == "failed"


def test_runner_rejects_misnamed_output_layer_before_model_resolution(monkeypatch: pytest.MonkeyPatch) -> None:
    model_requested = False
    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="prompt",
                    type="plain.prompt",
                    config=PromptLayerConfig(prefix="system", user="hello"),
                ),
                RunLayerSpec(
                    name="plugin",
                    type="dify.plugin",
                    config=DifyPluginLayerConfig(tenant_id="tenant-1", plugin_id="langgenius/openai"),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type="dify.plugin.llm",
                    deps={"plugin": "plugin"},
                    config=DifyPluginLLMLayerConfig(
                        model_provider="openai",
                        model="demo-model",
                        credentials={"api_key": "secret"},
                    ),
                ),
                RunLayerSpec(
                    name="structured-output",
                    type=DIFY_OUTPUT_LAYER_TYPE_ID,
                    config=DifyOutputLayerConfig(
                        json_schema={
                            "type": "object",
                            "properties": {"title": {"type": "string"}},
                            "required": ["title"],
                            "additionalProperties": False,
                        }
                    ),
                ),
            ]
        ),
        on_exit=LayerExitSignals(),
    )
    sink = InMemoryRunEventSink()

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient):
        del http_client
        nonlocal model_requested
        model_requested = True
        return TestModel(custom_output_text="done")  # pyright: ignore[reportReturnType]

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(AgentRunValidationError, match="must use reserved layer name 'output'"):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-misnamed-output",
                    plugin_daemon_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert model_requested is False
    assert [event.type for event in sink.events["run-misnamed-output"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-misnamed-output"] == "failed"


def test_runner_rejects_multiple_output_layers_before_model_resolution(monkeypatch: pytest.MonkeyPatch) -> None:
    model_requested = False
    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="prompt",
                    type="plain.prompt",
                    config=PromptLayerConfig(prefix="system", user="hello"),
                ),
                RunLayerSpec(
                    name="plugin",
                    type="dify.plugin",
                    config=DifyPluginLayerConfig(tenant_id="tenant-1", plugin_id="langgenius/openai"),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type="dify.plugin.llm",
                    deps={"plugin": "plugin"},
                    config=DifyPluginLLMLayerConfig(
                        model_provider="openai",
                        model="demo-model",
                        credentials={"api_key": "secret"},
                    ),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_OUTPUT_LAYER_ID,
                    type=DIFY_OUTPUT_LAYER_TYPE_ID,
                    config=DifyOutputLayerConfig(
                        json_schema={
                            "type": "object",
                            "properties": {"title": {"type": "string"}},
                            "required": ["title"],
                            "additionalProperties": False,
                        }
                    ),
                ),
                RunLayerSpec(
                    name="secondary-output",
                    type=DIFY_OUTPUT_LAYER_TYPE_ID,
                    config=DifyOutputLayerConfig(
                        json_schema={
                            "type": "object",
                            "properties": {"summary": {"type": "string"}},
                            "required": ["summary"],
                            "additionalProperties": False,
                        }
                    ),
                ),
            ]
        ),
        on_exit=LayerExitSignals(),
    )
    sink = InMemoryRunEventSink()

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient):
        del http_client
        nonlocal model_requested
        model_requested = True
        return TestModel(custom_output_text="done")  # pyright: ignore[reportReturnType]

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(AgentRunValidationError, match="Only one 'dify.output' layer is supported"):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-duplicate-output",
                    plugin_daemon_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert model_requested is False
    assert [event.type for event in sink.events["run-duplicate-output"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-duplicate-output"] == "failed"


def test_runner_rejects_reserved_output_name_with_wrong_layer_type_before_model_resolution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model_requested = False

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient):
        del http_client
        nonlocal model_requested
        model_requested = True
        return TestModel(custom_output_text="done")  # pyright: ignore[reportReturnType]

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="prompt",
                    type="plain.prompt",
                    config=PromptLayerConfig(prefix="system", user="hello"),
                ),
                RunLayerSpec(
                    name="plugin",
                    type="dify.plugin",
                    config=DifyPluginLayerConfig(tenant_id="tenant-1", plugin_id="langgenius/openai"),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type="dify.plugin.llm",
                    deps={"plugin": "plugin"},
                    config=DifyPluginLLMLayerConfig(
                        model_provider="openai",
                        model="demo-model",
                        credentials={"api_key": "secret"},
                    ),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_OUTPUT_LAYER_ID,
                    type="plain.prompt",
                    config=PromptLayerConfig(user="not structured output"),
                ),
            ]
        ),
        on_exit=LayerExitSignals(),
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(
                AgentRunValidationError, match=r"Layer 'output' must be DifyOutputLayer, got PromptLayer"
            ):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-wrong-output-type",
                    plugin_daemon_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert model_requested is False
    assert [event.type for event in sink.events["run-wrong-output-type"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-wrong-output-type"] == "failed"


def test_runner_rejects_misnamed_output_layer_before_provider_checks() -> None:
    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="prompt",
                    type="plain.prompt",
                    config=PromptLayerConfig(prefix="system", user="hello"),
                ),
                RunLayerSpec(
                    name="structured-output",
                    type=DIFY_OUTPUT_LAYER_TYPE_ID,
                    config=DifyOutputLayerConfig(
                        json_schema={
                            "type": "object",
                            "properties": {"title": {"type": "string"}},
                            "required": ["title"],
                            "additionalProperties": False,
                        }
                    ),
                ),
            ]
        ),
        on_exit=LayerExitSignals(),
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(AgentRunValidationError, match="must use reserved layer name 'output'"):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-misnamed-output-before-providers",
                    plugin_daemon_http_client=client,
                    layer_providers=(),
                ).run()

    asyncio.run(scenario())

    assert [event.type for event in sink.events["run-misnamed-output-before-providers"]] == [
        "run_started",
        "run_failed",
    ]
    assert sink.statuses["run-misnamed-output-before-providers"] == "failed"


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
