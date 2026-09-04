import asyncio
from collections.abc import AsyncIterator, Generator, Iterable, Mapping
from contextlib import contextmanager
from decimal import Decimal
from typing import Any, ClassVar, cast

import httpx
import pytest
from graphon.model_runtime.entities.llm_entities import LLMUsage
from pydantic import JsonValue
from pydantic_ai import Tool
from pydantic_ai.exceptions import ModelHTTPError, UnexpectedModelBehavior, UsageLimitExceeded
from pydantic_ai.messages import (
    ToolReturnPart,
    ModelMessage,
    ModelRequest,
    ModelResponse,
    SystemPromptPart,
    TextPart,
    ToolCallPart,
    UserPromptPart,
)
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel
from pydantic_ai.tools import DeferredToolRequests, DeferredToolResults
from pydantic_ai.usage import UsageLimits
from pydantic_ai.settings import ModelSettings
from pydantic_ai_harness.compaction import TieredCompaction

from agenton.compositor import CompositorSessionSnapshot, LayerProvider, LayerSessionSnapshot
from agenton.layers import ExitIntent, LifecycleState
from agenton_collections.layers.pydantic_ai import PYDANTIC_AI_HISTORY_LAYER_TYPE_ID, PydanticAIHistoryRuntimeState
from agenton_collections.layers.plain import PromptLayerConfig, ToolsLayer
from dify_agent.layers.ask_human import DIFY_ASK_HUMAN_LAYER_TYPE_ID, DifyAskHumanLayerConfig
from dify_agent.layers.execution_context import DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID, DifyExecutionContextLayerConfig
from dify_agent.layers.runtime import DIFY_RUNTIME_LAYER_TYPE_ID, DifyRuntimeLayerConfig
from dify_agent.layers.shell import DIFY_SHELL_LAYER_TYPE_ID, DifyShellLayerConfig
from dify_agent.layers.dify_plugin.configs import (
    DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID,
    DifyPluginLLMLayerConfig,
    DifyPluginToolConfig,
    DifyPluginToolParameter,
    DifyPluginToolParameterForm,
    DifyPluginToolParameterType,
    DifyPluginToolsLayerConfig,
)
from dify_agent.layers.dify_plugin.llm_layer import DifyPluginLLMLayer
from dify_agent.layers.dify_plugin.tools_layer import DifyPluginToolsLayer
from dify_agent.layers.dify_core_tools.configs import (
    DIFY_CORE_TOOLS_LAYER_TYPE_ID,
    DifyCoreToolConfig,
    DifyCoreToolsLayerConfig,
)
from dify_agent.layers.dify_core_tools.layer import DifyCoreToolsLayer
from dify_agent.layers.knowledge.client import DifyKnowledgeBaseClientError
from dify_agent.layers.knowledge.configs import DIFY_KNOWLEDGE_BASE_LAYER_TYPE_ID, DifyKnowledgeBaseLayerConfig
from dify_agent.layers.knowledge.layer import DifyKnowledgeBaseLayer
from dify_agent.layers.output import DIFY_OUTPUT_LAYER_TYPE_ID, DifyOutputLayerConfig
from dify_agent.protocol import DIFY_AGENT_HISTORY_LAYER_ID, DIFY_AGENT_MODEL_LAYER_ID, DIFY_AGENT_OUTPUT_LAYER_ID
from dify_agent.protocol.schemas import (
    CreateRunRequest,
    DeferredToolResultsPayload,
    LayerExitSignals,
    PydanticAIStreamRunEvent,
    RunComposition,
    RunFailedEvent,
    RunFailureType,
    RunLayerSpec,
    RunSucceededEvent,
)
from dify_agent.runtime.event_sink import InMemoryRunEventSink
from dify_agent.runtime.compositor_factory import create_default_layer_providers
from dify_agent.runtime.runner import (
    AgentRunRunner,
    AgentRunValidationError,
    RunSuccessOutcome,
    _run_failed_error_payload,
)
from dify_agent.runtime_backend import (
    ExecutionBindingAllocation,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotBackend,
    RuntimeBackendProfile,
    RuntimeLayout,
    RuntimeLease,
)
from dify_agent.runtime_backend.shellctl import ShellctlRuntimeLease, create_shellctl_lease
from shellctl.shared import DeleteJobResponse, JobResult, JobStatusName, JobStatusView


class StaticToolsTestLayer(ToolsLayer):
    type_id: ClassVar[str | None] = "test.static.tools"


class FakeRunnerShellctlClient:
    run_calls: list[tuple[str, str | None, Mapping[str, str] | None, float]]
    delete_calls: list[tuple[str, bool, float | None]]
    closed: bool

    def __init__(self) -> None:
        self.run_calls = []
        self.delete_calls = []
        self.closed = False

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: Mapping[str, str] | None = None,
        timeout: float = 10.0,
    ) -> JobResult:
        self.run_calls.append((script, cwd, env, timeout))
        return JobResult(
            job_id="mkdir-job",
            status=JobStatusName.EXITED,
            done=True,
            exit_code=0,
            output_path="/tmp/output.log",
            output="",
            offset=0,
            truncated=False,
        )

    async def close(self) -> None:
        self.closed = True

    async def wait(self, job_id: str, *, offset: int, timeout: float = 10.0) -> JobResult:
        del job_id, offset, timeout
        raise AssertionError("wait() should not be called in this test")

    async def input(self, job_id: str, text: str, *, offset: int, timeout: float = 10.0) -> JobResult:
        del job_id, text, offset, timeout
        raise AssertionError("input() should not be called in this test")

    async def terminate(self, job_id: str, grace_seconds: float = 2.0) -> JobStatusView:
        del job_id, grace_seconds
        raise AssertionError("terminate() should not be called in this test")

    async def delete(
        self,
        job_id: str,
        *,
        force: bool = False,
        grace_seconds: float | None = None,
    ) -> DeleteJobResponse:
        self.delete_calls.append((job_id, force, grace_seconds))
        return DeleteJobResponse(job_id=job_id)


class FakeRunnerExecutionBindingBackend:
    def __init__(self, client: FakeRunnerShellctlClient) -> None:
        self.client = client

    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation:
        return ExecutionBindingAllocation(binding_ref=spec.binding_id, workspace_ref=spec.workspace_id)

    async def acquire(self, binding_ref: str) -> RuntimeLease:
        return create_shellctl_lease(
            handle=binding_ref,
            layout=RuntimeLayout(
                home_dir="/home/agent-1",
                workspace_dir="/home/agent-1/workspace/abc12ff",
            ),
            entrypoint="http://shellctl",
            token="",
            client_factory=lambda: self.client,  # pyright: ignore[reportArgumentType]
        )

    async def release(self, lease: RuntimeLease) -> None:
        assert isinstance(lease, ShellctlRuntimeLease)
        await lease.close()

    async def destroy_binding(self, spec: ExecutionBindingDestroySpec) -> None:
        del spec


def test_run_failed_error_payload_preserves_plugin_rate_limit_error() -> None:
    exc = ModelHTTPError(
        429,
        "gpt-4o-mini",
        {"error_type": "InvokeRateLimitError", "message": "quota exceeded"},
    )

    message, error_type, reason = _run_failed_error_payload(exc)

    assert message == "quota exceeded"
    assert error_type is None
    assert reason == "InvokeRateLimitError"


def test_run_failed_error_payload_infers_rate_limit_reason_from_status_code() -> None:
    exc = ModelHTTPError(429, "gpt-4o-mini", {"message": "too many requests"})

    message, error_type, reason = _run_failed_error_payload(exc)

    assert message == "too many requests"
    assert error_type is None
    assert reason == "InvokeRateLimitError"


def test_run_failed_error_payload_preserves_knowledge_error_code() -> None:
    exc = DifyKnowledgeBaseClientError(
        "Knowledge base search failed with HTTP 400 (dataset_not_found): Dataset not found",
        status_code=400,
        error_code="dataset_not_found",
        retryable=False,
    )

    message, error_type, reason = _run_failed_error_payload(exc)

    assert message == "Knowledge base search failed with HTTP 400 (dataset_not_found): Dataset not found"
    assert error_type is None
    assert reason == "dataset_not_found"


def test_run_failed_error_payload_classifies_usage_limit() -> None:
    exc = UsageLimitExceeded("The next request would exceed the request_limit of 500")

    message, error_type, reason = _run_failed_error_payload(exc)

    assert message.startswith("The next request would exceed the request_limit of 500")
    assert error_type is RunFailureType.AGENT_RUN_LIMIT_EXCEEDED
    assert reason is None


def test_cancelled_runner_does_not_emit_late_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def scenario() -> None:
        sink = InMemoryRunEventSink()
        cancelled = False
        async with httpx.AsyncClient() as client:
            runner = AgentRunRunner(
                sink=sink,
                request=_request(),
                run_id="run-cancelled",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                is_cancelled=lambda: cancelled,
            )

            async def fail_after_cancel() -> RunSuccessOutcome:
                nonlocal cancelled
                cancelled = True
                raise RuntimeError("late model failure")

            monkeypatch.setattr(runner, "_run_agent", fail_after_cancel)
            await runner.run()

        assert "run-cancelled" not in sink.statuses
        assert [event.type for event in sink.events["run-cancelled"]] == ["run_started"]

    asyncio.run(scenario())


def _request(
    user: str | list[str] = "hello",
    *,
    include_history: bool = False,
    include_ask_human: bool = False,
    ask_human_config: DifyAskHumanLayerConfig | None = None,
    llm_layer_name: str = DIFY_AGENT_MODEL_LAYER_ID,
    execution_context_layer_name: str = "execution_context",
    on_exit: LayerExitSignals | None = None,
    output_config: Mapping[str, object] | DifyOutputLayerConfig | None = None,
    model_settings: ModelSettings | None = None,
    context_window_tokens: int | None = None,
) -> CreateRunRequest:
    layers = [
        RunLayerSpec(
            name="prompt",
            type="plain.prompt",
            config=PromptLayerConfig(prefix="system", user=user),
        ),
        *(
            [RunLayerSpec(name=DIFY_AGENT_HISTORY_LAYER_ID, type=PYDANTIC_AI_HISTORY_LAYER_TYPE_ID)]
            if include_history
            else []
        ),
        *(
            [
                RunLayerSpec(
                    name="ask_human",
                    type=DIFY_ASK_HUMAN_LAYER_TYPE_ID,
                    config=ask_human_config or DifyAskHumanLayerConfig(),
                )
            ]
            if include_ask_human
            else []
        ),
        RunLayerSpec(
            name=execution_context_layer_name,
            type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
            config=DifyExecutionContextLayerConfig(
                tenant_id="tenant-1",
                user_from="account",
                agent_mode="workflow_run",
                invoke_from="service-api",
            ),
        ),
        RunLayerSpec(
            name=llm_layer_name,
            type="dify.plugin.llm",
            deps={"execution_context": execution_context_layer_name},
            config=DifyPluginLLMLayerConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="demo-model",
                model_settings=model_settings,
                context_window_tokens=context_window_tokens,
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


def _request_with_shell() -> CreateRunRequest:
    request = _request()
    request.composition.layers[-1:-1] = [
        RunLayerSpec(
            name="runtime",
            type=DIFY_RUNTIME_LAYER_TYPE_ID,
            config=DifyRuntimeLayerConfig(backend_binding_ref="binding-1"),
        ),
        RunLayerSpec(
            name="shell",
            type=DIFY_SHELL_LAYER_TYPE_ID,
            deps={"execution_context": "execution_context", "runtime": "runtime"},
            config=DifyShellLayerConfig(),
        ),
    ]
    return request


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


def _prepared_plugin_tool_parameters() -> list[DifyPluginToolParameter]:
    return [
        DifyPluginToolParameter(
            name="query",
            type=DifyPluginToolParameterType.STRING,
            form=DifyPluginToolParameterForm.LLM,
            required=True,
            llm_description="Search query",
        ),
        DifyPluginToolParameter(
            name="auth_scope",
            type=DifyPluginToolParameterType.STRING,
            form=DifyPluginToolParameterForm.FORM,
            required=True,
            llm_description="Hidden auth scope",
        ),
    ]


def _prepared_plugin_tool_schema() -> dict[str, JsonValue]:
    return {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query"},
        },
        "required": ["query"],
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


class RecordingTestModel(TestModel):
    seen_requests: list[list[ModelMessage]]
    seen_instructions: list[list[str]]
    failure: Exception | None

    def __init__(self, *, custom_output_text: str = "done", failure: Exception | None = None) -> None:
        super().__init__(call_tools=[], custom_output_text=custom_output_text)
        self.seen_requests = []
        self.seen_instructions = []
        self.failure = failure

    def _request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        self.seen_requests.append(list(messages))
        self.seen_instructions.append([part.content for part in model_request_parameters.instruction_parts or []])
        if self.failure is not None:
            raise self.failure
        return super()._request(messages, model_settings, model_request_parameters)


def _history_session_snapshot(
    messages: list[ModelMessage],
    *,
    include_ask_human: bool = False,
    include_output: bool = False,
) -> CompositorSessionSnapshot:
    layers = [
        LayerSessionSnapshot(name="prompt", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}),
        LayerSessionSnapshot(
            name=DIFY_AGENT_HISTORY_LAYER_ID,
            lifecycle_state=LifecycleState.SUSPENDED,
            runtime_state=PydanticAIHistoryRuntimeState(messages=messages).model_dump(mode="json"),
        ),
        *(
            [LayerSessionSnapshot(name="ask_human", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={})]
            if include_ask_human
            else []
        ),
        LayerSessionSnapshot(name="execution_context", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}),
        LayerSessionSnapshot(
            name=DIFY_AGENT_MODEL_LAYER_ID, lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}
        ),
    ]
    if include_output:
        layers.append(
            LayerSessionSnapshot(
                name=DIFY_AGENT_OUTPUT_LAYER_ID, lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}
            )
        )
    return CompositorSessionSnapshot(layers=layers)


def _history_messages_from_snapshot(snapshot: CompositorSessionSnapshot) -> list[ModelMessage]:
    history_snapshot = next(layer for layer in snapshot.layers if layer.name == DIFY_AGENT_HISTORY_LAYER_ID)
    return PydanticAIHistoryRuntimeState.model_validate(history_snapshot.runtime_state).messages


def _flatten_message_parts(messages: list[ModelMessage]) -> list[object]:
    return [part for message in messages for part in message.parts]


def _assert_interrupted_history(
    snapshot: CompositorSessionSnapshot,
    stored_history: list[ModelMessage],
) -> None:
    saved_history = _history_messages_from_snapshot(snapshot)

    assert saved_history[: len(stored_history)] == stored_history
    assert len(saved_history) == len(stored_history) + 2
    current_request = saved_history[-2]
    assert isinstance(current_request, ModelRequest)
    assert current_request.instructions is None
    assert len(current_request.parts) == 1
    assert isinstance(current_request.parts[0], UserPromptPart)
    assert current_request.parts[0].content == "current user"
    partial_response = saved_history[-1]
    assert isinstance(partial_response, ModelResponse)
    assert partial_response.state == "interrupted"
    assert len(partial_response.parts) == 1
    assert isinstance(partial_response.parts[0], TextPart)
    assert partial_response.parts[0].content == "partial"


def _install_fake_message_capture(monkeypatch: pytest.MonkeyPatch) -> list[ModelMessage]:
    captured_messages: list[ModelMessage] = []

    @contextmanager
    def fake_capture_run_messages() -> Generator[list[ModelMessage]]:
        captured_messages.clear()
        yield captured_messages

    monkeypatch.setattr("dify_agent.runtime.runner.capture_run_messages", fake_capture_run_messages)
    return captured_messages


class FakeAgentRunResult:
    output: object

    def __init__(self, output: object) -> None:
        self.output = output


def test_runner_emits_terminal_success_and_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    seen_clients: list[httpx.AsyncClient] = []

    def fake_get_model(self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert self.config.model == "demo-model"
        assert self.config.plugin_id == "langgenius/openai"
        seen_clients.append(http_client)
        return TestModel(custom_output_text="done")  # pyright: ignore[reportReturnType]

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    request = _request(execution_context_layer_name="renamed-execution-context")
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=request,
                run_id="run-1",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
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
    pydantic_events = [event for event in sink.events["run-1"] if isinstance(event, PydanticAIStreamRunEvent)]
    assert "".join(event.agent_message_delta or "" for event in pydantic_events) == "done"
    terminal = sink.events["run-1"][-1]
    assert isinstance(terminal, RunSucceededEvent)
    assert terminal.data.output == "done"
    assert terminal.data.usage is not None
    assert terminal.data.usage.total_tokens > 0
    assert [layer.name for layer in terminal.data.session_snapshot.layers] == [
        "prompt",
        "renamed-execution-context",
        DIFY_AGENT_MODEL_LAYER_ID,
    ]
    assert [layer.lifecycle_state for layer in terminal.data.session_snapshot.layers] == [
        LifecycleState.SUSPENDED,
        LifecycleState.SUSPENDED,
        LifecycleState.SUSPENDED,
    ]
    assert sink.statuses["run-1"] == "succeeded"


def test_runner_emits_complete_plugin_usage_in_terminal_event(monkeypatch: pytest.MonkeyPatch) -> None:
    complete_usage = LLMUsage(
        prompt_tokens=10,
        prompt_unit_price=Decimal("5"),
        prompt_price_unit=Decimal("0.000001"),
        prompt_price=Decimal("0.000050"),
        completion_tokens=2,
        completion_unit_price=Decimal("30"),
        completion_price_unit=Decimal("0.000001"),
        completion_price=Decimal("0.000060"),
        total_tokens=12,
        total_price=Decimal("0.000110"),
        currency="USD",
        latency=0.4,
        time_to_first_token=0.1,
        time_to_generate=0.3,
    )

    class PricedTestModel(TestModel):
        @property
        def accumulated_usage(self) -> LLMUsage:
            return complete_usage

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return PricedTestModel(custom_output_text="done")  # pyright: ignore[reportReturnType]

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=_request(),
                run_id="run-priced",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
            ).run()

    asyncio.run(scenario())

    terminal = sink.events["run-priced"][-1]
    assert isinstance(terminal, RunSucceededEvent)
    assert terminal.data.usage is not None
    assert terminal.data.usage.prompt_unit_price == Decimal("5")
    assert terminal.data.usage.prompt_price == Decimal("0.000050")
    assert terminal.data.usage.completion_unit_price == Decimal("30")
    assert terminal.data.usage.completion_price == Decimal("0.000060")
    assert terminal.data.usage.total_price == Decimal("0.000110")
    assert terminal.data.usage.currency == "USD"
    assert terminal.data.usage.latency == 0.4
    assert terminal.data.usage.time_to_first_token == 0.1
    assert terminal.data.usage.time_to_generate == 0.3


def test_runner_preserves_explicit_json_null_output(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="unused")  # pyright: ignore[reportReturnType]

    class FakeAgent:
        async def run(self, *_args: object, **_kwargs: object) -> FakeAgentRunResult:
            return FakeAgentRunResult(None)

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", lambda *_args, **_kwargs: FakeAgent())
    request = _request()
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=request,
                run_id="run-null-output",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
            ).run()

    asyncio.run(scenario())

    terminal = sink.events["run-null-output"][-1]
    assert isinstance(terminal, RunSucceededEvent)
    assert terminal.data.output is None
    assert terminal.data.deferred_tool_call is None
    assert sink.statuses["run-null-output"] == "succeeded"


def test_runner_passes_explicit_step_limit_to_agent(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="unused")  # pyright: ignore[reportReturnType]

    class FakeAgent:
        async def run(self, *_args: object, **kwargs: object) -> FakeAgentRunResult:
            usage_limits = cast(UsageLimits, kwargs["usage_limits"])
            assert usage_limits.request_limit == 500
            return FakeAgentRunResult("done")

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", lambda *_args, **_kwargs: FakeAgent())
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=_request(),
                run_id="run-explicit-step-limit",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
            ).run()

    asyncio.run(scenario())

    assert sink.statuses["run-explicit-step-limit"] == "succeeded"


def test_runner_passes_context_compaction(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="unused")  # pyright: ignore[reportReturnType]

    class FakeAgent:
        async def run(self, *_args: object, **kwargs: object) -> FakeAgentRunResult:
            capabilities = cast(list[object], kwargs["capabilities"])
            assert len(capabilities) == 1
            capability = capabilities[0]
            assert isinstance(capability, TieredCompaction)
            assert capability.target_tokens == 7_000
            return FakeAgentRunResult("done")

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", lambda *_args, **_kwargs: FakeAgent())
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=_request(
                    model_settings={"max_tokens": 3_000},
                    context_window_tokens=10_000,
                ),
                run_id="run-compaction",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
            ).run()

    asyncio.run(scenario())

    assert sink.statuses["run-compaction"] == "succeeded"


def test_runner_rejects_compaction_budget_before_model_resolution_or_invocation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model_resolution_called = False
    agent_creation_called = False
    model_invocation_called = False

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        nonlocal model_resolution_called
        model_resolution_called = True
        return TestModel(custom_output_text="unused")  # pyright: ignore[reportReturnType]

    class FakeAgent:
        async def run(self, *_args: object, **_kwargs: object) -> FakeAgentRunResult:
            nonlocal model_invocation_called
            model_invocation_called = True
            return FakeAgentRunResult("unused")

    def fake_create_agent(*_args: object, **_kwargs: object) -> FakeAgent:
        nonlocal agent_creation_called
        agent_creation_called = True
        return FakeAgent()

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", fake_create_agent)
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(
                AgentRunValidationError,
                match="Model max_tokens must leave a positive input context budget",
            ):
                await AgentRunRunner(
                    sink=sink,
                    request=_request(
                        model_settings={"max_tokens": 1_000},
                        context_window_tokens=1_000,
                    ),
                    run_id="run-invalid-compaction-budget",
                    plugin_daemon_http_client=client,
                    dify_api_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert model_resolution_called is False
    assert agent_creation_called is False
    assert model_invocation_called is False
    assert [event.type for event in sink.events["run-invalid-compaction-budget"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-invalid-compaction-budget"] == "failed"


def test_runner_timeout_excludes_tool_preparation_and_runtime_cleanup(monkeypatch: pytest.MonkeyPatch) -> None:
    shell_client = FakeRunnerShellctlClient()
    tools_prepared = False

    class SlowLifecycleBackend(FakeRunnerExecutionBindingBackend):
        acquired: bool = False
        released: bool = False

        async def acquire(self, binding_ref: str) -> RuntimeLease:
            await asyncio.sleep(0.01)
            lease = await super().acquire(binding_ref)
            self.acquired = True
            return lease

        async def release(self, lease: RuntimeLease) -> None:
            await asyncio.sleep(0.01)
            await super().release(lease)
            self.released = True

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        assert agent_run_id == "run-lifecycle-outside-timeout"
        return TestModel(custom_output_text="unused")  # pyright: ignore[reportReturnType]

    class ImmediateAgent:
        async def run(self, *_args: object, **_kwargs: object) -> FakeAgentRunResult:
            return FakeAgentRunResult("done")

    async def slow_resolve_run_tools(
        _run: object,
        *,
        plugin_daemon_http_client: httpx.AsyncClient,
        dify_api_http_client: httpx.AsyncClient,
    ) -> list[Tool[object]]:
        nonlocal tools_prepared
        assert plugin_daemon_http_client.is_closed is False
        assert dify_api_http_client.is_closed is False
        await asyncio.sleep(0.01)
        tools_prepared = True
        return []

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", lambda *_args, **_kwargs: ImmediateAgent())
    monkeypatch.setattr("dify_agent.runtime.runner._resolve_run_tools", slow_resolve_run_tools)
    backend = SlowLifecycleBackend(shell_client)
    runtime_backend_profile = RuntimeBackendProfile(
        home_snapshots=cast(HomeSnapshotBackend, object()),
        execution_bindings=backend,
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=_request_with_shell(),
                run_id="run-lifecycle-outside-timeout",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
                layer_providers=create_default_layer_providers(runtime_backend_profile=runtime_backend_profile),
                run_timeout_seconds=0.001,
            ).run()

    asyncio.run(scenario())

    assert sink.statuses["run-lifecycle-outside-timeout"] == "succeeded"
    assert tools_prepared is True
    assert backend.acquired is True
    assert backend.released is True
    assert shell_client.closed is True


def test_runner_timeout_cancels_agent_and_releases_runtime_lease(monkeypatch: pytest.MonkeyPatch) -> None:
    agent_cancelled = False
    shell_client = FakeRunnerShellctlClient()

    class FakeUsageModel(TestModel):
        @property
        def accumulated_usage(self) -> LLMUsage:
            return LLMUsage.from_metadata(
                {
                    "prompt_tokens": 13,
                    "completion_tokens": 8,
                    "total_tokens": 21,
                    "total_price": "0.000210",
                    "currency": "USD",
                }
            )

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        assert agent_run_id == "run-timeout"
        return FakeUsageModel(custom_output_text="unused")  # pyright: ignore[reportReturnType]

    class FakeAgent:
        async def run(self, *_args: object, **_kwargs: object) -> None:
            nonlocal agent_cancelled
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                agent_cancelled = True
                raise

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", lambda *_args, **_kwargs: FakeAgent())
    runtime_backend_profile = RuntimeBackendProfile(
        home_snapshots=cast(HomeSnapshotBackend, object()),
        execution_bindings=FakeRunnerExecutionBindingBackend(shell_client),
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(UsageLimitExceeded, match="0.01 seconds"):
                await AgentRunRunner(
                    sink=sink,
                    request=_request_with_shell(),
                    run_id="run-timeout",
                    plugin_daemon_http_client=client,
                    dify_api_http_client=client,
                    layer_providers=create_default_layer_providers(runtime_backend_profile=runtime_backend_profile),
                    run_timeout_seconds=0.01,
                ).run()

    asyncio.run(scenario())

    terminal = sink.events["run-timeout"][-1]
    assert isinstance(terminal, RunFailedEvent)
    assert terminal.data.error_type is RunFailureType.AGENT_RUN_LIMIT_EXCEEDED
    assert terminal.data.usage is not None
    assert terminal.data.usage.prompt_tokens == 13
    assert terminal.data.usage.completion_tokens == 8
    assert terminal.data.usage.total_tokens == 21
    assert terminal.data.usage.total_price == Decimal("0.000210")
    assert sink.statuses["run-timeout"] == "failed"
    assert agent_cancelled is True
    assert shell_client.closed is True


def test_runner_does_not_classify_nested_timeout_as_agent_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        assert agent_run_id == "run-provider-timeout"
        return TestModel(custom_output_text="unused")  # pyright: ignore[reportReturnType]

    class FakeAgent:
        async def run(self, *_args: object, **_kwargs: object) -> FakeAgentRunResult:
            raise TimeoutError("provider timed out")

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", lambda *_args, **_kwargs: FakeAgent())
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(TimeoutError, match="provider timed out"):
                await AgentRunRunner(
                    sink=sink,
                    request=_request(),
                    run_id="run-provider-timeout",
                    plugin_daemon_http_client=client,
                    dify_api_http_client=client,
                    run_timeout_seconds=1,
                ).run()

    asyncio.run(scenario())

    terminal = sink.events["run-provider-timeout"][-1]
    assert isinstance(terminal, RunFailedEvent)
    assert terminal.data.error == "provider timed out"
    assert terminal.data.error_type is None
    assert sink.statuses["run-provider-timeout"] == "failed"


def test_runner_captures_interrupted_history_when_task_is_cancelled(monkeypatch: pytest.MonkeyPatch) -> None:
    partial_streamed = asyncio.Event()
    stored_history = [
        ModelRequest(parts=[UserPromptPart(content="old user")]),
        ModelResponse(parts=[TextPart(content="old assistant")]),
    ]

    async def stream_response(_messages: list[ModelMessage], _info: object) -> AsyncIterator[str]:
        yield "partial"
        _ = partial_streamed.set()
        await asyncio.Event().wait()

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        return FunctionModel(stream_function=stream_response)

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    request = _request("current user", include_history=True)
    request.session_snapshot = _history_session_snapshot(stored_history)
    sink = InMemoryRunEventSink()

    async def scenario() -> AgentRunRunner:
        async with httpx.AsyncClient() as client:
            runner = AgentRunRunner(
                sink=sink,
                request=request,
                run_id="run-cancel-history",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
            )
            task = asyncio.create_task(runner.run())
            await asyncio.wait_for(partial_streamed.wait(), timeout=1)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            return runner

    runner = asyncio.run(scenario())

    assert runner.terminal_session_snapshot is not None
    assert all(layer.lifecycle_state is LifecycleState.SUSPENDED for layer in runner.terminal_session_snapshot.layers)
    _assert_interrupted_history(runner.terminal_session_snapshot, stored_history)


def test_runner_emits_deferred_tool_call_and_persists_pending_history(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_output_types: list[object] = []
    captured_user_prompts: list[object] = []
    captured_messages = _install_fake_message_capture(monkeypatch)
    pending_tool_call = ToolCallPart(
        tool_name="ask_human",
        args={
            "question": "Which deployment window should we use?",
            "fields": [{"type": "paragraph", "name": "window", "label": "Deployment window"}],
        },
        tool_call_id="tool-call-1",
    )

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="unused")  # pyright: ignore[reportReturnType]

    class FakeAgent:
        async def run(self, user_prompt: object, **kwargs: object) -> FakeAgentRunResult:
            captured_user_prompts.append(user_prompt)
            assert kwargs["deferred_tool_results"] is None
            messages: list[ModelMessage] = [
                ModelRequest(parts=[UserPromptPart(content="current user")]),
                ModelResponse(parts=[pending_tool_call]),
            ]
            captured_messages.extend(messages)
            return FakeAgentRunResult(DeferredToolRequests(calls=[pending_tool_call]))

    def fake_create_agent(model: object, *, tools: list[Tool[object]], output_type: object) -> FakeAgent:
        del model, tools
        captured_output_types.append(output_type)
        return FakeAgent()

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", fake_create_agent)
    request = _request("current user", include_history=True, include_ask_human=True)
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=request,
                run_id="run-ask-human",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
            ).run()

    asyncio.run(scenario())

    terminal = sink.events["run-ask-human"][-1]
    assert isinstance(terminal, RunSucceededEvent)
    assert captured_user_prompts == ["current user"]
    assert any(item is DeferredToolRequests for item in cast(Iterable[object], captured_output_types[0]))
    assert terminal.data.output is None
    assert terminal.data.deferred_tool_call is not None
    assert terminal.data.deferred_tool_call.tool_call_id == "tool-call-1"
    assert terminal.data.deferred_tool_call.tool_name == "ask_human"
    assert terminal.data.deferred_tool_call.args == {
        "title": None,
        "question": "Which deployment window should we use?",
        "markdown": None,
        "fields": [
            {
                "type": "paragraph",
                "name": "window",
                "label": "Deployment window",
                "required": False,
                "placeholder": None,
                "default": None,
            }
        ],
        "actions": [{"id": "submit", "label": "Submit", "style": "primary"}],
        "urgency": "normal",
    }
    saved_history = _history_messages_from_snapshot(terminal.data.session_snapshot)
    assert isinstance(saved_history[-1], ModelResponse)
    assert saved_history[-1].parts == [pending_tool_call]


def test_runner_resumes_with_deferred_tool_results_and_no_user_prompt(monkeypatch: pytest.MonkeyPatch) -> None:
    seen_user_prompts: list[object] = []
    seen_deferred_results: list[object] = []
    captured_messages = _install_fake_message_capture(monkeypatch)
    pending_tool_call = ToolCallPart(
        tool_name="ask_human",
        args={"question": "Need approval"},
        tool_call_id="tool-call-1",
    )

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="unused")  # pyright: ignore[reportReturnType]

    class FakeAgent:
        async def run(self, user_prompt: object, **kwargs: object) -> FakeAgentRunResult:
            seen_user_prompts.append(user_prompt)
            seen_deferred_results.append(kwargs.get("deferred_tool_results"))
            if kwargs.get("deferred_tool_results") is None:
                messages: list[ModelMessage] = [
                    ModelRequest(parts=[UserPromptPart(content="current user")]),
                    ModelResponse(parts=[pending_tool_call]),
                ]
                captured_messages.extend(messages)
                return FakeAgentRunResult(DeferredToolRequests(calls=[pending_tool_call]))

            deferred_tool_results = cast(DeferredToolResults, kwargs["deferred_tool_results"])
            assert deferred_tool_results is not None
            submitted_result = cast(dict[str, object], deferred_tool_results.calls["tool-call-1"])
            assert submitted_result["status"] == "submitted"
            message_history = cast(list[ModelMessage], kwargs["message_history"])
            messages = [
                *message_history,
                ModelRequest(
                    parts=[
                        ToolReturnPart(
                            tool_name="ask_human",
                            content={"status": "submitted", "values": {"comment": "Ship it"}},
                            tool_call_id="tool-call-1",
                        )
                    ]
                ),
                ModelResponse(parts=[TextPart(content="done after human")]),
            ]
            captured_messages.extend(messages)
            return FakeAgentRunResult("done after human")

    def fake_create_agent(model: object, *, tools: list[Tool[object]], output_type: object) -> FakeAgent:
        del model, tools, output_type
        return FakeAgent()

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", fake_create_agent)
    request = _request("current user", include_history=True, include_ask_human=True)
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=request,
                run_id="run-ask-human-initial",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
            ).run()

            initial_terminal = sink.events["run-ask-human-initial"][-1]
            assert isinstance(initial_terminal, RunSucceededEvent)

            resumed_request = request.model_copy(deep=True)
            resumed_request.session_snapshot = initial_terminal.data.session_snapshot
            resumed_request.deferred_tool_results = DeferredToolResultsPayload.model_validate(
                {
                    "calls": {
                        "tool-call-1": {
                            "status": "submitted",
                            "action": {"id": "submit", "label": "Submit"},
                            "values": {"comment": "Ship it"},
                        }
                    }
                }
            )

            await AgentRunRunner(
                sink=sink,
                request=resumed_request,
                run_id="run-ask-human-resume",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
            ).run()

    asyncio.run(scenario())

    resumed_terminal = sink.events["run-ask-human-resume"][-1]
    assert isinstance(resumed_terminal, RunSucceededEvent)
    assert resumed_terminal.data.output == "done after human"
    assert resumed_terminal.data.deferred_tool_call is None
    assert seen_user_prompts == ["current user", None]
    assert seen_deferred_results[0] is None
    assert seen_deferred_results[1] is not None


def test_runner_can_emit_second_deferred_tool_call_after_resume(monkeypatch: pytest.MonkeyPatch) -> None:
    seen_user_prompts: list[object] = []
    captured_messages = _install_fake_message_capture(monkeypatch)
    first_pending_tool_call = ToolCallPart(
        tool_name="ask_human",
        args={"question": "Need deployment owner"},
        tool_call_id="tool-call-1",
    )
    second_pending_tool_call = ToolCallPart(
        tool_name="ask_human",
        args={"question": "Need final go-live confirmation"},
        tool_call_id="tool-call-2",
    )

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="unused")  # pyright: ignore[reportReturnType]

    class FakeAgent:
        async def run(self, user_prompt: object, **kwargs: object) -> FakeAgentRunResult:
            seen_user_prompts.append(user_prompt)
            deferred_tool_results = kwargs.get("deferred_tool_results")
            if deferred_tool_results is None:
                messages: list[ModelMessage] = [
                    ModelRequest(parts=[UserPromptPart(content="current user")]),
                    ModelResponse(parts=[first_pending_tool_call]),
                ]
                captured_messages.extend(messages)
                return FakeAgentRunResult(DeferredToolRequests(calls=[first_pending_tool_call]))

            message_history = cast(list[ModelMessage], kwargs["message_history"])
            messages = [
                *message_history,
                ModelRequest(
                    parts=[
                        ToolReturnPart(
                            tool_name="ask_human",
                            content={"status": "submitted", "values": {"owner": "ops"}},
                            tool_call_id="tool-call-1",
                        )
                    ]
                ),
                ModelResponse(parts=[second_pending_tool_call]),
            ]
            captured_messages.extend(messages)
            return FakeAgentRunResult(DeferredToolRequests(calls=[second_pending_tool_call]))

    def fake_create_agent(model: object, *, tools: list[Tool[object]], output_type: object) -> FakeAgent:
        del model, tools, output_type
        return FakeAgent()

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", fake_create_agent)
    request = _request("current user", include_history=True, include_ask_human=True)
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=request,
                run_id="run-ask-human-turn-1",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
            ).run()

            first_terminal = sink.events["run-ask-human-turn-1"][-1]
            assert isinstance(first_terminal, RunSucceededEvent)

            resumed_request = request.model_copy(deep=True)
            resumed_request.session_snapshot = first_terminal.data.session_snapshot
            resumed_request.deferred_tool_results = DeferredToolResultsPayload.model_validate(
                {
                    "calls": {
                        "tool-call-1": {
                            "status": "submitted",
                            "action": {"id": "submit", "label": "Submit"},
                            "values": {"owner": "ops"},
                        }
                    }
                }
            )

            await AgentRunRunner(
                sink=sink,
                request=resumed_request,
                run_id="run-ask-human-turn-2",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
            ).run()

    asyncio.run(scenario())

    second_terminal = sink.events["run-ask-human-turn-2"][-1]
    assert isinstance(second_terminal, RunSucceededEvent)
    assert second_terminal.data.output is None
    assert second_terminal.data.deferred_tool_call is not None
    assert second_terminal.data.deferred_tool_call.tool_call_id == "tool-call-2"
    assert seen_user_prompts == ["current user", None]
    saved_history = _history_messages_from_snapshot(second_terminal.data.session_snapshot)
    assert isinstance(saved_history[1], ModelResponse)
    assert saved_history[1].parts == [first_pending_tool_call]
    assert isinstance(saved_history[2], ModelRequest)
    assert len(saved_history[2].parts) == 1
    assert isinstance(saved_history[2].parts[0], ToolReturnPart)
    assert saved_history[2].parts[0].tool_name == "ask_human"
    assert saved_history[2].parts[0].tool_call_id == "tool-call-1"
    assert saved_history[2].parts[0].content == {"status": "submitted", "values": {"owner": "ops"}}
    assert isinstance(saved_history[3], ModelResponse)
    assert saved_history[3].parts == [second_pending_tool_call]


def test_runner_rejects_deferred_tool_call_without_history_layer(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="unused")  # pyright: ignore[reportReturnType]

    class FakeAgent:
        async def run(self, *_args: object, **_kwargs: object) -> FakeAgentRunResult:
            return FakeAgentRunResult(
                DeferredToolRequests(
                    calls=[
                        ToolCallPart(tool_name="ask_human", args={"question": "Need owner"}, tool_call_id="tool-call-1")
                    ]
                )
            )

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", lambda *args, **kwargs: FakeAgent())
    request = _request("current user", include_history=False, include_ask_human=True)
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(
                AgentRunValidationError,
                match="ask_human deferred tool requests require a 'history' layer so the pending tool call can be resumed",
            ):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-ask-human-no-history",
                    plugin_daemon_http_client=client,
                    dify_api_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert [event.type for event in sink.events["run-ask-human-no-history"]] == ["run_started", "run_failed"]


def test_runner_rejects_resume_with_deferred_tool_results_without_history_layer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent_run_called = False

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="unused")  # pyright: ignore[reportReturnType]

    class FakeAgent:
        async def run(self, *_args: object, **_kwargs: object) -> FakeAgentRunResult:
            nonlocal agent_run_called
            agent_run_called = True
            return FakeAgentRunResult("unexpected")

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", lambda *args, **kwargs: FakeAgent())
    request = _request("current user", include_history=False, include_ask_human=True)
    request.deferred_tool_results = DeferredToolResultsPayload.model_validate(
        {
            "calls": {
                "tool-call-1": {
                    "status": "submitted",
                    "action": {"id": "submit", "label": "Submit"},
                    "values": {"owner": "ops"},
                }
            }
        }
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(
                AgentRunValidationError,
                match="Deferred tool results require a 'history' layer with prior message history",
            ):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-ask-human-resume-no-history",
                    plugin_daemon_http_client=client,
                    dify_api_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert agent_run_called is False
    assert [event.type for event in sink.events["run-ask-human-resume-no-history"]] == ["run_started", "run_failed"]


def test_runner_rejects_multiple_deferred_tool_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="unused")  # pyright: ignore[reportReturnType]

    class FakeAgent:
        async def run(self, *_args: object, **_kwargs: object) -> FakeAgentRunResult:
            return FakeAgentRunResult(
                DeferredToolRequests(
                    calls=[
                        ToolCallPart(tool_name="ask_human", args={"question": "One"}, tool_call_id="tool-call-1"),
                        ToolCallPart(tool_name="ask_human", args={"question": "Two"}, tool_call_id="tool-call-2"),
                    ]
                )
            )

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", lambda *args, **kwargs: FakeAgent())
    request = _request("current user", include_history=True, include_ask_human=True)
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(ValueError, match="supports exactly one deferred call per run"):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-ask-human-multi",
                    plugin_daemon_http_client=client,
                    dify_api_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert [event.type for event in sink.events["run-ask-human-multi"]] == ["run_started", "run_failed"]


def test_runner_rejects_deferred_approval_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="unused")  # pyright: ignore[reportReturnType]

    class FakeAgent:
        async def run(self, *_args: object, **_kwargs: object) -> FakeAgentRunResult:
            return FakeAgentRunResult(
                DeferredToolRequests(
                    approvals=[
                        ToolCallPart(
                            tool_name="ask_human", args={"question": "Need approval"}, tool_call_id="tool-call-1"
                        )
                    ]
                )
            )

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", lambda *args, **kwargs: FakeAgent())
    request = _request("current user", include_history=True, include_ask_human=True)
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(ValueError, match="does not support approval requests"):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-ask-human-approval",
                    plugin_daemon_http_client=client,
                    dify_api_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert [event.type for event in sink.events["run-ask-human-approval"]] == ["run_started", "run_failed"]


def test_runner_passes_dynamic_dify_plugin_tools_to_agent(monkeypatch: pytest.MonkeyPatch) -> None:
    seen_tools: list[Tool[object]] = []

    async def plugin_tool() -> str:
        return "tool"

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="done")  # pyright: ignore[reportReturnType]

    async def fake_get_tools(
        self: DifyPluginToolsLayer,
        *,
        http_client: httpx.AsyncClient,
        dify_api_http_client: httpx.AsyncClient,
    ) -> list[Tool[object]]:
        assert self.config.tools[0].tool_name == "web_search"
        assert http_client.is_closed is False
        assert dify_api_http_client.is_closed is False
        return [Tool(plugin_tool, name="web_search")]

    class FakeResult:
        output: str = "done"

    class FakeAgent:
        async def run(self, *_args: object, **_kwargs: object) -> FakeResult:
            return FakeResult()

    def fake_create_agent(model: object, *, tools: list[Tool[object]], output_type: object) -> FakeAgent:
        del model, output_type
        seen_tools.extend(tools)
        return FakeAgent()

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr(DifyPluginToolsLayer, "get_tools", fake_get_tools)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", fake_create_agent)

    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="prompt",
                    type="plain.prompt",
                    config=PromptLayerConfig(prefix="system", user="hello"),
                ),
                RunLayerSpec(
                    name="execution_context",
                    type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                    config=DifyExecutionContextLayerConfig(
                        tenant_id="tenant-1",
                        user_from="account",
                        agent_mode="workflow_run",
                        invoke_from="service-api",
                    ),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type="dify.plugin.llm",
                    deps={"execution_context": "execution_context"},
                    config=DifyPluginLLMLayerConfig(
                        plugin_id="langgenius/openai",
                        model_provider="openai",
                        model="demo-model",
                    ),
                ),
                RunLayerSpec(
                    name="tools",
                    type=DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID,
                    deps={"execution_context": "execution_context"},
                    config=DifyPluginToolsLayerConfig(
                        tools=[
                            DifyPluginToolConfig(
                                plugin_id="langgenius/tools",
                                provider="search",
                                tool_name="web_search",
                                credential_type="api-key",
                                parameters=_prepared_plugin_tool_parameters(),
                                parameters_json_schema=_prepared_plugin_tool_schema(),
                            )
                        ]
                    ),
                ),
            ]
        )
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=request,
                run_id="run-tools",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
            ).run()

    asyncio.run(scenario())

    assert [tool.name for tool in seen_tools] == ["web_search"]
    terminal = sink.events["run-tools"][-1]
    assert isinstance(terminal, RunSucceededEvent)
    assert terminal.data.output == "done"


def test_runner_passes_dynamic_dify_knowledge_tools_to_agent(monkeypatch: pytest.MonkeyPatch) -> None:
    seen_tools: list[Tool[object]] = []

    async def knowledge_tool() -> str:
        return "knowledge"

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="done")  # pyright: ignore[reportReturnType]

    async def fake_get_tools(self: DifyKnowledgeBaseLayer, *, http_client: httpx.AsyncClient) -> list[Tool[object]]:
        assert self.config.sets[0].dataset_ids == ["dataset-1"]
        assert http_client.headers.get("X-Test-Client") == "dify-api"
        return [Tool(knowledge_tool, name="knowledge_base_search")]

    class FakeResult:
        output: str = "done"

    class FakeAgent:
        async def run(self, *_args: object, **_kwargs: object) -> FakeResult:
            return FakeResult()

    def fake_create_agent(model: object, *, tools: list[Tool[object]], output_type: object) -> FakeAgent:
        del model, output_type
        seen_tools.extend(tools)
        return FakeAgent()

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr(DifyKnowledgeBaseLayer, "get_tools", fake_get_tools)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", fake_create_agent)

    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="prompt",
                    type="plain.prompt",
                    config=PromptLayerConfig(prefix="system", user="hello"),
                ),
                RunLayerSpec(
                    name="execution_context",
                    type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                    config=DifyExecutionContextLayerConfig(
                        tenant_id="tenant-1",
                        user_id="user-1",
                        user_from="account",
                        app_id="app-1",
                        agent_mode="workflow_run",
                        invoke_from="service-api",
                    ),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type="dify.plugin.llm",
                    deps={"execution_context": "execution_context"},
                    config=DifyPluginLLMLayerConfig(
                        plugin_id="langgenius/openai",
                        model_provider="openai",
                        model="demo-model",
                    ),
                ),
                RunLayerSpec(
                    name="knowledge",
                    type=DIFY_KNOWLEDGE_BASE_LAYER_TYPE_ID,
                    deps={"execution_context": "execution_context"},
                    config=DifyKnowledgeBaseLayerConfig.model_validate(
                        {
                            "sets": [
                                {
                                    "id": "support",
                                    "name": "Support KB",
                                    "datasets": [{"id": "dataset-1"}],
                                    "query": {"mode": "generated_query"},
                                    "retrieval": {"mode": "multiple", "top_k": 4},
                                }
                            ],
                        }
                    ),
                ),
            ]
        )
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with (
            httpx.AsyncClient() as plugin_client,
            httpx.AsyncClient(headers={"X-Test-Client": "dify-api"}) as dify_api_client,
        ):
            await AgentRunRunner(
                sink=sink,
                request=request,
                run_id="run-knowledge-tools",
                plugin_daemon_http_client=plugin_client,
                dify_api_http_client=dify_api_client,
            ).run()

    asyncio.run(scenario())

    assert [tool.name for tool in seen_tools] == ["knowledge_base_search"]


def test_runner_passes_dynamic_dify_core_tools_to_agent(monkeypatch: pytest.MonkeyPatch) -> None:
    seen_tools: list[Tool[object]] = []

    async def core_tool() -> str:
        return "core"

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="done")  # pyright: ignore[reportReturnType]

    async def fake_get_tools(self: DifyCoreToolsLayer, *, http_client: httpx.AsyncClient) -> list[Tool[object]]:
        assert self.config.tools[0].provider_type == "builtin"
        assert self.config.tools[0].tool_name == "draft_message"
        assert http_client.headers.get("X-Test-Client") == "dify-api"
        return [Tool(core_tool, name="draft_message")]

    class FakeResult:
        output: str = "done"

    class FakeAgent:
        async def run(self, *_args: object, **_kwargs: object) -> FakeResult:
            return FakeResult()

    def fake_create_agent(model: object, *, tools: list[Tool[object]], output_type: object) -> FakeAgent:
        del model, output_type
        seen_tools.extend(tools)
        return FakeAgent()

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr(DifyCoreToolsLayer, "get_tools", fake_get_tools)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", fake_create_agent)

    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="prompt",
                    type="plain.prompt",
                    config=PromptLayerConfig(prefix="system", user="hello"),
                ),
                RunLayerSpec(
                    name="execution_context",
                    type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                    config=DifyExecutionContextLayerConfig(
                        tenant_id="tenant-1",
                        user_id="user-1",
                        user_from="account",
                        app_id="app-1",
                        agent_mode="workflow_run",
                        invoke_from="service-api",
                    ),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type="dify.plugin.llm",
                    deps={"execution_context": "execution_context"},
                    config=DifyPluginLLMLayerConfig(
                        plugin_id="langgenius/openai",
                        model_provider="openai",
                        model="demo-model",
                    ),
                ),
                RunLayerSpec(
                    name="core-tools",
                    type=DIFY_CORE_TOOLS_LAYER_TYPE_ID,
                    deps={"execution_context": "execution_context"},
                    config=DifyCoreToolsLayerConfig(
                        tools=[
                            DifyCoreToolConfig(
                                provider_type="builtin",
                                provider_id="langgenius/dify-gmail/dify-gmail",
                                tool_name="draft_message",
                                credential_id="credential-1",
                                parameters_json_schema={"type": "object", "properties": {}, "required": []},
                            )
                        ]
                    ),
                ),
            ]
        )
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with (
            httpx.AsyncClient() as plugin_client,
            httpx.AsyncClient(headers={"X-Test-Client": "dify-api"}) as dify_api_client,
        ):
            await AgentRunRunner(
                sink=sink,
                request=request,
                run_id="run-core-tools",
                plugin_daemon_http_client=plugin_client,
                dify_api_http_client=dify_api_client,
            ).run()

    asyncio.run(scenario())

    assert [tool.name for tool in seen_tools] == ["draft_message"]


def test_runner_rejects_duplicate_tool_names_across_dynamic_tool_layers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create_agent_called = False

    async def duplicate_tool() -> str:
        return "tool"

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="done")  # pyright: ignore[reportReturnType]

    async def fake_get_tools(
        _self: DifyPluginToolsLayer,
        *,
        http_client: httpx.AsyncClient,
        dify_api_http_client: httpx.AsyncClient,
    ) -> list[Tool[object]]:
        assert http_client.is_closed is False
        assert dify_api_http_client.is_closed is False
        return [Tool(duplicate_tool, name="shared_tool")]

    def fake_create_agent(model: object, *, tools: list[Tool[object]], output_type: object) -> object:
        del model, tools, output_type
        nonlocal create_agent_called
        create_agent_called = True
        raise AssertionError("create_agent should not be called when duplicate tool names are detected")

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr(DifyPluginToolsLayer, "get_tools", fake_get_tools)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", fake_create_agent)

    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="prompt",
                    type="plain.prompt",
                    config=PromptLayerConfig(prefix="system", user="hello"),
                ),
                RunLayerSpec(
                    name="execution_context",
                    type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                    config=DifyExecutionContextLayerConfig(
                        tenant_id="tenant-1",
                        user_from="account",
                        agent_mode="workflow_run",
                        invoke_from="service-api",
                    ),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type="dify.plugin.llm",
                    deps={"execution_context": "execution_context"},
                    config=DifyPluginLLMLayerConfig(
                        plugin_id="langgenius/openai",
                        model_provider="openai",
                        model="demo-model",
                    ),
                ),
                RunLayerSpec(
                    name="tools-1",
                    type=DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID,
                    deps={"execution_context": "execution_context"},
                    config=DifyPluginToolsLayerConfig(
                        tools=[
                            DifyPluginToolConfig(
                                plugin_id="langgenius/tools",
                                provider="search",
                                tool_name="web_search",
                                credential_type="api-key",
                                parameters=_prepared_plugin_tool_parameters(),
                                parameters_json_schema=_prepared_plugin_tool_schema(),
                            )
                        ]
                    ),
                ),
                RunLayerSpec(
                    name="tools-2",
                    type=DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID,
                    deps={"execution_context": "execution_context"},
                    config=DifyPluginToolsLayerConfig(
                        tools=[
                            DifyPluginToolConfig(
                                plugin_id="langgenius/tools",
                                provider="search",
                                tool_name="web_search_two",
                                credential_type="api-key",
                                parameters=_prepared_plugin_tool_parameters(),
                                parameters_json_schema=_prepared_plugin_tool_schema(),
                            )
                        ]
                    ),
                ),
            ]
        )
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(
                AgentRunValidationError,
                match="unique tool names across all layers, got duplicates: shared_tool",
            ):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-duplicate-tools",
                    plugin_daemon_http_client=client,
                    dify_api_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert create_agent_called is False
    assert [event.type for event in sink.events["run-duplicate-tools"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-duplicate-tools"] == "failed"


def test_runner_rejects_duplicate_tool_names_between_static_and_dynamic_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create_agent_called = False

    def web_search(query: str) -> str:
        return query

    async def dynamic_duplicate_tool() -> str:
        return "tool"

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="done")  # pyright: ignore[reportReturnType]

    async def fake_get_tools(
        _self: DifyPluginToolsLayer,
        *,
        http_client: httpx.AsyncClient,
        dify_api_http_client: httpx.AsyncClient,
    ) -> list[Tool[object]]:
        assert http_client.is_closed is False
        assert dify_api_http_client.is_closed is False
        return [Tool(dynamic_duplicate_tool, name="web_search")]

    def fake_create_agent(model: object, *, tools: list[Tool[object]], output_type: object) -> object:
        del model, tools, output_type
        nonlocal create_agent_called
        create_agent_called = True
        raise AssertionError("create_agent should not be called when duplicate tool names are detected")

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr(DifyPluginToolsLayer, "get_tools", fake_get_tools)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", fake_create_agent)

    static_tools_provider = LayerProvider.from_factory(
        layer_type=StaticToolsTestLayer,
        create=lambda _config: StaticToolsTestLayer(tool_entries=(web_search,)),
    )
    layer_providers = (*create_default_layer_providers(), static_tools_provider)

    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="prompt",
                    type="plain.prompt",
                    config=PromptLayerConfig(prefix="system", user="hello"),
                ),
                RunLayerSpec(name="static-tools", type=cast(str, StaticToolsTestLayer.type_id)),
                RunLayerSpec(
                    name="execution_context",
                    type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                    config=DifyExecutionContextLayerConfig(
                        tenant_id="tenant-1",
                        user_from="account",
                        agent_mode="workflow_run",
                        invoke_from="service-api",
                    ),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type="dify.plugin.llm",
                    deps={"execution_context": "execution_context"},
                    config=DifyPluginLLMLayerConfig(
                        plugin_id="langgenius/openai",
                        model_provider="openai",
                        model="demo-model",
                    ),
                ),
                RunLayerSpec(
                    name="tools",
                    type=DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID,
                    deps={"execution_context": "execution_context"},
                    config=DifyPluginToolsLayerConfig(
                        tools=[
                            DifyPluginToolConfig(
                                plugin_id="langgenius/tools",
                                provider="search",
                                tool_name="web_search",
                                credential_type="api-key",
                                parameters=_prepared_plugin_tool_parameters(),
                                parameters_json_schema=_prepared_plugin_tool_schema(),
                            )
                        ]
                    ),
                ),
            ]
        )
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(
                AgentRunValidationError,
                match="unique tool names across all layers, got duplicates: web_search",
            ):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-static-dynamic-duplicate-tools",
                    plugin_daemon_http_client=client,
                    dify_api_http_client=client,
                    layer_providers=layer_providers,
                ).run()

    asyncio.run(scenario())

    assert create_agent_called is False
    assert [event.type for event in sink.events["run-static-dynamic-duplicate-tools"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-static-dynamic-duplicate-tools"] == "failed"


def test_runner_rejects_duplicate_tool_names_between_shell_and_other_layers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create_agent_called = False
    shell_client = FakeRunnerShellctlClient()

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="done")  # pyright: ignore[reportReturnType]

    async def fake_get_tools(
        _self: DifyPluginToolsLayer,
        *,
        http_client: httpx.AsyncClient,
        dify_api_http_client: httpx.AsyncClient,
    ) -> list[Tool[object]]:
        assert http_client.is_closed is False
        assert dify_api_http_client.is_closed is False

        async def duplicate_shell_run() -> str:
            return "tool"

        return [Tool(duplicate_shell_run, name="shell_run")]

    def fake_create_agent(model: object, *, tools: list[Tool[object]], output_type: object) -> object:
        del model, tools, output_type
        nonlocal create_agent_called
        create_agent_called = True
        raise AssertionError("create_agent should not be called when duplicate tool names are detected")

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr(DifyPluginToolsLayer, "get_tools", fake_get_tools)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", fake_create_agent)

    runtime_backend_profile = RuntimeBackendProfile(
        home_snapshots=cast(HomeSnapshotBackend, object()),
        execution_bindings=FakeRunnerExecutionBindingBackend(shell_client),
    )
    layer_providers = create_default_layer_providers(runtime_backend_profile=runtime_backend_profile)

    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="prompt",
                    type="plain.prompt",
                    config=PromptLayerConfig(prefix="system", user="hello"),
                ),
                RunLayerSpec(
                    name="execution_context",
                    type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                    config=DifyExecutionContextLayerConfig(
                        tenant_id="tenant-1",
                        agent_id="agent-1",
                        agent_config_version_id="config-1",
                        user_from="account",
                        agent_mode="workflow_run",
                        invoke_from="service-api",
                    ),
                ),
                RunLayerSpec(
                    name="runtime",
                    type=DIFY_RUNTIME_LAYER_TYPE_ID,
                    config=DifyRuntimeLayerConfig(backend_binding_ref="binding-1"),
                ),
                RunLayerSpec(
                    name="shell",
                    type=DIFY_SHELL_LAYER_TYPE_ID,
                    deps={"execution_context": "execution_context", "runtime": "runtime"},
                    config=DifyShellLayerConfig(),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type="dify.plugin.llm",
                    deps={"execution_context": "execution_context"},
                    config=DifyPluginLLMLayerConfig(
                        plugin_id="langgenius/openai",
                        model_provider="openai",
                        model="demo-model",
                    ),
                ),
                RunLayerSpec(
                    name="tools",
                    type=DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID,
                    deps={"execution_context": "execution_context"},
                    config=DifyPluginToolsLayerConfig(
                        tools=[
                            DifyPluginToolConfig(
                                plugin_id="langgenius/tools",
                                provider="search",
                                tool_name="web_search",
                                credential_type="api-key",
                                parameters=_prepared_plugin_tool_parameters(),
                                parameters_json_schema=_prepared_plugin_tool_schema(),
                            )
                        ]
                    ),
                ),
            ]
        )
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(
                AgentRunValidationError,
                match="unique tool names across all layers, got duplicates: shell_run",
            ):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-shell-duplicate-tools",
                    plugin_daemon_http_client=client,
                    dify_api_http_client=client,
                    layer_providers=layer_providers,
                ).run()

    asyncio.run(scenario())

    assert create_agent_called is False
    assert shell_client.delete_calls == []
    assert shell_client.closed is True
    assert [event.type for event in sink.events["run-shell-duplicate-tools"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-shell-duplicate-tools"] == "failed"


def test_runner_passes_system_prompt_as_run_instructions_without_history_layer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model = RecordingTestModel(custom_output_text="done")

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return model  # pyright: ignore[reportReturnType]

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=_request("current user"),
                run_id="run-no-history",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
            ).run()

    asyncio.run(scenario())

    assert model.seen_instructions[0] == ["system"]
    request_parts = _flatten_message_parts(model.seen_requests[0])
    assert len(request_parts) == 1
    assert isinstance(request_parts[0], UserPromptPart)
    assert request_parts[0].content == "current user"
    terminal = sink.events["run-no-history"][-1]
    assert isinstance(terminal, RunSucceededEvent)
    assert [layer.name for layer in terminal.data.session_snapshot.layers] == [
        "prompt",
        "execution_context",
        DIFY_AGENT_MODEL_LAYER_ID,
    ]


def test_runner_passes_stored_history_with_current_instructions_and_replaces_full_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model = RecordingTestModel(custom_output_text="done")
    stored_history = [
        ModelRequest(parts=[UserPromptPart(content="old user")]),
        ModelResponse(parts=[TextPart(content="old assistant")]),
    ]

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return model  # pyright: ignore[reportReturnType]

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    request = _request("current user", include_history=True)
    request.session_snapshot = _history_session_snapshot(stored_history)
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=request,
                run_id="run-history",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
            ).run()

    asyncio.run(scenario())

    assert model.seen_instructions[0] == ["system"]
    request_parts = _flatten_message_parts(model.seen_requests[0])
    assert isinstance(request_parts[0], UserPromptPart)
    assert request_parts[0].content == "old user"
    assert isinstance(request_parts[1], TextPart)
    assert request_parts[1].content == "old assistant"
    assert isinstance(request_parts[2], UserPromptPart)
    assert request_parts[2].content == "current user"

    terminal = sink.events["run-history"][-1]
    assert isinstance(terminal, RunSucceededEvent)
    saved_history = _history_messages_from_snapshot(terminal.data.session_snapshot)
    assert saved_history[:2] == stored_history
    assert isinstance(saved_history[2], ModelRequest)
    assert len(saved_history[2].parts) == 1
    assert isinstance(saved_history[2].parts[0], UserPromptPart)
    assert saved_history[2].parts[0].content == "current user"
    assert isinstance(saved_history[3], ModelResponse)
    assert len(saved_history[3].parts) == 1
    assert isinstance(saved_history[3].parts[0], TextPart)
    assert saved_history[3].parts[0].content == "done"
    assert all(not any(isinstance(part, SystemPromptPart) for part in message.parts) for message in saved_history)
    assert all(not isinstance(message, ModelRequest) or message.instructions is None for message in saved_history)


def test_runner_with_empty_history_layer_uses_instructions_and_saves_full_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model = RecordingTestModel(custom_output_text="done")

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return model  # pyright: ignore[reportReturnType]

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    request = _request("current user", include_history=True)
    request.session_snapshot = _history_session_snapshot([])
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=request,
                run_id="run-empty-history",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
            ).run()

    asyncio.run(scenario())

    assert model.seen_instructions[0] == ["system"]
    request_parts = _flatten_message_parts(model.seen_requests[0])
    assert len(request_parts) == 1
    assert isinstance(request_parts[0], UserPromptPart)
    assert request_parts[0].content == "current user"

    terminal = sink.events["run-empty-history"][-1]
    assert isinstance(terminal, RunSucceededEvent)
    saved_history = _history_messages_from_snapshot(terminal.data.session_snapshot)
    assert isinstance(saved_history[0], ModelRequest)
    assert len(saved_history[0].parts) == 1
    assert isinstance(saved_history[0].parts[0], UserPromptPart)
    assert saved_history[0].parts[0].content == "current user"
    assert isinstance(saved_history[1], ModelResponse)
    assert len(saved_history[1].parts) == 1
    assert isinstance(saved_history[1].parts[0], TextPart)
    assert saved_history[1].parts[0].content == "done"
    assert all(not any(isinstance(part, SystemPromptPart) for part in message.parts) for message in saved_history)
    assert all(not isinstance(message, ModelRequest) or message.instructions is None for message in saved_history)


def test_runner_failure_with_history_layer_captures_interrupted_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored_history = [
        ModelRequest(parts=[UserPromptPart(content="old user")]),
        ModelResponse(parts=[TextPart(content="old assistant")]),
    ]

    async def stream_response(_messages: list[ModelMessage], _info: object) -> AsyncIterator[str]:
        yield "partial"
        raise RuntimeError("boom")

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return FunctionModel(stream_function=stream_response)

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    request = _request("current user", include_history=True)
    request.session_snapshot = _history_session_snapshot(stored_history)
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(RuntimeError, match="boom"):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-history-failure",
                    plugin_daemon_http_client=client,
                    dify_api_http_client=client,
                ).run()

    asyncio.run(scenario())

    event_types = [event.type for event in sink.events["run-history-failure"]]
    assert event_types[0] == "run_started"
    assert sink.statuses["run-history-failure"] == "failed"
    terminal = sink.events["run-history-failure"][-1]
    assert isinstance(terminal, RunFailedEvent)
    assert terminal.data.session_snapshot is not None
    _assert_interrupted_history(terminal.data.session_snapshot, stored_history)
    assert request.session_snapshot is not None
    assert _history_messages_from_snapshot(request.session_snapshot) == stored_history


def test_runner_preserves_history_when_agent_fails_before_capture_is_bound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored_history = [
        ModelRequest(parts=[UserPromptPart(content="old user")]),
        ModelResponse(parts=[TextPart(content="old assistant")]),
    ]

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        assert http_client.is_closed is False
        return TestModel(custom_output_text="unused")  # pyright: ignore[reportReturnType]

    class FakeAgent:
        async def run(self, *_args: object, **_kwargs: object) -> None:
            raise RuntimeError("boom before capture")

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    monkeypatch.setattr("dify_agent.runtime.runner.create_agent", lambda *_args, **_kwargs: FakeAgent())
    request = _request("current user", include_history=True)
    request.session_snapshot = _history_session_snapshot(stored_history)
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(RuntimeError, match="boom before capture"):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-history-empty-capture",
                    plugin_daemon_http_client=client,
                    dify_api_http_client=client,
                ).run()

    asyncio.run(scenario())

    terminal = sink.events["run-history-empty-capture"][-1]
    assert isinstance(terminal, RunFailedEvent)
    assert terminal.data.session_snapshot is not None
    assert _history_messages_from_snapshot(terminal.data.session_snapshot) == stored_history


def test_runner_persists_usage_limit_failure_type_in_event_and_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            runner = AgentRunRunner(
                sink=sink,
                request=_request(),
                run_id="run-limit",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
            )

            async def exceed_limit() -> RunSuccessOutcome:
                raise UsageLimitExceeded("The next request would exceed the request_limit of 500")

            monkeypatch.setattr(runner, "_run_agent", exceed_limit)
            with pytest.raises(UsageLimitExceeded):
                await runner.run()

    asyncio.run(scenario())

    terminal = sink.events["run-limit"][-1]
    assert isinstance(terminal, RunFailedEvent)
    assert terminal.data.error_type is RunFailureType.AGENT_RUN_LIMIT_EXCEEDED
    assert sink.statuses["run-limit"] == "failed"
    assert sink.error_types["run-limit"] is RunFailureType.AGENT_RUN_LIMIT_EXCEEDED


def test_runner_applies_on_exit_overrides_to_success_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
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
                dify_api_http_client=client,
            ).run()

    asyncio.run(scenario())

    terminal = sink.events["run-exit"][-1]
    assert isinstance(terminal, RunSucceededEvent)
    assert {layer.name: layer.lifecycle_state for layer in terminal.data.session_snapshot.layers} == {
        "prompt": LifecycleState.CLOSED,
        "execution_context": LifecycleState.SUSPENDED,
        DIFY_AGENT_MODEL_LAYER_ID: LifecycleState.CLOSED,
    }


def test_runner_requires_model_layer() -> None:
    request = _request(llm_layer_name="not-llm")
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(AgentRunValidationError, match="Missing required"):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-missing-model",
                    plugin_daemon_http_client=client,
                    dify_api_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert [event.type for event in sink.events["run-missing-model"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-missing-model"] == "failed"


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

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
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
            description="Structured incident summary returned by the agent.",
            strict=True,
        )
    )
    sink = InMemoryRunEventSink()
    expected_snapshot_layer_names = [
        "prompt",
        "execution_context",
        DIFY_AGENT_MODEL_LAYER_ID,
        DIFY_AGENT_OUTPUT_LAYER_ID,
    ]

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            await AgentRunRunner(
                sink=sink,
                request=request,
                run_id="run-structured-output",
                plugin_daemon_http_client=client,
                dify_api_http_client=client,
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
                dify_api_http_client=client,
            ).run()

    asyncio.run(scenario())

    assert model.last_model_request_parameters is not None
    assert len(model.last_model_request_parameters.output_tools) == 1
    output_tool = model.last_model_request_parameters.output_tools[0]
    assert output_tool.name == "final_output"
    assert output_tool.description == "Structured incident summary returned by the agent."
    assert output_tool.parameters_json_schema["type"] == "object"
    assert output_tool.parameters_json_schema["title"] == "final_output"
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

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
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
                dify_api_http_client=client,
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

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
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
                    dify_api_http_client=client,
                ).run()

    asyncio.run(scenario())

    event_types = [event.type for event in sink.events["run-output-retry-failed"]]
    assert event_types[0] == "run_started"
    assert event_types[-1] == "run_failed"
    assert "run_succeeded" not in event_types
    assert sink.statuses["run-output-retry-failed"] == "failed"


def test_runner_rejects_invalid_output_layer_before_model_resolution(monkeypatch: pytest.MonkeyPatch) -> None:
    model_requested = False

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
        del http_client
        nonlocal model_requested
        model_requested = True
        return TestModel(custom_output_text="done")  # pyright: ignore[reportReturnType]

    monkeypatch.setattr(DifyPluginLLMLayer, "get_model", fake_get_model)
    request = _request(
        output_config={
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
                    dify_api_http_client=client,
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
                    name="execution_context",
                    type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                    config=DifyExecutionContextLayerConfig(
                        tenant_id="tenant-1",
                        user_from="account",
                        agent_mode="workflow_run",
                        invoke_from="service-api",
                    ),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type="dify.plugin.llm",
                    deps={"execution_context": "execution_context"},
                    config=DifyPluginLLMLayerConfig(
                        plugin_id="langgenius/openai",
                        model_provider="openai",
                        model="demo-model",
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

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
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
                    dify_api_http_client=client,
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
                    name="execution_context",
                    type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                    config=DifyExecutionContextLayerConfig(
                        tenant_id="tenant-1",
                        user_from="account",
                        agent_mode="workflow_run",
                        invoke_from="service-api",
                    ),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type="dify.plugin.llm",
                    deps={"execution_context": "execution_context"},
                    config=DifyPluginLLMLayerConfig(
                        plugin_id="langgenius/openai",
                        model_provider="openai",
                        model="demo-model",
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

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
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
                    dify_api_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert model_requested is False
    assert [event.type for event in sink.events["run-duplicate-output"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-duplicate-output"] == "failed"


def test_runner_rejects_reserved_output_name_with_wrong_layer_type_before_model_resolution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model_requested = False

    def fake_get_model(_self: DifyPluginLLMLayer, *, http_client: httpx.AsyncClient, agent_run_id: str):
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
                    name="execution_context",
                    type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                    config=DifyExecutionContextLayerConfig(
                        tenant_id="tenant-1",
                        user_from="account",
                        agent_mode="workflow_run",
                        invoke_from="service-api",
                    ),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type="dify.plugin.llm",
                    deps={"execution_context": "execution_context"},
                    config=DifyPluginLLMLayerConfig(
                        plugin_id="langgenius/openai",
                        model_provider="openai",
                        model="demo-model",
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
                    dify_api_http_client=client,
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
                    dify_api_http_client=client,
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
                    dify_api_http_client=client,
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
                    dify_api_http_client=client,
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
                    dify_api_http_client=client,
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
                    dify_api_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert [event.type for event in sink.events["run-3"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-3"] == "failed"


def test_runner_rejects_reserved_llm_layer_name_with_wrong_type() -> None:
    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="prompt",
                    type="plain.prompt",
                    config=PromptLayerConfig(prefix="system", user="hello"),
                ),
                RunLayerSpec(
                    name="execution_context",
                    type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                    config=DifyExecutionContextLayerConfig(
                        tenant_id="tenant-1",
                        user_from="account",
                        agent_mode="workflow_run",
                        invoke_from="service-api",
                    ),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type="plain.prompt",
                    config=PromptLayerConfig(user="not an llm"),
                ),
            ]
        ),
        on_exit=LayerExitSignals(),
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(AgentRunValidationError, match="DifyPluginLLMLayer"):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-4",
                    plugin_daemon_http_client=client,
                    dify_api_http_client=client,
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
                name="execution_context",
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
                    dify_api_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert [event.type for event in sink.events["run-closed-snapshot"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-closed-snapshot"] == "failed"
    terminal = sink.events["run-closed-snapshot"][-1]
    assert isinstance(terminal, RunFailedEvent)
    assert request.session_snapshot is not None
    assert terminal.data.session_snapshot is None


def test_runner_treats_missing_runtime_dependency_as_validation_error() -> None:
    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="prompt",
                    type="plain.prompt",
                    config=PromptLayerConfig(prefix="system", user="hello"),
                ),
                RunLayerSpec(name="shell", type=DIFY_SHELL_LAYER_TYPE_ID, config=DifyShellLayerConfig()),
                RunLayerSpec(
                    name="execution_context",
                    type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                    config=DifyExecutionContextLayerConfig(
                        tenant_id="tenant-1",
                        user_from="account",
                        agent_mode="workflow_run",
                        invoke_from="service-api",
                    ),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type="dify.plugin.llm",
                    deps={"execution_context": "execution_context"},
                    config=DifyPluginLLMLayerConfig(
                        plugin_id="langgenius/openai",
                        model_provider="openai",
                        model="demo-model",
                    ),
                ),
            ]
        )
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(AgentRunValidationError, match="Dependency 'runtime' is required"):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-missing-shell-entrypoint",
                    plugin_daemon_http_client=client,
                    dify_api_http_client=client,
                ).run()

    asyncio.run(scenario())

    assert [event.type for event in sink.events["run-missing-shell-entrypoint"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-missing-shell-entrypoint"] == "failed"


def test_runner_treats_invalid_shell_snapshot_offsets_as_validation_error() -> None:
    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="prompt",
                    type="plain.prompt",
                    config=PromptLayerConfig(prefix="system", user="hello"),
                ),
                RunLayerSpec(name="shell", type=DIFY_SHELL_LAYER_TYPE_ID, config=DifyShellLayerConfig()),
                RunLayerSpec(
                    name="execution_context",
                    type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                    config=DifyExecutionContextLayerConfig(
                        tenant_id="tenant-1",
                        user_from="account",
                        agent_mode="workflow_run",
                        invoke_from="service-api",
                    ),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type="dify.plugin.llm",
                    deps={"execution_context": "execution_context"},
                    config=DifyPluginLLMLayerConfig(
                        plugin_id="langgenius/openai",
                        model_provider="openai",
                        model="demo-model",
                    ),
                ),
            ]
        ),
        session_snapshot=CompositorSessionSnapshot(
            layers=[
                LayerSessionSnapshot(name="prompt", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}),
                LayerSessionSnapshot(
                    name="shell",
                    lifecycle_state=LifecycleState.SUSPENDED,
                    runtime_state={
                        "session_id": "abc12ff",
                        "workspace_cwd": "~/workspace/abc12ff",
                        "job_ids": ["job-1"],
                        "job_offsets": {"job-1": -1},
                    },
                ),
                LayerSessionSnapshot(
                    name="execution_context",
                    lifecycle_state=LifecycleState.SUSPENDED,
                    runtime_state={},
                ),
                LayerSessionSnapshot(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    lifecycle_state=LifecycleState.SUSPENDED,
                    runtime_state={},
                ),
            ]
        ),
    )
    sink = InMemoryRunEventSink()

    async def scenario() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(AgentRunValidationError, match="job_offsets"):
                await AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-invalid-shell-offset",
                    plugin_daemon_http_client=client,
                    dify_api_http_client=client,
                    layer_providers=create_default_layer_providers(),
                ).run()

    asyncio.run(scenario())

    assert [event.type for event in sink.events["run-invalid-shell-offset"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-invalid-shell-offset"] == "failed"
