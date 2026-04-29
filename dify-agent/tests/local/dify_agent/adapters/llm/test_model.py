import json
import unittest
from contextlib import asynccontextmanager
from typing import cast
from unittest.mock import patch

import httpx
from pydantic_ai.exceptions import ModelHTTPError, UserError
from pydantic_ai.messages import (
    InstructionPart,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    SystemPromptPart,
    TextPart,
    ThinkingPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.tools import ToolDefinition

from dify_agent.adapters.llm import DifyLLMAdapterModel, DifyPluginDaemonProvider

from ._test_support import (
    AssistantPromptMessage,
    LLMResultChunk,
    LLMResultChunkDelta,
    build_error_response,
    build_stream_error,
    build_stream_response,
    make_usage,
    single_text_chunk,
)


class DifyLLMAdapterModelTests(unittest.IsolatedAsyncioTestCase):
    def make_provider(
        self,
        *,
        user_id: str | None = None,
    ) -> DifyPluginDaemonProvider:
        return DifyPluginDaemonProvider(
            tenant_id="tenant-1",
            plugin_id="langgenius/openai",
            plugin_provider="openai",
            plugin_daemon_url="http://plugin-daemon",
            plugin_daemon_api_key="daemon-secret",
            user_id=user_id,
        )

    @asynccontextmanager
    async def mock_daemon_stream(self, handler: httpx.MockTransport):
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

    async def test_request_uses_plugin_daemon_dispatch_contract(self) -> None:
        messages = [
            ModelRequest(
                parts=[
                    SystemPromptPart("request system"),
                    UserPromptPart("hello"),
                    ToolReturnPart(
                        tool_name="lookup",
                        content={"city": "Paris"},
                        tool_call_id="tool-1",
                    ),
                    RetryPromptPart(
                        content="try again", tool_name="lookup", tool_call_id="tool-1"
                    ),
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
            instruction_parts=[InstructionPart(content="be concise")],
        )

        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.method, "POST")
            self.assertEqual(request.url.path, "/plugin/tenant-1/dispatch/llm/invoke")
            self.assertEqual(request.headers["X-Api-Key"], "daemon-secret")
            self.assertEqual(request.headers["X-Plugin-ID"], "langgenius/openai")

            payload = json.loads(request.content.decode("utf-8"))
            self.assertEqual(payload["user_id"], "user-123")
            data = payload["data"]
            self.assertEqual(data["provider"], "openai")
            self.assertEqual(data["model_type"], "llm")
            self.assertEqual(data["model"], "demo-model")
            self.assertEqual(data["credentials"], {"api_key": "secret"})
            self.assertEqual(
                data["model_parameters"],
                {"temperature": 0.2, "max_tokens": 128, "logit_bias": {"1": 2}},
            )
            self.assertEqual(data["stop"], ["END"])
            self.assertFalse(data["stream"])
            self.assertEqual(data["tools"][0]["name"], "weather")
            self.assertEqual(data["prompt_messages"][0]["role"], "system")
            self.assertEqual(data["prompt_messages"][0]["content"], "request system")
            self.assertEqual(data["prompt_messages"][1]["content"], "be concise")
            self.assertEqual(data["prompt_messages"][2]["content"], "hello")
            self.assertEqual(data["prompt_messages"][3]["role"], "tool")
            self.assertEqual(data["prompt_messages"][4]["role"], "tool")
            self.assertEqual(data["prompt_messages"][5]["role"], "assistant")
            return build_stream_response(
                LLMResultChunk(
                    model="demo-model",
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(
                            content="adapter response", tool_calls=[]
                        ),
                        usage=make_usage(prompt_tokens=11, completion_tokens=7),
                    ),
                )
            )

        async with self.mock_daemon_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(user_id="user-123"),
                credentials={"api_key": "secret"},
                model_settings={"temperature": 0.2, "stop_sequences": ["DEFAULT_STOP"]},
            )

            response = await adapter.request(
                messages,
                model_settings={"max_tokens": 128, "logit_bias": {"1": 2}, "stop_sequences": ["END"]},
                model_request_parameters=request_parameters,
            )

        self.assertEqual(response.model_name, "demo-model")
        self.assertEqual(response.provider_name, "DifyPlugin/openai")
        self.assertEqual(response.usage.input_tokens, 11)
        self.assertEqual(response.usage.output_tokens, 7)
        self.assertEqual(response.parts[0].part_kind, "text")
        self.assertEqual(cast(TextPart, response.parts[0]).content, "adapter response")

    async def test_request_returns_a_response(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return build_stream_response(
                *single_text_chunk(
                    "adapter response", prompt_tokens=11, completion_tokens=7
                )
            )

        async with self.mock_daemon_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                credentials={"api_key": "secret"},
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
                LLMResultChunk(
                    model="demo-model",
                    delta=LLMResultChunkDelta(
                        index=1,
                        message=AssistantPromptMessage(
                            content="",
                            tool_calls=[
                                AssistantPromptMessage.ToolCall(
                                    id="call-1",
                                    type="function",
                                    function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                                        name="weather",
                                        arguments='{"city":"Paris"}',
                                    ),
                                )
                            ],
                        ),
                    ),
                ),
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

        async with self.mock_daemon_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                credentials={"api_key": "secret"},
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
        self.assertEqual(response.parts[0].part_kind, "text")
        self.assertEqual(cast(TextPart, response.parts[0]).content, "hello ")
        self.assertEqual(response.parts[1].part_kind, "tool-call")
        self.assertEqual(cast(ToolCallPart, response.parts[1]).tool_name, "weather")
        self.assertEqual(response.parts[2].part_kind, "text")
        self.assertEqual(cast(TextPart, response.parts[2]).content, "world")

    async def test_request_splits_embedded_thinking_tags_into_parts(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return build_stream_response(
                *single_text_chunk("before<think>reasoning</think>after")
            )

        async with self.mock_daemon_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                credentials={"api_key": "secret"},
            )

            response = await adapter.request(
                [ModelRequest(parts=[UserPromptPart("hello")])],
                model_settings=None,
                model_request_parameters=ModelRequestParameters(),
            )

        self.assertEqual(
            [part.part_kind for part in response.parts], ["text", "thinking", "text"]
        )
        self.assertEqual(cast(TextPart, response.parts[0]).content, "before")
        self.assertEqual(cast(ThinkingPart, response.parts[1]).content, "reasoning")
        self.assertEqual(cast(TextPart, response.parts[2]).content, "after")

    async def test_request_maps_stream_envelope_rate_limit_error_to_http_error(
        self,
    ) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return build_stream_error(
                "PluginInvokeError",
                json.dumps(
                    {"error_type": "InvokeRateLimitError", "message": "too many"}
                ),
            )

        async with self.mock_daemon_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                credentials={"api_key": "secret"},
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
            return build_error_response(
                "PluginDaemonUnauthorizedError", "invalid api key", status_code=401
            )

        async with self.mock_daemon_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                credentials={"api_key": "secret"},
            )

            with self.assertRaises(ModelHTTPError) as context:
                await adapter.request(
                    [ModelRequest(parts=[UserPromptPart("hello")])],
                    model_settings=None,
                    model_request_parameters=ModelRequestParameters(),
                )

        self.assertEqual(context.exception.status_code, 401)
        self.assertEqual(
            context.exception.body,
            {
                "error_type": "PluginDaemonUnauthorizedError",
                "message": "invalid api key",
            },
        )

    async def test_request_maps_endpoint_setup_error_to_user_error(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return build_stream_error(
                "EndpointSetupFailedError", "missing endpoint config"
            )

        async with self.mock_daemon_stream(httpx.MockTransport(handler)):
            adapter = DifyLLMAdapterModel(
                "demo-model",
                self.make_provider(),
                credentials={"api_key": "secret"},
            )

            with self.assertRaises(UserError) as context:
                await adapter.request(
                    [ModelRequest(parts=[UserPromptPart("hello")])],
                    model_settings=None,
                    model_request_parameters=ModelRequestParameters(),
                )

        self.assertEqual(str(context.exception), "missing endpoint config")
