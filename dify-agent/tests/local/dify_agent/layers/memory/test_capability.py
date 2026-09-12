import asyncio
import json

import httpx
import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, ThinkingPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel

from agenton.compositor import Compositor, LayerNode, LayerProvider
from agenton_collections.layers.pydantic_ai import PydanticAIHistoryLayer
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer
from dify_agent.layers.memory import DifyMemoryLayer, DifyMemoryLayerConfig
from dify_agent.layers.memory.capability import ExternalMemory
from dify_agent.runtime.history import replace_run_history


def compositor():
    return Compositor(
        [
            LayerNode(
                "execution_context",
                LayerProvider.from_factory(
                    layer_type=DifyExecutionContextLayer,
                    create=lambda config: DifyExecutionContextLayer.from_config_with_settings(
                        DifyExecutionContextLayerConfig.model_validate(config),
                        daemon_url="http://daemon",
                        daemon_api_key="daemon-secret",
                    ),
                ),
            ),
            LayerNode(
                "external_memory",
                LayerProvider.from_layer_type(DifyMemoryLayer),
                deps={"execution_context": "execution_context"},
            ),
        ]
    )


def configs(**overrides):
    tool = {
        "plugin_id": "example/memory",
        "provider": "memory",
        "credential_type": "api-key",
        "credentials": {"token": "provider-secret"},
        "runtime_parameters": {"memory_context": {"app_id": "forged", "subject_id": "forged"}},
    }
    return {
        "execution_context": DifyExecutionContextLayerConfig(
            tenant_id="tenant-1",
            app_id="app-1",
            user_id="user-1",
            user_from="account",
            agent_mode="agent_app",
            invoke_from="web-app",
        ),
        "external_memory": DifyMemoryLayerConfig(
            prepare={**tool, "tool_name": "recall"}, observe={**tool, "tool_name": "record"}, **overrides
        ),
    }


def response(value):
    return httpx.Response(
        200,
        text="data: "
        + json.dumps({"code": 0, "message": "", "data": {"type": "json", "message": {"json_object": value}}})
        + "\n\n",
    )


def test_real_agent_recalls_privately_and_captures_only_visible_trajectory():
    requests = []
    seen_messages = []

    def daemon(request):
        assert request.url.path == "/plugin/tenant-1/dispatch/tool/invoke"
        assert request.headers["X-Plugin-ID"] == "example/memory"
        data = json.loads(request.content)
        assert data["user_id"] == "user-1"
        assert data["app_id"] == "app-1"
        value = data["data"]
        assert value["tool_parameters"]["memory_context"] == {
            "app_id": "app-1",
            "subject_kind": "user",
            "subject_id": "user-1",
        }
        requests.append(value)
        if value["tool"] == "recall":
            return response({"status": "ready", "content": "Prior preference", "content_bytes": 16})
        return response({"status": "accepted"})

    def model(messages, info):
        seen_messages.append(messages)
        assert [tool.name for tool in info.function_tools] == ["lookup"]
        if len(seen_messages) == 1:
            return ModelResponse(
                parts=[ThinkingPart("private reasoning"), ToolCallPart("lookup", {"query": "help"}, "call-1")]
            )
        return ModelResponse(parts=[TextPart("<think>private text reasoning</think>Finished")])

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(daemon)) as client:
            async with compositor().enter(configs=configs()) as run:
                layer = run.get_layer("external_memory", DifyMemoryLayer)
                memory = ExternalMemory(layer, client, "run-1")
                agent = Agent(FunctionModel(model))

                @agent.tool_plain
                def lookup(query: str) -> dict:
                    return {"answer": query, "apiKey": "sensitive-value"}

                result = await agent.run("Help", instructions="Current task", capabilities=[memory])
                assert result.output.endswith("Finished")
                history = PydanticAIHistoryLayer()
                replace_run_history(history, result.all_messages())
                assert all(
                    message.instructions is None
                    for message in history.message_history
                    if isinstance(message, ModelRequest)
                )
                await memory.observe("run_end", {"status": "succeeded"})
        records = [request["tool_parameters"]["request"] for request in requests if request["tool"] == "record"]
        assert [record["event"] for record in records] == [
            "user_prompt",
            "tool_call",
            "tool_result",
            "model_response",
            "run_end",
        ]
        assert [record["sequence"] for record in records] == list(range(1, 6))
        serialized = json.dumps(records)
        assert "sensitive-value" not in serialized
        assert "private reasoning" not in serialized
        assert "private text reasoning" not in serialized
        assert "Prior preference" not in serialized
        assert "provider-secret" not in serialized
        assert "[REDACTED]" in serialized
        for messages in seen_messages:
            instructions = [
                message.instructions
                for message in messages
                if isinstance(message, ModelRequest) and message.instructions
            ]
            assert instructions[-1].count("Prior preference") == 1

    asyncio.run(scenario())


@pytest.mark.parametrize("failure", ["http", "malformed", "oversized", "timeout"])
def test_memory_failure_does_not_stop_the_model(failure):
    async def daemon(request):
        if failure == "http":
            return httpx.Response(503)
        if failure == "timeout":
            await asyncio.sleep(0.02)
        if failure == "oversized":
            return response({"status": "ready", "content": "x" * 9000, "content_bytes": 9000})
        return response({"status": "ready", "content": "wrong", "content_bytes": 100})

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(daemon)) as client:
            async with compositor().enter(configs=configs(timeout=0.001, capture=False)) as run:
                memory = ExternalMemory(run.get_layer("external_memory", DifyMemoryLayer), client, "run-1")
                result = await Agent(TestModel(custom_output_text="Still works")).run("Help", capabilities=[memory])
                assert result.output == "Still works"
                assert memory.content is None
                assert memory.diagnostics

    asyncio.run(scenario())


def test_failed_tools_are_observed_and_capture_is_bounded():
    records = []

    def daemon(request):
        data = json.loads(request.content)["data"]
        if data["tool"] == "recall":
            return response({"status": "empty", "content": None, "content_bytes": 0})
        records.append(data["tool_parameters"]["request"])
        return response({"status": "accepted"})

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(daemon)) as client:
            async with compositor().enter(
                configs=configs(capture_max_bytes=512, subject_kind="business", subject_id="support")
            ) as run:
                memory = ExternalMemory(run.get_layer("external_memory", DifyMemoryLayer), client, "run-2")
                agent = Agent(TestModel())

                @agent.tool_plain
                def broken() -> str:
                    raise RuntimeError("Sensitive error text")

                with pytest.raises(RuntimeError, match="Sensitive"):
                    await agent.run("中" * 2000, capabilities=[memory])
                assert memory.identity()["subject_id"] == "support"
        assert all(len(json.dumps(record["payload"], ensure_ascii=False).encode()) <= 512 for record in records)
        assert records[-1]["payload"]["status"] == "failed"
        assert "Sensitive error text" not in json.dumps(records)

    asyncio.run(scenario())


def test_structured_final_output_is_captured_without_secrets():
    from pydantic import BaseModel

    class Answer(BaseModel):
        answer: str
        access_token: str

    records = []

    def daemon(request):
        data = json.loads(request.content)["data"]
        if data["tool"] == "recall":
            return response({"status": "empty", "content": None, "content_bytes": 0})
        records.append(data["tool_parameters"]["request"])
        return response({"status": "accepted"})

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(daemon)) as client:
            async with compositor().enter(configs=configs()) as run:
                memory = ExternalMemory(run.get_layer("external_memory", DifyMemoryLayer), client, "structured")
                agent = Agent(
                    TestModel(custom_output_args={"answer": "Finished", "access_token": "secret-value"}),
                    output_type=Answer,
                )
                result = await agent.run("Help", capabilities=[memory])
                assert result.output.answer == "Finished"
        final = [record for record in records if record["event"] == "model_response"]
        assert final[-1]["payload"]["result"] == {"answer": "Finished", "access_token": "[REDACTED]"}
        assert "secret-value" not in json.dumps(records)

    asyncio.run(scenario())
