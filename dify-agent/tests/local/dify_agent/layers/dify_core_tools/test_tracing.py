"""Real Pydantic AI tool spans retain handled API failure status without failing the run."""

import json
from collections.abc import Iterator

import httpx
import logfire
import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode
from pydantic_ai import Agent
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from dify_agent.layers.dify_core_tools.layer import Config, Toolset
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.runtime.application_trace_exporter import _serialize_span
from dify_agent.runtime.context import Deps, Services
from dify_agent.runtime.observability import AgentObservability


@pytest.fixture
def observability(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[AgentObservability, InMemorySpanExporter]]:
    monkeypatch.setattr(Agent, "_instrument_default", False)
    exporter = InMemorySpanExporter()
    client = logfire.configure(
        local=True,
        send_to_logfire=False,
        console=False,
        metrics=False,
        inspect_arguments=False,
        additional_span_processors=[SimpleSpanProcessor(exporter)],
    )
    yield AgentObservability(client), exporter
    client.shutdown()


def tool_model(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
    returned = [
        part
        for message in messages
        if isinstance(message, ModelRequest)
        for part in message.parts
        if isinstance(part, ToolReturnPart)
    ]
    if not returned:
        return ModelResponse(parts=[ToolCallPart("calculate", {}, tool_call_id="owned-call")])
    return ModelResponse(parts=[TextPart(f"Handled: {returned[-1].content}")])


def dependencies(client: httpx.AsyncClient, *, missing_context: bool = False) -> Deps:
    config = Config(
        tools=[
            {
                "provider_type": "builtin",
                "provider_id": "code",
                "tool_name": "calculate",
                "parameters_json_schema": {"type": "object", "properties": {}},
            }
        ]
    )
    context = DifyExecutionContextLayerConfig(
        tenant_id="tenant",
        user_id=None if missing_context else "user",
        user_from="account",
        app_id="app",
        agent_mode="agent_app",
        invoke_from="web-app",
    )
    return Deps(
        layers={
            "core_tools": {"config": config.model_dump(mode="json"), "state": {}},
            "execution_context": {"config": context.model_dump(mode="json"), "state": {}},
        },
        services=Services(client, client, inner_api_key="synthetic-key"),
        run_id="test",
    )


@pytest.mark.anyio
@pytest.mark.parametrize("include_content", [False, True])
@pytest.mark.parametrize("failure", ["invocation", "timeout", "configuration"])
async def test_handled_failure_marks_only_its_native_tool_span(
    observability: tuple[AgentObservability, InMemorySpanExporter],
    include_content: bool,
    failure: str,
) -> None:
    telemetry, exporter = observability
    calls: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if failure == "timeout":
            raise httpx.ReadTimeout("private-transport-content", request=request)
        return httpx.Response(422, json={"code": "agent_tool_invoke_failed", "message": "private-error-content"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        agent = Agent(FunctionModel(tool_model), deps_type=Deps, toolsets=[Toolset("core_tools")])
        telemetry.instrument(agent, include_content=include_content)
        result = await agent.run("Call the tool", deps=dependencies(client, missing_context=failure == "configuration"))
    assert result.output.startswith("Handled:")
    if failure == "invocation":
        assert "tool invoke error: private-error-content" in result.output
    elif failure == "timeout":
        assert "temporarily unavailable" in result.output
    else:
        assert "required execution context is missing" in result.output
    assert len(calls) == (0 if failure == "configuration" else 1)
    telemetry.client.force_flush()
    spans = exporter.get_finished_spans()
    tools = [span for span in spans if (span.attributes or {}).get("gen_ai.operation.name") == "execute_tool"]
    roots = [span for span in spans if (span.attributes or {}).get("gen_ai.operation.name") == "invoke_agent"]
    assert len(tools) == 1
    assert len(roots) == 1
    assert tools[0].status.status_code is StatusCode.ERROR
    assert roots[0].status.status_code is not StatusCode.ERROR
    serialized = _serialize_span(tools[0])
    assert serialized.status == "error"
    assert serialized.status_message in {"DifyCoreToolsClientError", "DifyCoreToolsClientConfigurationError"}
    if not include_content:
        assert "private-error-content" not in json.dumps(
            [_serialize_span(span).model_dump(mode="json") for span in spans]
        )
    assert "private-transport-content" not in serialized.model_dump_json()


@pytest.mark.anyio
async def test_successful_observation_is_not_classified_by_its_text(
    observability: tuple[AgentObservability, InMemorySpanExporter],
) -> None:
    telemetry, exporter = observability
    observation = "tool invoke error timeout is only sample text in a successful result"
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={"observation": observation}))
    ) as client:
        agent = Agent(FunctionModel(tool_model), deps_type=Deps, toolsets=[Toolset("core_tools")])
        telemetry.instrument(agent)
        result = await agent.run("Call the tool", deps=dependencies(client))
    assert observation in result.output
    telemetry.client.force_flush()
    tool = next(
        span
        for span in exporter.get_finished_spans()
        if (span.attributes or {}).get("gen_ai.operation.name") == "execute_tool"
    )
    assert tool.status.status_code is not StatusCode.ERROR
    assert _serialize_span(tool).status == "ok"


@pytest.mark.anyio
@pytest.mark.parametrize(
    "attributes",
    [
        {"gen_ai.operation.name": "invoke_agent"},
        {"gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "calculate", "gen_ai.tool.call.id": "other-call"},
        {
            "gen_ai.operation.name": "execute_tool",
            "gen_ai.tool.name": "other-tool",
            "gen_ai.tool.call.id": "owned-call",
        },
    ],
)
async def test_uninstrumented_tool_failure_does_not_mark_an_unrelated_ambient_span(
    attributes: dict[str, str],
) -> None:
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    try:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(
                    422, json={"code": "agent_tool_invoke_failed", "message": "handled failure"}
                )
            )
        ) as client:
            agent = Agent(FunctionModel(tool_model), deps_type=Deps, toolsets=[Toolset("core_tools")])
            agent.instrument = False
            with provider.get_tracer("ambient").start_as_current_span("Ambient", attributes=attributes):
                result = await agent.run("Call the tool", deps=dependencies(client))
        assert "tool invoke error: handled failure" in result.output
        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].status.status_code is not StatusCode.ERROR
    finally:
        provider.shutdown()
