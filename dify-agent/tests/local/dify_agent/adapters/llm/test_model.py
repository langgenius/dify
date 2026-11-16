import asyncio
import json
import unittest
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from decimal import Decimal
from typing import cast, override
from unittest.mock import patch
from uuid import uuid4

import httpx
import pytest
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent, TextPromptMessageContent
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError, UnexpectedModelBehavior, UserError
from pydantic_ai.messages import (
    InstructionPart,
    ModelMessage,
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    SpeechPart,
    SystemPromptPart,
    TextPart,
    ThinkingPart,
    ToolAvailabilityDeltaPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.models.instrumented import InstrumentationSettings, InstrumentedModel
from pydantic_ai.tools import ToolDefinition

from dify_agent.adapters.llm import DifyApiLLMProvider, DifyLLMAdapterModel
from dify_agent.layers.execution_context import ApplicationTracingContext, DifyExecutionContextLayerConfig
from dify_agent.runtime.compaction import build_compaction_capability
from dify_agent.runtime.context import Deps, Services

from ._test_support import (
    AssistantPromptMessage,
    LLMResultChunk,
    LLMResultChunkDelta,
    build_error_response,
    build_stream_error,
    build_stream_response,
    make_usage,
    single_text_chunk,
    wrap_plugin_daemon_stream_item,
)

_OMIT_ID = object()


def _tool_call(
    tool_name: str,
    arguments: str,
    *,
    call_id: str | None | object = _OMIT_ID,
) -> AssistantPromptMessage.ToolCall:
    """Build a gateway tool call, defaulting ``id`` to ``tool_name`` like name-based plugins."""
    resolved_id = tool_name if call_id is _OMIT_ID else cast(str | None, call_id)
    return AssistantPromptMessage.ToolCall(
        id=resolved_id,  # pyright: ignore[reportArgumentType]
        type="function",
        function=AssistantPromptMessage.ToolCall.ToolCallFunction(name=tool_name, arguments=arguments),
    )


def _tool_chunk(
    *tool_calls: AssistantPromptMessage.ToolCall,
    index: int = 0,
    finish_reason: str | None = None,
) -> LLMResultChunk:
    return LLMResultChunk(
        model="demo-model",
        delta=LLMResultChunkDelta(
            index=index,
            message=AssistantPromptMessage(content="", tool_calls=list(tool_calls)),
            finish_reason=finish_reason,
        ),
    )


class _TrackingResponseBody(httpx.AsyncByteStream):
    def __init__(self, payloads: list[bytes], *, close_error: Exception | None = None) -> None:
        self.payloads = payloads
        self.close_error = close_error
        self.close_count = 0

    async def __aiter__(self) -> AsyncGenerator[bytes, None]:
        for payload in self.payloads:
            yield payload

    async def aclose(self) -> None:
        self.close_count += 1
        if self.close_error is not None:
            raise self.close_error


def _stream_lifecycle_payloads(*, usage_in_first_chunk: bool = False) -> list[bytes]:
    first_chunk = LLMResultChunk(
        model="demo-model",
        delta=LLMResultChunkDelta(
            index=0,
            message=AssistantPromptMessage(content="hello ", tool_calls=[]),
            usage=make_usage(prompt_tokens=6, completion_tokens=4) if usage_in_first_chunk else None,
        ),
    )
    final_chunk = LLMResultChunk(
        model="demo-model",
        delta=LLMResultChunkDelta(
            index=1,
            message=AssistantPromptMessage(content="world", tool_calls=[]),
            usage=make_usage(prompt_tokens=6, completion_tokens=4),
            finish_reason="stop",
        ),
    )
    return [build_stream_response(first_chunk).content, build_stream_response(final_chunk).content]


class DifyLLMAdapterModelTests(unittest.IsolatedAsyncioTestCase):
    _http_clients: list[httpx.AsyncClient] = []

    async def asyncSetUp(self) -> None:
        self._http_clients: list[httpx.AsyncClient] = []

    async def asyncTearDown(self) -> None:
        for client in self._http_clients:
            await client.aclose()

    def make_provider(
        self,
        *,
        user_id: str = "user-123",
        http_client: httpx.AsyncClient | None = None,
    ) -> DifyApiLLMProvider:
        if http_client is None:
            http_client = httpx.AsyncClient(trust_env=False)
            self._http_clients.append(http_client)
        return DifyApiLLMProvider(
            plugin_id="langgenius/openai",
            inner_api_url="http://dify-api",
            inner_api_key="inner-secret",
            execution_context=DifyExecutionContextLayerConfig(
                tenant_id="tenant-1",
                user_id=user_id,
                user_from="account",
                app_id="app-1",
                agent_mode="single_step",
                invoke_from="debugger",
            ),
            agent_run_id="run-1",
            http_client=http_client,
        )

    def make_streaming_adapter(self, *bodies: _TrackingResponseBody) -> DifyLLMAdapterModel:
        """Serve bodies in request order, exercising HTTPX cleanup that mock_gateway_stream bypasses."""
        response_bodies = iter(bodies)

        async def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                request=request,
                headers={"content-type": "text/event-stream"},
                stream=next(response_bodies),
            )

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler), trust_env=False)
        self._http_clients.append(http_client)
        return DifyLLMAdapterModel(
            "demo-model",
            self.make_provider(http_client=http_client),
            model_provider="openai",
        )

    async def cancel_request_after_first_chunk(
        self,
        inflight_chunk: LLMResultChunk,
        *,
        stream: bool,
        completed_chunk: LLMResultChunk | None = None,
    ) -> DifyLLMAdapterModel:
        """Cancel while awaiting the next gateway chunk, optionally after a completed round."""
        read_blocked = asyncio.Event()

        class BlockingResponseBody(_TrackingResponseBody):
            @override
            async def __aiter__(self) -> AsyncGenerator[bytes, None]:
                async for payload in super().__aiter__():
                    yield payload
                read_blocked.set()
                await asyncio.Event().wait()

        inflight_body = BlockingResponseBody([build_stream_response(inflight_chunk).content])
        bodies: list[_TrackingResponseBody] = []
        if completed_chunk is not None:
            bodies.append(_TrackingResponseBody([build_stream_response(completed_chunk).content]))
        bodies.append(inflight_body)
        adapter = self.make_streaming_adapter(*bodies)
        messages: list[ModelMessage] = [ModelRequest(parts=[UserPromptPart("hello")])]
        if completed_chunk is not None:
            await adapter.request(messages, None, ModelRequestParameters())

        async def consume_request() -> None:
            if stream:
                async with adapter.request_stream(messages, None, ModelRequestParameters()) as response:
                    async for _event in response:
                        pass
            else:
                await adapter.request(messages, None, ModelRequestParameters())

        async with asyncio.timeout(5), asyncio.TaskGroup() as tasks:
            task = tasks.create_task(consume_request())
            await read_blocked.wait()
            task.cancel("run stopped")
            with self.assertRaises(asyncio.CancelledError) as cancellation:
                await task

        self.assertEqual(cancellation.exception.args, ("run stopped",))
        self.assertEqual(inflight_body.close_count, 1)
        return adapter

    @asynccontextmanager
    async def mock_gateway_stream(self, handler: httpx.MockTransport):
        @asynccontextmanager
        async def mock_stream(
            client: httpx.AsyncClient,
            method: str,
            url: str,
            **kwargs: object,
        ):
            request = client.build_request(
                method,
                url,
                headers=cast(dict[str, str] | None, kwargs.get("headers")),
                json=kwargs.get("json"),
            )
            yield handler.handle_request(request)

        with patch.object(httpx.AsyncClient, "stream", new=mock_stream):
            yield

    async def invoke_adapter(
        self,
        messages: list[ModelMessage],
        *,
        stream: bool,
        model_provider: str = "ollama",
    ) -> ModelResponse:
        adapter = DifyLLMAdapterModel(
            "demo-model",
            self.make_provider(),
            model_provider=model_provider,
        )
        if not stream:
            return await adapter.request(
                messages,
                model_settings=None,
                model_request_parameters=ModelRequestParameters(),
            )
        async with adapter.request_stream(
            messages,
            model_settings=None,
            model_request_parameters=ModelRequestParameters(),
        ) as response_stream:
            _ = [event async for event in response_stream]
            return response_stream.get()

    async def test_request_uses_api_gateway_contract(self) -> None:
        messages = [
            ModelRequest(
                parts=[
                    SystemPromptPart("   "),
                    SystemPromptPart("request system"),
                    UserPromptPart("hello"),
                    ToolReturnPart(
                        tool_name="lookup",
                        content={"city": "Paris"},
                        tool_call_id="tool-1",
                    ),
                    RetryPromptPart(content="try again", tool_name="lookup", tool_call_id="tool-1"),
                ]
            ),
            ModelResponse(
                parts=[
                    TextPart(content="previous answer"),
                    ToolCallPart(
                        tool_name="lookup",
                        args='{"city":"Paris"}',
                        tool_call_id="tool-1",
                    ),
                ]
            ),
        ]
        request_parameters = ModelRequestParameters(
            function_tools=[
                ToolDefinition(
                    name="weather",
                    description="Look up the weather",
                    parameters_json_schema={
                        "type": "object",
                        "properties": {"city": {"type": "string"}},
                    },
                )
            ],
            output_mode="tool",
            output_tools=[
                ToolDefinition(
                    name="incident_summary",
                    description="Return the final structured incident summary",
                    parameters_json_schema={
                        "type": "object",
                        "properties": {"title": {"type": "string"}},
                        "required": ["title"],
                        "additionalProperties": False,
                    },
                )
            ],
            allow_text_output=False,
            instruction_parts=[InstructionPart(content="be concise")],
        )

        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.method, "POST")
            self.assertEqual(request.url.path, "/inner/api/agent/llm/invoke")
            self.assertEqual(request.headers["X-Inner-Api-Key"], "inner-secret")

            payload = json.loads(request.content.decode("utf-8"))
            self.assertEqual(payload["caller"]["user_id"], "user-123")
            self.assertNotIn("tracing", payload["caller"])
            data = payload["target"]
            self.assertEqual(data["provider"], "langgenius/openai/openai")
            self.assertEqual(data["model"], "demo-model")
            self.assertNotIn("credentials", data)
            self.assertEqual(
                data["model_parameters"],
                {"temperature": 0.2, "max_tokens": 128, "logit_bias": {"1": 2}},
            )
            self.assertEqual(data["stop"], ["END"])
            self.assertFalse(data["stream"])
            tools_by_name = {tool["name"]: tool for tool in data["tools"]}
            self.assertEqual(set(tools_by_name), {"weather", "incident_summary"})
            self.assertEqual(tools_by_name["incident_summary"]["parameters"]["required"], ["title"])
            self.assertEqual(data["prompt_messages"][0]["role"], "system")
            self.assertEqual(data["prompt_messages"][0]["content"], "request system\n\nbe concise")
            self.assertEqual(data["prompt_messages"][1]["content"], "hello")
            self.assertEqual(data["prompt_messages"][2]["role"], "tool")
            self.assertEqual(data["prompt_messages"][3]["role"], "tool")
            self.assertEqual(data["prompt_messages"][4]["role"], "assistant")
            return build_stream_response(
                LLMResultChunk(
                    model="demo-model",
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content="adapter response", tool_calls=[]),
                        usage=make_usage(prompt_tokens=11, completion_tokens=7),
                    ),
                )
            )

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(user_id="user-123"),
                model_provider="openai",
                model_settings={"temperature": 0.2, "stop_sequences": ["DEFAULT_STOP"]},
            )

            response = await adapter.request(
                messages,
                model_settings={"max_tokens": 128, "logit_bias": {"1": 2}, "stop_sequences": ["END"]},
                model_request_parameters=request_parameters,
            )

        self.assertEqual(response.model_name, "demo-model")
        self.assertEqual(response.provider_name, "DifyAPI/langgenius/openai")
        self.assertEqual(response.usage.input_tokens, 11)
        self.assertEqual(response.usage.output_tokens, 7)
        self.assertEqual(response.parts[0].part_kind, "text")
        self.assertEqual(cast(TextPart, response.parts[0]).content, "adapter response")

    async def test_application_tracing_policy_is_excluded_from_gateway_caller(self) -> None:
        provider = self.make_provider()
        provider.execution_context.tracing = ApplicationTracingContext(
            run_id=uuid4(),
            invocation_id=uuid4(),
            trace_id=uuid4().hex,
            parent_span_id=uuid4().hex[:16],
            session_id="test-session",
            capture_content=True,
        )

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content)
            self.assertNotIn("tracing", payload["caller"])
            self.assertEqual(payload["caller"]["tenant_id"], "tenant-1")
            return build_stream_response(*single_text_chunk("hello"))

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel("demo-model", provider, model_provider="openai")
            await adapter.request([ModelRequest(parts=[UserPromptPart("hello")])], None, ModelRequestParameters())

    async def test_real_model_span_records_gateway_accounting_on_streaming_and_nonstreaming_requests(self) -> None:
        exporter = InMemorySpanExporter()
        tracer_provider = TracerProvider()
        tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
        usage = make_usage(
            prompt_tokens=17,
            completion_tokens=9,
            total_price=Decimal("0.001234"),
            currency="CNY",
            time_to_first_token=0.125,
        )

        def handler(_request: httpx.Request) -> httpx.Response:
            return build_stream_response(
                LLMResultChunk(
                    model="demo-model",
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content="hello"),
                        usage=usage,
                    ),
                ),
                LLMResultChunk(
                    model="demo-model",
                    delta=LLMResultChunkDelta(
                        index=1,
                        message=AssistantPromptMessage(content=" world"),
                    ),
                ),
            )

        try:
            async with self.mock_gateway_stream(httpx.MockTransport(handler)):
                adapter = InstrumentedModel(
                    DifyLLMAdapterModel("demo-model", self.make_provider(), model_provider="openai"),
                    InstrumentationSettings(tracer_provider=tracer_provider),
                )
                messages = [ModelRequest(parts=[UserPromptPart("test")])]
                await adapter.request(messages, None, ModelRequestParameters())
                async with adapter.request_stream(messages, None, ModelRequestParameters()) as stream:
                    async for _ in stream:
                        pass
            spans = exporter.get_finished_spans()
            self.assertEqual(len(spans), 2)
            for span in spans:
                attributes = span.attributes or {}
                self.assertEqual(attributes["gen_ai.operation.name"], "chat")
                self.assertEqual(attributes["dify.llm.total_price"], "0.001234")
                self.assertEqual(attributes["dify.llm.currency"], "CNY")
                self.assertEqual(attributes["gen_ai.response.time_to_first_token"], 0.125)
                self.assertEqual(attributes["dify.llm.time_to_first_token_unit"], "s")
                self.assertEqual(attributes["dify.llm.time_to_first_token_source"], "gateway_usage")
                self.assertEqual(attributes["gen_ai.usage.input_tokens"], 17)
                self.assertEqual(attributes["gen_ai.usage.output_tokens"], 9)
                self.assertEqual(attributes["gen_ai.usage.total_tokens"], 26)
                self.assertNotIn("gen_ai.usage.cache_read.input_tokens", attributes)
        finally:
            tracer_provider.shutdown()

    async def test_streaming_gateway_failure_marks_the_real_chat_span_as_error(self) -> None:
        exporter = InMemorySpanExporter()
        tracer_provider = TracerProvider()
        tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))

        def handler(_request: httpx.Request) -> httpx.Response:
            return build_stream_error("EndpointSetupFailedError", "sensitive-provider-detail")

        try:
            async with self.mock_gateway_stream(httpx.MockTransport(handler)):
                adapter = InstrumentedModel(
                    DifyLLMAdapterModel("demo-model", self.make_provider(), model_provider="openai"),
                    InstrumentationSettings(tracer_provider=tracer_provider),
                )
                with self.assertRaises(UserError):
                    async with adapter.request_stream(
                        [ModelRequest(parts=[UserPromptPart("test")])], None, ModelRequestParameters()
                    ) as stream:
                        async for _ in stream:
                            pass
            spans = exporter.get_finished_spans()
            self.assertEqual(len(spans), 1)
            self.assertEqual(spans[0].status.status_code, StatusCode.ERROR)
            self.assertEqual((spans[0].attributes or {}).get("error.type"), "UserError")
            self.assertNotIn("dify.llm.total_price", spans[0].attributes or {})
        finally:
            tracer_provider.shutdown()

    async def test_model_span_measures_first_content_without_inventing_missing_cost(self) -> None:
        exporter = InMemorySpanExporter()
        tracer_provider = TracerProvider()
        tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))

        def handler(_request: httpx.Request) -> httpx.Response:
            return build_stream_response(
                LLMResultChunk(
                    model="demo-model",
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content=""),
                    ),
                ),
                LLMResultChunk(
                    model="demo-model",
                    delta=LLMResultChunkDelta(
                        index=1,
                        message=AssistantPromptMessage(content="hello"),
                    ),
                ),
            )

        try:
            async with self.mock_gateway_stream(httpx.MockTransport(handler)):
                adapter = InstrumentedModel(
                    DifyLLMAdapterModel("demo-model", self.make_provider(), model_provider="openai"),
                    InstrumentationSettings(tracer_provider=tracer_provider),
                )
                await adapter.request([ModelRequest(parts=[UserPromptPart("test")])], None, ModelRequestParameters())
            attributes = exporter.get_finished_spans()[0].attributes or {}
            self.assertGreaterEqual(attributes["gen_ai.response.time_to_first_token"], 0)
            self.assertEqual(attributes["dify.llm.time_to_first_token_source"], "gateway_first_content")
            self.assertNotIn("dify.llm.total_price", attributes)
            self.assertNotIn("dify.llm.currency", attributes)
        finally:
            tracer_provider.shutdown()

    async def test_request_accumulates_complete_dify_usage_across_model_rounds(self) -> None:
        usages = [
            make_usage(
                prompt_tokens=10,
                completion_tokens=2,
                prompt_unit_price=Decimal("5"),
                prompt_price_unit=Decimal("0.000001"),
                prompt_price=Decimal("0.000050"),
                completion_unit_price=Decimal("30"),
                completion_price_unit=Decimal("0.000001"),
                completion_price=Decimal("0.000060"),
                total_price=Decimal("0.000110"),
                latency=0.4,
                time_to_first_token=0.1,
                time_to_generate=0.3,
            ),
            make_usage(
                prompt_tokens=20,
                completion_tokens=3,
                prompt_unit_price=Decimal("5"),
                prompt_price_unit=Decimal("0.000001"),
                prompt_price=Decimal("0.000100"),
                completion_unit_price=Decimal("30"),
                completion_price_unit=Decimal("0.000001"),
                completion_price=Decimal("0.000090"),
                total_price=Decimal("0.000190"),
                latency=0.8,
                time_to_first_token=0.2,
                time_to_generate=0.6,
            ),
        ]
        request_count = 0

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal request_count
            usage = usages[request_count]
            request_count += 1
            return build_stream_response(
                LLMResultChunk(
                    model="demo-model",
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content="done", tool_calls=[]),
                        usage=usage,
                    ),
                )
            )

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )
            _ = await adapter.request(
                [ModelRequest(parts=[UserPromptPart("first")])],
                model_settings=None,
                model_request_parameters=ModelRequestParameters(),
            )
            async with adapter.request_stream(
                [ModelRequest(parts=[UserPromptPart("second")])],
                model_settings=None,
                model_request_parameters=ModelRequestParameters(),
            ) as stream:
                events = [event async for event in stream]

        usage = adapter.accumulated_usage
        self.assertEqual(request_count, 2)
        self.assertTrue(events)
        self.assertIsNotNone(usage)
        assert usage is not None
        self.assertEqual(usage.prompt_tokens, 30)
        self.assertEqual(usage.completion_tokens, 5)
        self.assertEqual(usage.total_tokens, 35)
        self.assertEqual(usage.prompt_price, Decimal("0.000150"))
        self.assertEqual(usage.completion_price, Decimal("0.000150"))
        self.assertEqual(usage.total_price, Decimal("0.000300"))
        self.assertEqual(usage.currency, "USD")
        self.assertAlmostEqual(usage.latency, 1.2)
        self.assertEqual(usage.time_to_first_token, 0.2)
        self.assertEqual(usage.time_to_generate, 0.6)

    async def test_request_stream_records_usage_when_the_consumer_fails_after_stream_eof(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return build_stream_response(*single_text_chunk("adapter response", prompt_tokens=11, completion_tokens=7))

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )
            with self.assertRaises(RuntimeError):
                async with adapter.request_stream(
                    [ModelRequest(parts=[UserPromptPart("hello")])],
                    model_settings=None,
                    model_request_parameters=ModelRequestParameters(),
                ) as stream:
                    events = [event async for event in stream]
                    raise RuntimeError("the run was stopped")

        self.assertTrue(events)
        usage = adapter.accumulated_usage
        self.assertIsNotNone(usage)
        assert usage is not None
        self.assertEqual(usage.prompt_tokens, 11)
        self.assertEqual(usage.completion_tokens, 7)

    async def test_request_records_usage_when_the_response_stream_aborts(self) -> None:
        body = wrap_plugin_daemon_stream_item(single_text_chunk("partial", prompt_tokens=11, completion_tokens=7)[0])

        async def byte_stream():
            yield body.encode("utf-8")
            raise httpx.ReadError("connection lost")

        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                status_code=200,
                headers={"content-type": "text/event-stream"},
                content=byte_stream(),
            )

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )
            with self.assertRaises(ModelHTTPError):
                _ = await adapter.request(
                    [ModelRequest(parts=[UserPromptPart("hello")])],
                    model_settings=None,
                    model_request_parameters=ModelRequestParameters(),
                )

        usage = adapter.accumulated_usage
        self.assertIsNotNone(usage)
        assert usage is not None
        self.assertEqual(usage.prompt_tokens, 11)
        self.assertEqual(usage.completion_tokens, 7)

    async def test_request_accumulates_inflight_usage_on_cancellation_after_a_completed_round(self) -> None:
        completed_chunk = LLMResultChunk(
            model="demo-model",
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content="done"),
                usage=make_usage(
                    prompt_tokens=10,
                    completion_tokens=2,
                    prompt_price=Decimal("0.000050"),
                    completion_price=Decimal("0.000060"),
                    total_price=Decimal("0.000110"),
                ),
            ),
        )
        inflight_chunk = LLMResultChunk(
            model="demo-model",
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content="partial"),
                usage=make_usage(
                    prompt_tokens=20,
                    completion_tokens=3,
                    prompt_price=Decimal("0.000100"),
                    completion_price=Decimal("0.000090"),
                    total_price=Decimal("0.000190"),
                ),
            ),
        )

        for stream in (False, True):
            with self.subTest(stream=stream):
                adapter = await self.cancel_request_after_first_chunk(
                    inflight_chunk, stream=stream, completed_chunk=completed_chunk
                )
                usage = adapter.accumulated_usage
                assert usage is not None
                self.assertEqual(usage.prompt_tokens, 30)
                self.assertEqual(usage.completion_tokens, 5)
                self.assertEqual(usage.total_tokens, 35)
                self.assertEqual(usage.prompt_price, Decimal("0.000150"))
                self.assertEqual(usage.completion_price, Decimal("0.000150"))
                self.assertEqual(usage.total_price, Decimal("0.000300"))

    async def test_request_cancellation_before_usage_leaves_accumulated_usage_unchanged(self) -> None:
        completed_usage = make_usage(prompt_tokens=10, completion_tokens=2, total_price=Decimal("0.000110"))
        completed_chunk = LLMResultChunk(
            model="demo-model",
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content="done"),
                usage=completed_usage,
            ),
        )
        text_chunk = LLMResultChunk(
            model="demo-model",
            delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="partial")),
        )

        for stream in (False, True):
            for with_previous_usage in (False, True):
                with self.subTest(stream=stream, with_previous_usage=with_previous_usage):
                    adapter = await self.cancel_request_after_first_chunk(
                        text_chunk,
                        stream=stream,
                        completed_chunk=completed_chunk if with_previous_usage else None,
                    )
                    self.assertEqual(adapter.accumulated_usage, completed_usage if with_previous_usage else None)

    async def test_request_falls_back_to_tool_name_when_description_is_missing(self) -> None:
        """Some providers (e.g. Bedrock's Converse API) reject an empty toolSpec description."""
        messages: list[ModelMessage] = [ModelRequest(parts=[UserPromptPart("hello")])]
        request_parameters = ModelRequestParameters(
            function_tools=[
                ToolDefinition(
                    name="weather",
                    description=None,
                    parameters_json_schema={"type": "object", "properties": {}},
                )
            ],
        )

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content.decode("utf-8"))
            tools_by_name = {tool["name"]: tool for tool in payload["target"]["tools"]}
            self.assertEqual(tools_by_name["weather"]["description"], "weather")
            return build_stream_response(
                LLMResultChunk(
                    model="demo-model",
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content="ok", tool_calls=[]),
                        usage=make_usage(prompt_tokens=1, completion_tokens=1),
                    ),
                )
            )

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )
            await adapter.request(messages, model_settings=None, model_request_parameters=request_parameters)

    async def test_request_merges_system_messages_before_history(self) -> None:
        messages = [
            ModelRequest(parts=[UserPromptPart("previous user")]),
            ModelResponse(parts=[TextPart(content="previous answer")]),
            ModelRequest(parts=[SystemPromptPart("current system"), UserPromptPart("current user")]),
        ]
        request_parameters = ModelRequestParameters(instruction_parts=[InstructionPart(content="runtime instruction")])

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content.decode("utf-8"))
            prompt_messages = payload["target"]["prompt_messages"]

            self.assertEqual(
                [message["role"] for message in prompt_messages],
                ["system", "user", "assistant", "user"],
            )
            self.assertEqual(prompt_messages[0]["content"], "current system\n\nruntime instruction")
            self.assertEqual(prompt_messages[1]["content"], "previous user")
            self.assertEqual(prompt_messages[2]["content"], "previous answer")
            self.assertEqual(prompt_messages[3]["content"], "current user")
            return build_stream_response(*single_text_chunk("adapter response", prompt_tokens=11, completion_tokens=7))

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )

            response = await adapter.request(
                messages,
                model_settings=None,
                model_request_parameters=request_parameters,
            )

        self.assertEqual(response.model_name, "demo-model")
        self.assertEqual(cast(TextPart, response.parts[0]).content, "adapter response")

    async def test_request_merges_scattered_system_messages_without_instructions(self) -> None:
        messages = [
            ModelRequest(parts=[SystemPromptPart("first system"), UserPromptPart("hello")]),
            ModelResponse(parts=[TextPart(content="answer")]),
            ModelRequest(parts=[SystemPromptPart("second system"), UserPromptPart("follow up")]),
        ]

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content.decode("utf-8"))
            prompt_messages = payload["target"]["prompt_messages"]

            self.assertEqual(
                [message["role"] for message in prompt_messages],
                ["system", "user", "assistant", "user"],
            )
            self.assertEqual(prompt_messages[0]["content"], "first system\n\nsecond system")
            return build_stream_response(*single_text_chunk("adapter response", prompt_tokens=11, completion_tokens=7))

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )

            response = await adapter.request(
                messages,
                model_settings=None,
                model_request_parameters=ModelRequestParameters(),
            )

        self.assertEqual(response.model_name, "demo-model")
        self.assertEqual(cast(TextPart, response.parts[0]).content, "adapter response")

    async def test_request_maps_tool_call_only_assistant_history_to_empty_string_content(self) -> None:
        messages = [
            ModelRequest(parts=[SystemPromptPart("request system"), UserPromptPart("hello")]),
            ModelResponse(
                parts=[
                    ToolCallPart(
                        tool_name="weather",
                        args='{"city":"Paris"}',
                        tool_call_id="tool-1",
                    )
                ]
            ),
            ModelRequest(
                parts=[
                    ToolReturnPart(
                        tool_name="weather",
                        content={"temperature": "18C"},
                        tool_call_id="tool-1",
                    )
                ]
            ),
        ]

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content.decode("utf-8"))
            prompt_messages = payload["target"]["prompt_messages"]

            self.assertEqual([message["role"] for message in prompt_messages], ["system", "user", "assistant", "tool"])
            self.assertEqual(prompt_messages[2]["content"], "")
            self.assertEqual(prompt_messages[2]["tool_calls"][0]["id"], "tool-1")
            self.assertEqual(prompt_messages[2]["tool_calls"][0]["type"], "function")
            self.assertEqual(prompt_messages[2]["tool_calls"][0]["function"]["name"], "weather")
            self.assertEqual(prompt_messages[2]["tool_calls"][0]["function"]["arguments"], '{"city":"Paris"}')
            self.assertEqual(prompt_messages[3]["tool_call_id"], "tool-1")

            return build_stream_response(*single_text_chunk("adapter response", prompt_tokens=11, completion_tokens=7))

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )

            response = await adapter.request(
                messages,
                model_settings=None,
                model_request_parameters=ModelRequestParameters(),
            )

        self.assertEqual(response.model_name, "demo-model")
        self.assertEqual(response.parts[0].part_kind, "text")
        self.assertEqual(cast(TextPart, response.parts[0]).content, "adapter response")

    async def test_request_uses_unique_fallback_ids_for_same_name_tool_calls(self) -> None:
        messages = [
            ModelRequest(parts=[UserPromptPart("hello")]),
            ModelResponse(
                parts=[
                    ToolCallPart(tool_name="lookup", args={"query": "first"}, tool_call_id=""),
                    ToolCallPart(tool_name="lookup", args={"query": "second"}, tool_call_id=""),
                ]
            ),
        ]

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content.decode("utf-8"))
            prompt_messages = payload["target"]["prompt_messages"]
            tool_calls = prompt_messages[1]["tool_calls"]

            self.assertEqual(tool_calls[0]["id"], "tool-call-0-lookup")
            self.assertEqual(tool_calls[1]["id"], "tool-call-1-lookup")

            return build_stream_response(*single_text_chunk("adapter response", prompt_tokens=11, completion_tokens=7))

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )

            response = await adapter.request(
                messages,
                model_settings=None,
                model_request_parameters=ModelRequestParameters(),
            )

        self.assertEqual(response.model_name, "demo-model")
        self.assertEqual(response.parts[0].part_kind, "text")
        self.assertEqual(cast(TextPart, response.parts[0]).content, "adapter response")

    async def test_request_collapses_text_only_assistant_history_parts_to_string_content(self) -> None:
        messages = [
            ModelRequest(parts=[UserPromptPart("initial request")]),
            ModelResponse(
                parts=[
                    ThinkingPart(content="plan"),
                    TextPart(content="answer"),
                ]
            ),
            ModelRequest(parts=[UserPromptPart("follow up")]),
        ]

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content.decode("utf-8"))
            prompt_messages = payload["target"]["prompt_messages"]

            self.assertEqual([message["role"] for message in prompt_messages], ["user", "assistant", "user"])
            self.assertEqual(prompt_messages[1]["content"], "<think>\nplan\n</think>answer")

            return build_stream_response(*single_text_chunk("adapter response", prompt_tokens=11, completion_tokens=7))

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )

            response = await adapter.request(
                messages,
                model_settings=None,
                model_request_parameters=ModelRequestParameters(),
            )

        self.assertEqual(response.model_name, "demo-model")
        self.assertEqual(response.parts[0].part_kind, "text")
        self.assertEqual(cast(TextPart, response.parts[0]).content, "adapter response")

    async def test_request_omits_empty_assistant_history_when_response_has_no_content_or_tool_calls(self) -> None:
        messages = [
            ModelRequest(parts=[SystemPromptPart("request system"), UserPromptPart("hello")]),
            ModelResponse(parts=[]),
            ModelRequest(parts=[UserPromptPart("follow up")]),
        ]

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content.decode("utf-8"))
            prompt_messages = payload["target"]["prompt_messages"]

            self.assertEqual([message["role"] for message in prompt_messages], ["system", "user", "user"])
            self.assertEqual(prompt_messages[2]["content"], "follow up")

            return build_stream_response(*single_text_chunk("adapter response", prompt_tokens=11, completion_tokens=7))

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )

            response = await adapter.request(
                messages,
                model_settings=None,
                model_request_parameters=ModelRequestParameters(),
            )

        self.assertEqual(response.model_name, "demo-model")
        self.assertEqual(response.parts[0].part_kind, "text")
        self.assertEqual(cast(TextPart, response.parts[0]).content, "adapter response")

    async def test_provider_does_not_close_external_http_client(self) -> None:
        http_client = httpx.AsyncClient(trust_env=False)
        provider = self.make_provider(http_client=http_client)

        self.assertEqual(provider.name, "DifyAPI/langgenius/openai")
        self.assertIs(provider.client.http_client, http_client)
        async with provider:
            pass

        self.assertFalse(http_client.is_closed)
        await http_client.aclose()

    async def test_request_returns_a_response(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return build_stream_response(*single_text_chunk("adapter response", prompt_tokens=11, completion_tokens=7))

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )

            response = await adapter.request(
                [ModelRequest(parts=[UserPromptPart("hello")])],
                model_settings=None,
                model_request_parameters=ModelRequestParameters(),
            )

        self.assertEqual(response.model_name, "demo-model")
        self.assertEqual(response.parts[0].part_kind, "text")
        self.assertEqual(cast(TextPart, response.parts[0]).content, "adapter response")
        self.assertEqual(response.usage.input_tokens, 11)
        self.assertEqual(response.usage.output_tokens, 7)

    async def test_request_stream_closes_gateway_body_after_natural_eof_and_records_usage(self) -> None:
        body = _TrackingResponseBody(_stream_lifecycle_payloads())
        adapter = self.make_streaming_adapter(body)

        async with adapter.request_stream(
            [ModelRequest(parts=[UserPromptPart("hello")])],
            model_settings=None,
            model_request_parameters=ModelRequestParameters(),
        ) as stream:
            events = [event async for event in stream]

        self.assertTrue(events)
        self.assertEqual(body.close_count, 1)
        usage = adapter.accumulated_usage
        self.assertIsNotNone(usage)
        assert usage is not None
        self.assertEqual(usage.prompt_tokens, 6)
        self.assertEqual(usage.completion_tokens, 4)

    async def test_request_stream_closes_gateway_body_after_consumer_error_without_masking_it(self) -> None:
        body = _TrackingResponseBody(
            _stream_lifecycle_payloads(usage_in_first_chunk=True),
            close_error=RuntimeError("gateway response close failed"),
        )
        adapter = self.make_streaming_adapter(body)
        original_error = RuntimeError("consumer failed")

        with self.assertRaises(RuntimeError) as context:
            async with adapter.request_stream(
                [ModelRequest(parts=[UserPromptPart("hello")])],
                model_settings=None,
                model_request_parameters=ModelRequestParameters(),
            ) as stream:
                event_count = 0
                async for _event in stream:
                    event_count += 1
                    break
                self.assertEqual(event_count, 1)
                self.assertEqual(stream.usage.input_tokens, 6)
                raise original_error

        self.assertIs(context.exception, original_error)
        self.assertEqual(body.close_count, 1)
        self.assertIn("gateway response close failed", "\n".join(original_error.__notes__))
        self.assertEqual(adapter.accumulated_usage, make_usage(prompt_tokens=6, completion_tokens=4))

    async def test_request_stream_closes_gateway_body_when_cancelled(self) -> None:
        for close_error in (None, RuntimeError("gateway response close failed")):
            with self.subTest(close_error=close_error):
                body = _TrackingResponseBody(
                    _stream_lifecycle_payloads(usage_in_first_chunk=True),
                    close_error=close_error,
                )
                adapter = self.make_streaming_adapter(body)
                started = asyncio.Event()
                # Keep a strong reference so CPython GC cannot hide missing deterministic cleanup.
                held_streams: list[object] = []

                async def consume_until_cancelled() -> None:
                    async with adapter.request_stream(
                        [ModelRequest(parts=[UserPromptPart("hello")])],
                        model_settings=None,
                        model_request_parameters=ModelRequestParameters(),
                    ) as stream:
                        held_streams.append(stream)
                        event_count = 0
                        async for _event in stream:
                            event_count += 1
                            break
                        self.assertEqual(event_count, 1)
                        self.assertEqual(stream.usage.input_tokens, 6)
                        started.set()
                        await asyncio.Event().wait()

                task = asyncio.create_task(consume_until_cancelled())
                await asyncio.wait_for(started.wait(), timeout=1)
                task.cancel()
                with self.assertRaises(asyncio.CancelledError) as context:
                    await task

                self.assertTrue(task.cancelled())
                self.assertTrue(held_streams)
                self.assertEqual(body.close_count, 1)
                self.assertEqual(adapter.accumulated_usage, make_usage(prompt_tokens=6, completion_tokens=4))
                if close_error is not None:
                    self.assertIn(str(close_error), "\n".join(context.exception.__notes__))

    async def test_request_stream_closes_gateway_body_after_caller_breaks(self) -> None:
        for usage_in_first_chunk in (False, True):
            with self.subTest(usage_in_first_chunk=usage_in_first_chunk):
                body = _TrackingResponseBody(_stream_lifecycle_payloads(usage_in_first_chunk=usage_in_first_chunk))
                adapter = self.make_streaming_adapter(body)
                event_count = 0

                async with adapter.request_stream(
                    [ModelRequest(parts=[UserPromptPart("hello")])],
                    model_settings=None,
                    model_request_parameters=ModelRequestParameters(),
                ) as stream:
                    async for _event in stream:
                        event_count += 1
                        break

                self.assertEqual(event_count, 1)
                self.assertEqual(body.close_count, 1)
                if usage_in_first_chunk:
                    self.assertEqual(adapter.accumulated_usage, make_usage(prompt_tokens=6, completion_tokens=4))
                else:
                    self.assertIsNone(adapter.accumulated_usage)

    async def test_request_stream_propagates_gateway_close_error_after_caller_breaks(self) -> None:
        close_errors = [
            (RuntimeError("gateway response close failed on caller break"), RuntimeError, None),
            (httpx.ReadError("gateway response close failed on caller break"), ModelHTTPError, 503),
            (httpx.ReadTimeout("gateway response close timed out on caller break"), ModelHTTPError, 504),
        ]
        for close_error, error_type, status_code in close_errors:
            with self.subTest(close_error=close_error):
                body = _TrackingResponseBody(
                    _stream_lifecycle_payloads(usage_in_first_chunk=True),
                    close_error=close_error,
                )
                adapter = self.make_streaming_adapter(body)

                with self.assertRaises(error_type) as context:
                    async with adapter.request_stream(
                        [ModelRequest(parts=[UserPromptPart("hello")])],
                        model_settings=None,
                        model_request_parameters=ModelRequestParameters(),
                    ) as stream:
                        event_count = 0
                        async for _event in stream:
                            event_count += 1
                            break
                        self.assertEqual(event_count, 1)
                        self.assertEqual(stream.usage.input_tokens, 6)

                if isinstance(context.exception, ModelHTTPError):
                    self.assertEqual(context.exception.status_code, status_code)
                    self.assertIs(context.exception.__cause__, close_error)
                else:
                    self.assertIs(context.exception, close_error)
                self.assertEqual(body.close_count, 1)
                self.assertEqual(adapter.accumulated_usage, make_usage(prompt_tokens=6, completion_tokens=4))

    async def test_request_closes_gateway_body_after_mapping_error_without_masking_it(self) -> None:
        chunk = LLMResultChunk(
            model="demo-model",
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(
                    content=[
                        ImagePromptMessageContent(
                            format="png",
                            mime_type="image/png",
                            url="https://example.com/assistant.png",
                        )
                    ],
                ),
                usage=make_usage(),
            ),
        )
        for close_error in (None, RuntimeError("gateway response close failed")):
            with self.subTest(close_error=close_error):
                body = _TrackingResponseBody([build_stream_response(chunk).content], close_error=close_error)
                adapter = self.make_streaming_adapter(body)

                with self.assertRaisesRegex(UnexpectedModelBehavior, "URL-based assistant multimodal") as context:
                    await adapter.request(
                        [ModelRequest(parts=[UserPromptPart("hello")])],
                        model_settings=None,
                        model_request_parameters=ModelRequestParameters(),
                    )

                self.assertEqual(body.close_count, 1)
                self.assertEqual(adapter.accumulated_usage, make_usage())
                if close_error is not None:
                    self.assertIn(str(close_error), "\n".join(context.exception.__notes__))

    async def test_request_preserves_cancellation_while_waiting_for_gateway_data(self) -> None:
        for stream_response in (False, True):
            for close_error in (None, RuntimeError("gateway response close failed")):
                with self.subTest(stream=stream_response, close_error=close_error):
                    read_started = asyncio.Event()

                    class WaitingResponseBody(_TrackingResponseBody):
                        async def __aiter__(self) -> AsyncGenerator[bytes, None]:
                            async for payload in super().__aiter__():
                                yield payload
                            read_started.set()
                            await asyncio.Event().wait()

                    body = WaitingResponseBody(
                        _stream_lifecycle_payloads(usage_in_first_chunk=True)[:1],
                        close_error=close_error,
                    )
                    adapter = self.make_streaming_adapter(body)
                    # Keep a strong reference so CPython GC cannot hide missing deterministic cleanup.
                    held_streams: list[object] = []

                    async def consume_until_cancelled() -> None:
                        messages = [ModelRequest(parts=[UserPromptPart("hello")])]
                        if stream_response:
                            async with adapter.request_stream(messages, None, ModelRequestParameters()) as stream:
                                held_streams.append(stream)
                                async for _event in stream:
                                    self.assertEqual(stream.usage.input_tokens, 6)
                        else:
                            await adapter.request(messages, None, ModelRequestParameters())

                    task = asyncio.create_task(consume_until_cancelled())
                    await asyncio.wait_for(read_started.wait(), timeout=1)
                    task.cancel()
                    with self.assertRaises(asyncio.CancelledError) as context:
                        await task

                    self.assertTrue(task.cancelled())
                    self.assertEqual(body.close_count, 1)
                    self.assertEqual(adapter.accumulated_usage, make_usage(prompt_tokens=6, completion_tokens=4))
                    if close_error is not None:
                        self.assertIn(str(close_error), "\n".join(context.exception.__notes__))

    async def test_request_preserves_gateway_error_when_closing_also_fails(self) -> None:
        payloads = [
            (build_stream_error("UnknownProviderError", "gateway failed").content, ModelAPIError, "gateway failed"),
            (build_stream_error("InvokeRateLimitError", "too many").content, ModelHTTPError, "too many"),
            (b'data: {"code": 0, "message": "", "data": null}\n\n', UnexpectedModelBehavior, "empty stream item"),
        ]
        for payload, error_type, message in payloads:
            with self.subTest(error_type=error_type):
                close_error = RuntimeError("gateway response close failed")
                body = _TrackingResponseBody(
                    [_stream_lifecycle_payloads(usage_in_first_chunk=True)[0], payload],
                    close_error=close_error,
                )
                adapter = self.make_streaming_adapter(body)

                with self.assertRaisesRegex(error_type, message) as context:
                    await adapter.request(
                        [ModelRequest(parts=[UserPromptPart("hello")])],
                        None,
                        ModelRequestParameters(),
                    )

                self.assertEqual(body.close_count, 1)
                self.assertIn(str(close_error), "\n".join(context.exception.__notes__))
                self.assertEqual(adapter.accumulated_usage, make_usage(prompt_tokens=6, completion_tokens=4))

    async def test_request_stream_propagates_cancellation_arriving_during_cleanup(self) -> None:
        for failure_source in ("consumer", "gateway"):
            with self.subTest(failure_source=failure_source):
                close_started = asyncio.Event()

                class ClosingResponseBody(_TrackingResponseBody):
                    async def aclose(self) -> None:
                        self.close_count += 1
                        close_started.set()
                        await asyncio.Event().wait()

                payloads = _stream_lifecycle_payloads(usage_in_first_chunk=True)
                if failure_source == "gateway":
                    payloads[1] = build_stream_error("UnknownProviderError", "gateway failed").content
                body = ClosingResponseBody(payloads)
                adapter = self.make_streaming_adapter(body)
                # Keep a strong reference so CPython GC cannot hide missing deterministic cleanup.
                held_streams: list[object] = []

                async def consume_until_cleanup() -> None:
                    async with adapter.request_stream(
                        [ModelRequest(parts=[UserPromptPart("hello")])], None, ModelRequestParameters()
                    ) as stream:
                        held_streams.append(stream)
                        async for _event in stream:
                            self.assertEqual(stream.usage.input_tokens, 6)
                            if failure_source == "consumer":
                                raise RuntimeError("consumer failed")

                task = asyncio.create_task(consume_until_cleanup())
                await asyncio.wait_for(close_started.wait(), timeout=1)
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task

                self.assertTrue(task.cancelled())
                self.assertTrue(held_streams)
                self.assertEqual(body.close_count, 1)
                self.assertEqual(adapter.accumulated_usage, make_usage(prompt_tokens=6, completion_tokens=4))

    async def test_request_stream_splits_embedded_thinking_tags_from_text_content_parts(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return build_stream_response(
                LLMResultChunk(
                    model="demo-model",
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(
                            content=[TextPromptMessageContent(data="before<think>reasoning")],
                            tool_calls=[],
                        ),
                    ),
                ),
                LLMResultChunk(
                    model="demo-model",
                    delta=LLMResultChunkDelta(
                        index=1,
                        message=AssistantPromptMessage(
                            content=[TextPromptMessageContent(data=" continues</think>after")],
                            tool_calls=[],
                        ),
                    ),
                ),
                LLMResultChunk(
                    model="demo-model",
                    delta=LLMResultChunkDelta(
                        index=2,
                        message=AssistantPromptMessage(content="", tool_calls=[]),
                        usage=make_usage(prompt_tokens=6, completion_tokens=4),
                        finish_reason="stop",
                    ),
                ),
            )

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )

            async with adapter.request_stream(
                [ModelRequest(parts=[UserPromptPart("hello")])],
                model_settings=None,
                model_request_parameters=ModelRequestParameters(),
            ) as stream:
                events = [event async for event in stream]
                response = stream.get()

        self.assertTrue(events)
        self.assertEqual([part.part_kind for part in response.parts], ["text", "thinking", "text"])
        self.assertEqual(cast(TextPart, response.parts[0]).content, "before")
        self.assertEqual(cast(ThinkingPart, response.parts[1]).content, "reasoning continues")
        self.assertEqual(cast(TextPart, response.parts[2]).content, "after")

    async def test_request_stream_yields_response_parts_and_usage(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return build_stream_response(
                LLMResultChunk(
                    model="demo-model",
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content="hello ", tool_calls=[]),
                    ),
                ),
                _tool_chunk(_tool_call("weather", '{"city":"Paris"}', call_id="call-1")),
                LLMResultChunk(
                    model="demo-model",
                    delta=LLMResultChunkDelta(
                        index=2,
                        message=AssistantPromptMessage(content="world", tool_calls=[]),
                        usage=make_usage(prompt_tokens=6, completion_tokens=4),
                        finish_reason="tool_calls",
                    ),
                ),
            )

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )

            async with adapter.request_stream(
                [ModelRequest(parts=[UserPromptPart("hello")])],
                model_settings=None,
                model_request_parameters=ModelRequestParameters(),
            ) as stream:
                events = [event async for event in stream]
                response = stream.get()

        self.assertTrue(events)
        self.assertEqual(response.usage.input_tokens, 6)
        self.assertEqual(response.usage.output_tokens, 4)
        self.assertEqual(response.finish_reason, "tool_call")
        self.assertEqual([part.part_kind for part in response.parts], ["text", "tool-call", "text"])
        self.assertEqual(cast(TextPart, response.parts[0]).content, "hello ")
        self.assertEqual(response.tool_calls[0].tool_name, "weather")
        self.assertEqual(cast(TextPart, response.parts[2]).content, "world")

    async def test_request_stream_assigns_fallback_ids_to_tool_calls_without_ids(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return build_stream_response(
                _tool_chunk(_tool_call("shell_run", '{"script":"lookup find"}', call_id=None), index=0),
                _tool_chunk(_tool_call("shell_run", '{"script":"lookup out"}', call_id=None), index=1),
            )

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )

            async with adapter.request_stream(
                [ModelRequest(parts=[UserPromptPart("hello")])],
                model_settings=None,
                model_request_parameters=ModelRequestParameters(),
            ) as stream:
                events = [event async for event in stream]
                response = stream.get()

        self.assertTrue(events)
        self.assertEqual([part.part_kind for part in response.parts], ["tool-call", "tool-call"])
        self.assertEqual([part.tool_call_id for part in response.tool_calls], ["chunk-0-tool-0", "chunk-1-tool-0"])
        self.assertEqual(
            [part.args for part in response.tool_calls],
            ['{"script":"lookup find"}', '{"script":"lookup out"}'],
        )
        self.assertEqual([part.provider_details for part in response.tool_calls], [None, None])

    async def test_request_stream_keeps_parallel_tool_calls_that_share_a_plugin_id(self) -> None:
        # Some plugins (e.g. Tongyi, or Ollama when the server omits ids) use the function name as the id.
        def handler(_request: httpx.Request) -> httpx.Response:
            return build_stream_response(
                _tool_chunk(
                    _tool_call("lookup", '{"query":"first"}'),
                    _tool_call("lookup", '{"query":"second"}'),
                    _tool_call("lookup", '{"query":"third"}'),
                ),
            )

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            response = await self.invoke_adapter([ModelRequest(parts=[UserPromptPart("hello")])], stream=True)

        self.assertEqual([part.part_kind for part in response.parts], ["tool-call", "tool-call", "tool-call"])
        self.assertEqual([part.tool_call_id for part in response.tool_calls], ["lookup", "lookup-2", "lookup-3"])
        self.assertEqual(
            [part.args for part in response.tool_calls],
            ['{"query":"first"}', '{"query":"second"}', '{"query":"third"}'],
        )
        self.assertEqual(
            [part.provider_details for part in response.tool_calls],
            [
                None,
                {"dify_provider_tool_call_id": "lookup"},
                {"dify_provider_tool_call_id": "lookup"},
            ],
        )

    async def test_request_stream_updates_reemitted_tool_call_lists_in_place(self) -> None:
        # Cumulative list plugins re-send every call seen so far on each chunk, updating arguments in place.
        scenarios: list[
            tuple[
                str,
                list[ModelMessage],
                list[str],
                list[dict[str, object] | None],
            ]
        ] = [
            (
                "fresh_history",
                [ModelRequest(parts=[UserPromptPart("hello")])],
                ["plugin-call", "plugin-call-2"],
                [None, {"dify_provider_tool_call_id": "plugin-call"}],
            ),
            (
                "history_occupies_first_slot",
                [
                    ModelRequest(parts=[UserPromptPart("earlier")]),
                    ModelResponse(
                        parts=[
                            ToolCallPart(tool_name="search_docs", args='{"query":"old"}', tool_call_id="plugin-call")
                        ]
                    ),
                    ModelRequest(
                        parts=[
                            ToolReturnPart(tool_name="search_docs", content="old result", tool_call_id="plugin-call"),
                            UserPromptPart("follow up"),
                        ]
                    ),
                ],
                ["plugin-call-2", "plugin-call-3"],
                [
                    {"dify_provider_tool_call_id": "plugin-call"},
                    {"dify_provider_tool_call_id": "plugin-call"},
                ],
            ),
        ]

        def handler(_request: httpx.Request) -> httpx.Response:
            return build_stream_response(
                _tool_chunk(_tool_call("search_docs", '{"query":"first-draft"}', call_id="plugin-call"), index=0),
                _tool_chunk(
                    _tool_call("search_docs", '{"query":"first-v2"}', call_id="plugin-call"),
                    _tool_call("search_docs", '{"query":"second-draft"}', call_id="plugin-call"),
                    index=1,
                ),
                _tool_chunk(
                    _tool_call("search_docs", '{"query":"first-final"}', call_id="plugin-call"),
                    _tool_call("search_docs", '{"query":"second-final"}', call_id="plugin-call"),
                    index=2,
                ),
            )

        for label, messages, expected_ids, expected_details in scenarios:
            with self.subTest(case=label):
                async with self.mock_gateway_stream(httpx.MockTransport(handler)):
                    response = await self.invoke_adapter(messages, stream=True)

                self.assertEqual(len(response.tool_calls), 2)
                self.assertEqual([part.tool_call_id for part in response.tool_calls], expected_ids)
                self.assertEqual(
                    [part.args for part in response.tool_calls],
                    ['{"query":"first-final"}', '{"query":"second-final"}'],
                )
                self.assertEqual([part.provider_details for part in response.tool_calls], expected_details)

    async def test_tool_call_id_allocation_avoids_single_and_cross_chunk_suffix_collisions(self) -> None:
        scenarios: list[
            tuple[
                str,
                list[LLMResultChunk],
                list[str],
                list[str | dict[str, object] | None],
                list[dict[str, object] | None],
            ]
        ] = [
            (
                "single_chunk_trailing_explicit_suffix",
                [
                    _tool_chunk(
                        _tool_call("search_docs", '{"query":"first"}', call_id="call-a"),
                        _tool_call("search_docs", '{"query":"second"}', call_id="call-a"),
                        _tool_call("search_docs", '{"query":"third"}', call_id="call-a-2"),
                    )
                ],
                ["call-a", "call-a-3", "call-a-2"],
                ['{"query":"first"}', '{"query":"second"}', '{"query":"third"}'],
                [None, {"dify_provider_tool_call_id": "call-a"}, None],
            ),
            (
                "single_chunk_leading_explicit_suffix",
                [
                    _tool_chunk(
                        _tool_call("search_docs", '{"query":"first"}', call_id="call-a-2"),
                        _tool_call("search_docs", '{"query":"second"}', call_id="call-a"),
                        _tool_call("search_docs", '{"query":"third"}', call_id="call-a"),
                    )
                ],
                ["call-a-2", "call-a", "call-a-3"],
                ['{"query":"first"}', '{"query":"second"}', '{"query":"third"}'],
                [None, None, {"dify_provider_tool_call_id": "call-a"}],
            ),
            (
                "cross_chunk_independent_explicit_suffix",
                [
                    _tool_chunk(
                        _tool_call("search_docs", '{"query":"first"}', call_id="call-a"),
                        _tool_call("search_docs", '{"query":"second"}', call_id="call-a"),
                        index=0,
                    ),
                    _tool_chunk(_tool_call("search_docs", '{"query":"third-draft"}', call_id="call-a-2"), index=1),
                    _tool_chunk(_tool_call("search_docs", '{"query":"third"}', call_id="call-a-2"), index=2),
                ],
                ["call-a", "call-a-2", "call-a-2-2"],
                ['{"query":"first"}', '{"query":"second"}', '{"query":"third"}'],
                [
                    None,
                    {"dify_provider_tool_call_id": "call-a"},
                    {"dify_provider_tool_call_id": "call-a-2"},
                ],
            ),
            (
                "cross_chunk_cumulative_explicit_suffix",
                [
                    _tool_chunk(
                        _tool_call("search_docs", '{"query":"first-v1"}', call_id="call-a"),
                        _tool_call("search_docs", '{"query":"second-v1"}', call_id="call-a"),
                        index=0,
                    ),
                    _tool_chunk(
                        _tool_call("search_docs", '{"query":"first-v2"}', call_id="call-a"),
                        _tool_call("search_docs", '{"query":"second-v2"}', call_id="call-a"),
                        _tool_call("search_docs", '{"query":"third"}', call_id="call-a-2"),
                        index=1,
                    ),
                ],
                ["call-a", "call-a-2", "call-a-2-2"],
                ['{"query":"first-v2"}', '{"query":"second-v2"}', '{"query":"third"}'],
                [
                    None,
                    {"dify_provider_tool_call_id": "call-a"},
                    {"dify_provider_tool_call_id": "call-a-2"},
                ],
            ),
        ]

        for label, chunks, expected_ids, expected_args, expected_details in scenarios:
            for stream in (False, True):
                with self.subTest(case=label, stream=stream):

                    def handler(
                        _request: httpx.Request, *, response_chunks: list[LLMResultChunk] = chunks
                    ) -> httpx.Response:
                        return build_stream_response(*response_chunks)

                    async with self.mock_gateway_stream(httpx.MockTransport(handler)):
                        response = await self.invoke_adapter(
                            [ModelRequest(parts=[UserPromptPart("hello")])], stream=stream
                        )

                    self.assertEqual([part.tool_call_id for part in response.tool_calls], expected_ids)
                    self.assertEqual([part.args for part in response.tool_calls], expected_args)
                    self.assertEqual([part.provider_details for part in response.tool_calls], expected_details)

    async def test_tool_call_id_allocation_avoids_missing_id_and_history_collisions(self) -> None:
        prior_history: list[ModelMessage] = [
            ModelRequest(parts=[UserPromptPart("first turn")]),
            ModelResponse(
                parts=[
                    ToolCallPart(tool_name="shell_run", args='{"script":"old"}', tool_call_id="chunk-0-tool-0"),
                    ToolCallPart(tool_name="search_docs", args='{"query":"old-1"}', tool_call_id="call-a"),
                    ToolCallPart(
                        tool_name="search_docs",
                        args='{"query":"old-2"}',
                        tool_call_id="call-a-2",
                        provider_details={"dify_provider_tool_call_id": "call-a"},
                    ),
                ]
            ),
            ModelRequest(
                parts=[
                    ToolReturnPart(tool_name="shell_run", content="ok", tool_call_id="chunk-0-tool-0"),
                    ToolReturnPart(tool_name="search_docs", content="r1", tool_call_id="call-a"),
                    ToolReturnPart(tool_name="search_docs", content="r2", tool_call_id="call-a-2"),
                    UserPromptPart("second turn"),
                ]
            ),
        ]

        for stream in (False, True):
            with self.subTest(case="same_chunk_fallback_collision", stream=stream):

                def same_chunk_handler(_request: httpx.Request) -> httpx.Response:
                    return build_stream_response(
                        _tool_chunk(
                            _tool_call("shell_run", '{"script":"first"}', call_id=None),
                            _tool_call("shell_run", '{"script":"second"}', call_id="chunk-0-tool-0"),
                        )
                    )

                async with self.mock_gateway_stream(httpx.MockTransport(same_chunk_handler)):
                    response = await self.invoke_adapter([ModelRequest(parts=[UserPromptPart("hello")])], stream=stream)

                self.assertEqual(
                    [part.tool_call_id for part in response.tool_calls],
                    ["chunk-0-tool-0-2", "chunk-0-tool-0"],
                )
                self.assertEqual([part.provider_details for part in response.tool_calls], [None, None])

            with self.subTest(case="history_fallback_and_plugin_id_collision", stream=stream):

                def history_handler(_request: httpx.Request) -> httpx.Response:
                    return build_stream_response(
                        _tool_chunk(
                            _tool_call("shell_run", '{"script":"next"}', call_id=None),
                            _tool_call("search_docs", '{"query":"next"}', call_id="call-a"),
                        )
                    )

                async with self.mock_gateway_stream(httpx.MockTransport(history_handler)):
                    response = await self.invoke_adapter(prior_history, stream=stream)

                self.assertEqual(
                    [part.tool_call_id for part in response.tool_calls],
                    ["chunk-0-tool-0-2", "call-a-3"],
                )
                self.assertEqual(
                    [part.provider_details for part in response.tool_calls],
                    [None, {"dify_provider_tool_call_id": "call-a"}],
                )

    async def test_request_restores_and_scopes_renamed_plugin_ids_across_turns(self) -> None:
        # Keep tool_name, dify_provider_tool_call_id, and internal renamed tool_call_id distinct,
        # and verify a later unrenamed response reusing the same string is not rewritten by earlier state.
        messages: list[ModelMessage] = [
            ModelRequest(parts=[UserPromptPart("hello")]),
            ModelResponse(
                parts=[
                    ToolCallPart(tool_name="search_docs", args='{"query":"first"}', tool_call_id="plugin-call"),
                    ToolCallPart(
                        tool_name="search_docs",
                        args='{"query":"second"}',
                        tool_call_id="plugin-call-2",
                        provider_name="dify",
                        provider_details={"dify_provider_tool_call_id": "plugin-call"},
                    ),
                    ToolCallPart(
                        tool_name="search_docs",
                        args='{"query":"third"}',
                        tool_call_id="plugin-call-3",
                        provider_name="dify",
                        provider_details={"dify_provider_tool_call_id": "plugin-call"},
                    ),
                ]
            ),
            ModelRequest(
                parts=[
                    ToolReturnPart(tool_name="search_docs", content="first result", tool_call_id="plugin-call"),
                    ToolReturnPart(tool_name="search_docs", content="second result", tool_call_id="plugin-call-2"),
                    RetryPromptPart(content="bad query", tool_name="search_docs", tool_call_id="plugin-call-3"),
                ]
            ),
            ModelResponse(
                parts=[
                    ToolCallPart(
                        tool_name="fetch_page",
                        args='{"url":"https://example.com"}',
                        tool_call_id="plugin-call-2",
                    )
                ]
            ),
            ModelRequest(
                parts=[
                    ToolReturnPart(tool_name="fetch_page", content="page body", tool_call_id="plugin-call-2"),
                    RetryPromptPart(content="retry fetch", tool_name="fetch_page", tool_call_id="plugin-call-2"),
                ]
            ),
        ]

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content.decode("utf-8"))
            prompt_messages = payload["target"]["prompt_messages"]

            self.assertEqual(
                [message["role"] for message in prompt_messages],
                ["user", "assistant", "tool", "tool", "tool", "assistant", "tool", "tool"],
            )
            self.assertEqual(
                [call["id"] for call in prompt_messages[1]["tool_calls"]],
                ["plugin-call", "plugin-call", "plugin-call"],
            )
            self.assertEqual(
                [call["function"]["name"] for call in prompt_messages[1]["tool_calls"]],
                ["search_docs", "search_docs", "search_docs"],
            )
            self.assertEqual(
                [call["function"]["arguments"] for call in prompt_messages[1]["tool_calls"]],
                ['{"query":"first"}', '{"query":"second"}', '{"query":"third"}'],
            )
            self.assertEqual(
                [message["tool_call_id"] for message in prompt_messages[2:5]],
                ["plugin-call", "plugin-call", "plugin-call"],
            )
            self.assertEqual(
                [message["name"] for message in prompt_messages[2:5]],
                ["search_docs", "search_docs", "search_docs"],
            )
            self.assertEqual([call["id"] for call in prompt_messages[5]["tool_calls"]], ["plugin-call-2"])
            self.assertEqual([call["function"]["name"] for call in prompt_messages[5]["tool_calls"]], ["fetch_page"])
            self.assertEqual(
                [message["tool_call_id"] for message in prompt_messages[6:]],
                ["plugin-call-2", "plugin-call-2"],
            )

            return build_stream_response(*single_text_chunk("adapter response"))

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            response = await self.invoke_adapter(messages, stream=False)

        self.assertEqual(cast(TextPart, response.parts[0]).content, "adapter response")

    async def test_tool_call_id_metadata_survives_model_messages_json_round_trip(self) -> None:
        requests: list[dict[str, object]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(json.loads(request.content.decode("utf-8")))
            if len(requests) == 1:
                return build_stream_response(
                    _tool_chunk(
                        _tool_call("search_docs", '{"query":"first"}', call_id="plugin-call"),
                        _tool_call("search_docs", '{"query":"second"}', call_id="plugin-call"),
                        _tool_call("search_docs", '{"query":"third"}', call_id="plugin-call"),
                    )
                )
            return build_stream_response(
                _tool_chunk(_tool_call("search_docs", '{"query":"fourth"}', call_id="plugin-call"))
            )

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            first_response = await self.invoke_adapter([ModelRequest(parts=[UserPromptPart("hello")])], stream=False)
            history: list[ModelMessage] = [
                ModelRequest(parts=[UserPromptPart("hello")]),
                first_response,
                ModelRequest(
                    parts=[
                        ToolReturnPart(tool_name="search_docs", content="r1", tool_call_id="plugin-call"),
                        ToolReturnPart(tool_name="search_docs", content="r2", tool_call_id="plugin-call-2"),
                        RetryPromptPart(content="bad query", tool_name="search_docs", tool_call_id="plugin-call-3"),
                        UserPromptPart("continue"),
                    ]
                ),
            ]
            restored_history = ModelMessagesTypeAdapter.validate_json(ModelMessagesTypeAdapter.dump_json(history))
            second_response = await self.invoke_adapter(restored_history, stream=False)

        prompt_messages = cast(
            list[dict[str, object]],
            cast(dict[str, object], requests[1]["target"])["prompt_messages"],
        )
        assistant_calls = cast(list[dict[str, object]], prompt_messages[1]["tool_calls"])
        self.assertEqual([call["id"] for call in assistant_calls], ["plugin-call", "plugin-call", "plugin-call"])
        self.assertEqual(
            [message["tool_call_id"] for message in prompt_messages[2:5]],
            ["plugin-call", "plugin-call", "plugin-call"],
        )
        self.assertEqual([part.tool_call_id for part in second_response.tool_calls], ["plugin-call-4"])
        self.assertEqual(
            [part.provider_details for part in second_response.tool_calls],
            [{"dify_provider_tool_call_id": "plugin-call"}],
        )

    async def test_agent_runs_every_parallel_tool_call_that_shares_a_plugin_id(self) -> None:
        requests: list[dict[str, object]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(json.loads(request.content.decode("utf-8")))
            if len(requests) == 1:
                return build_stream_response(
                    _tool_chunk(
                        _tool_call("lookup", '{"query":"first"}'),
                        _tool_call("lookup", '{"query":"second"}'),
                        finish_reason="tool_calls",
                    )
                )
            return build_stream_response(*single_text_chunk("done"))

        seen_queries: list[str] = []

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="ollama",
            )
            agent = Agent(adapter)

            @agent.tool_plain
            async def lookup(query: str) -> str:
                seen_queries.append(query)
                return f"result for {query}"

            result = await agent.run("look up both")

        self.assertEqual(result.output, "done")
        self.assertEqual(sorted(seen_queries), ["first", "second"])
        follow_up = cast(list[dict[str, object]], cast(dict[str, object], requests[1]["target"])["prompt_messages"])
        tool_messages = [message for message in follow_up if message["role"] == "tool"]
        self.assertEqual([message["tool_call_id"] for message in tool_messages], ["lookup", "lookup"])
        self.assertEqual(
            [message["content"] for message in tool_messages],
            ["result for first", "result for second"],
        )

    async def test_agent_compaction_preserves_recent_tool_results_across_repeated_plugin_ids(self) -> None:
        requests: list[dict[str, object]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            step = len(requests)
            requests.append(json.loads(request.content.decode("utf-8")))
            if step < 4:
                return build_stream_response(
                    _tool_chunk(
                        _tool_call("lookup", json.dumps({"query": f"q{step}"})),
                        finish_reason="tool_calls",
                    )
                )
            return build_stream_response(*single_text_chunk("done"))

        capability = build_compaction_capability(context_window_tokens=4_100, model_settings=None)
        assert capability is not None

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            provider = self.make_provider()
            adapter = DifyLLMAdapterModel(
                "demo-model",
                provider,
                model_provider="ollama",
            )
            agent = Agent[Deps, str](adapter, deps_type=Deps, capabilities=[capability])

            @agent.tool_plain
            async def lookup(query: str) -> str:
                return f"{query}-" + ("x" * 4_000)

            deps = Deps(
                layers={},
                services=Services(
                    plugin_daemon_http_client=provider.client.http_client,
                    dify_api_http_client=provider.client.http_client,
                ),
                run_id="run-1",
            )
            result = await agent.run("run four steps", deps=deps)

        self.assertEqual(result.output, "done")
        self.assertEqual(len(requests), 5)

        internal_ids = [
            part.tool_call_id
            for message in result.all_messages()
            if isinstance(message, ModelResponse)
            for part in message.tool_calls
        ]
        self.assertEqual(internal_ids, ["lookup", "lookup-2", "lookup-3", "lookup-4"])

        final_prompt_messages = cast(
            list[dict[str, object]],
            cast(dict[str, object], requests[4]["target"])["prompt_messages"],
        )
        assistant_ids = [
            call["id"]
            for message in final_prompt_messages
            if message["role"] == "assistant"
            for call in cast(list[dict[str, object]], message.get("tool_calls", []))
        ]
        tool_messages = [message for message in final_prompt_messages if message["role"] == "tool"]

        self.assertEqual(assistant_ids, ["lookup", "lookup", "lookup", "lookup"])
        self.assertEqual(
            [message["tool_call_id"] for message in tool_messages], ["lookup", "lookup", "lookup", "lookup"]
        )
        self.assertEqual(
            [message["content"] for message in tool_messages],
            [
                "[tool result cleared]",
                "q1-" + ("x" * 4_000),
                "q2-" + ("x" * 4_000),
                "q3-" + ("x" * 4_000),
            ],
        )

    async def test_request_splits_embedded_thinking_tags_into_parts(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return build_stream_response(*single_text_chunk("before<think>reasoning</think>after"))

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )

            response = await adapter.request(
                [ModelRequest(parts=[UserPromptPart("hello")])],
                model_settings=None,
                model_request_parameters=ModelRequestParameters(),
            )

        self.assertEqual([part.part_kind for part in response.parts], ["text", "thinking", "text"])
        self.assertEqual(cast(TextPart, response.parts[0]).content, "before")
        self.assertEqual(cast(ThinkingPart, response.parts[1]).content, "reasoning")
        self.assertEqual(cast(TextPart, response.parts[2]).content, "after")

    async def test_request_maps_stream_envelope_rate_limit_error_to_http_error(
        self,
    ) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return build_stream_error(
                "PluginInvokeError",
                json.dumps({"error_type": "InvokeRateLimitError", "message": "too many"}),
            )

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )

            with self.assertRaises(ModelHTTPError) as context:
                await adapter.request(
                    [ModelRequest(parts=[UserPromptPart("hello")])],
                    model_settings=None,
                    model_request_parameters=ModelRequestParameters(),
                )

        self.assertEqual(context.exception.status_code, 429)
        self.assertEqual(
            context.exception.body,
            {"error_type": "InvokeRateLimitError", "message": "too many"},
        )

    async def test_request_maps_http_error_payload_to_http_error(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return build_error_response("PluginDaemonUnauthorizedError", "invalid api key", status_code=401)

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )

            with self.assertRaises(ModelHTTPError) as context:
                await adapter.request(
                    [ModelRequest(parts=[UserPromptPart("hello")])],
                    model_settings=None,
                    model_request_parameters=ModelRequestParameters(),
                )

        self.assertEqual(context.exception.status_code, 401)
        self.assertEqual(context.exception.body, "invalid api key")

    async def test_request_maps_endpoint_setup_error_to_user_error(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return build_stream_error("EndpointSetupFailedError", "missing endpoint config")

        async with self.mock_gateway_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                model_provider="openai",
            )

            with self.assertRaises(UserError) as context:
                await adapter.request(
                    [ModelRequest(parts=[UserPromptPart("hello")])],
                    model_settings=None,
                    model_request_parameters=ModelRequestParameters(),
                )

        self.assertEqual(str(context.exception), "missing endpoint config")


@pytest.mark.parametrize(
    "part",
    [
        pytest.param(SpeechPart(speaker="user", transcript="hello"), id="speech"),
        pytest.param(ToolAvailabilityDeltaPart(tools_added=["lookup"]), id="tool-availability-delta"),
    ],
)
def test_request_rejects_unsupported_pydantic_ai_request_parts(
    part: SpeechPart | ToolAvailabilityDeltaPart,
) -> None:
    async def scenario() -> None:
        async with httpx.AsyncClient(trust_env=False) as http_client:
            provider = DifyApiLLMProvider(
                plugin_id="langgenius/openai",
                inner_api_url="http://dify-api",
                inner_api_key="inner-secret",
                execution_context=DifyExecutionContextLayerConfig(
                    tenant_id="tenant-1",
                    user_id="user-123",
                    user_from="account",
                    app_id="app-1",
                    agent_mode="single_step",
                    invoke_from="debugger",
                ),
                agent_run_id="run-1",
                http_client=http_client,
            )
            adapter = DifyLLMAdapterModel("demo-model", provider, model_provider="openai")

            with pytest.raises(UnexpectedModelBehavior, match=type(part).__name__):
                _ = await adapter.request(
                    [ModelRequest(parts=[part])],
                    model_settings=None,
                    model_request_parameters=ModelRequestParameters(),
                )

    asyncio.run(scenario())
