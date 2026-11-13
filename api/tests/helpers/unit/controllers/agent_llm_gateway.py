"""Exercise the real SDK gateway transport and failed-run event serialization without external services."""

import asyncio
from contextlib import suppress
from typing import override

import httpx
from dify_agent.adapters.llm.provider import DifyApiLLMClient
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol import CreateRunRequest, RunComposition, RunFailedEvent
from dify_agent.runtime.context import Services
from dify_agent.runtime.event_sink import InMemoryRunEventSink
from dify_agent.runtime.runner import AgentRunRunner, RunSuccessOutcome
from flask import Flask
from pydantic_ai.exceptions import ModelAPIError

from graphon.model_runtime.entities.message_entities import UserPromptMessage


def gateway_failure_event(app: Flask) -> RunFailedEvent:
    """Invoke a Flask gateway through the SDK and return the real runner's terminal failure.

    Only the native agent execution body is replaced by one gateway call. SDK error
    decoding, ModelAPIError/ModelHTTPError formatting and run_failed serialization execute normally.
    """

    def forward(request: httpx.Request) -> httpx.Response:
        response = app.test_client().post(
            request.url.path,
            data=request.content,
            headers={"Content-Type": "application/json", "X-Inner-Api-Key": "inner-key"},
        )
        return httpx.Response(response.status_code, content=response.get_data(), headers=dict(response.headers))

    async def run() -> RunFailedEvent:
        async with httpx.AsyncClient(transport=httpx.MockTransport(forward)) as http_client:
            client = DifyApiLLMClient(
                plugin_id="langgenius/openai",
                inner_api_url="http://gateway.test",
                inner_api_key="inner-key",
                execution_context=DifyExecutionContextLayerConfig(
                    tenant_id="tenant-1",
                    user_id="account-1",
                    user_from="account",
                    app_id="app-1",
                    invoke_from="debugger",
                    agent_mode="agent_app",
                    trace_id="gateway-trace-1",
                ),
                agent_run_id="run-1",
                http_client=http_client,
            )

            class GatewayRun(AgentRunRunner):
                @override
                async def _run_agent(self) -> RunSuccessOutcome:
                    async for _chunk in client.iter_llm_result_chunks(
                        provider="openai",
                        model="gpt-test",
                        prompt_messages=[UserPromptMessage(content="hello")],
                        model_parameters={},
                        tools=None,
                        stop=None,
                        stream=True,
                    ):
                        pass
                    raise AssertionError("the gateway must fail this run")

            sink = InMemoryRunEventSink()
            runner = GatewayRun(
                sink=sink,
                request=CreateRunRequest(composition=RunComposition(layers=[])),
                run_id="run-1",
                services=Services(plugin_daemon_http_client=http_client, dify_api_http_client=http_client),
            )
            with suppress(ModelAPIError):
                await runner.run()
            terminal = sink.events["run-1"][-1]
            assert isinstance(terminal, RunFailedEvent)
            return terminal

    return asyncio.run(run())
