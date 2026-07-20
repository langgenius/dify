import asyncio
import sys
import types

import httpx
import pytest

from agenton.compositor import Compositor, LayerNode, LayerProvider


def _install_graphon_stubs() -> None:
    if "graphon.model_runtime.entities.llm_entities" in sys.modules:
        return

    graphon_module = types.ModuleType("graphon")
    model_runtime_module = types.ModuleType("graphon.model_runtime")
    entities_module = types.ModuleType("graphon.model_runtime.entities")
    llm_entities_module = types.ModuleType("graphon.model_runtime.entities.llm_entities")
    message_entities_module = types.ModuleType("graphon.model_runtime.entities.message_entities")

    llm_entities_module.LLMResultChunk = type("LLMResultChunk", (), {})
    llm_entities_module.LLMUsage = type("LLMUsage", (), {})

    for name in (
        "AssistantPromptMessage",
        "AudioPromptMessageContent",
        "DocumentPromptMessageContent",
        "ImagePromptMessageContent",
        "PromptMessage",
        "PromptMessageContentUnionTypes",
        "PromptMessageTool",
        "SystemPromptMessage",
        "TextPromptMessageContent",
        "ToolPromptMessage",
        "UserPromptMessage",
        "VideoPromptMessageContent",
    ):
        setattr(message_entities_module, name, type(name, (), {}))

    sys.modules["graphon"] = graphon_module
    sys.modules["graphon.model_runtime"] = model_runtime_module
    sys.modules["graphon.model_runtime.entities"] = entities_module
    sys.modules["graphon.model_runtime.entities.llm_entities"] = llm_entities_module
    sys.modules["graphon.model_runtime.entities.message_entities"] = message_entities_module

    graphon_module.model_runtime = model_runtime_module
    model_runtime_module.entities = entities_module
    entities_module.llm_entities = llm_entities_module
    entities_module.message_entities = message_entities_module


_install_graphon_stubs()

from dify_agent.layers.dify_core_tools.configs import DifyCoreToolConfig, DifyCoreToolsLayerConfig  # noqa: E402
from dify_agent.layers.dify_core_tools.layer import DifyCoreToolsLayer  # noqa: E402
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig  # noqa: E402
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer  # noqa: E402


def _execution_context_provider() -> LayerProvider[DifyExecutionContextLayer]:
    return LayerProvider.from_factory(
        layer_type=DifyExecutionContextLayer,
        create=lambda config: DifyExecutionContextLayer.from_config_with_settings(
            DifyExecutionContextLayerConfig.model_validate(config),
            daemon_url="http://plugin-daemon",
            daemon_api_key="daemon-secret",
        ),
    )


def _core_tools_provider() -> LayerProvider[DifyCoreToolsLayer]:
    return LayerProvider.from_factory(
        layer_type=DifyCoreToolsLayer,
        create=lambda config: DifyCoreToolsLayer.from_config_with_settings(
            DifyCoreToolsLayerConfig.model_validate(config),
            inner_api_url="http://dify-api",
            inner_api_key="inner-secret",
        ),
    )


def _execution_context_config() -> DifyExecutionContextLayerConfig:
    return DifyExecutionContextLayerConfig(
        tenant_id="tenant-1",
        user_id="user-1",
        user_from="account",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id="workflow-run-1",
        node_id="node-1",
        node_execution_id="node-exec-1",
        conversation_id="conversation-1",
        agent_id="agent-1",
        agent_config_version_id="snapshot-1",
        agent_mode="workflow_run",
        invoke_from="service-api",
    )


def test_core_tools_layer_exposes_pydantic_ai_tool_and_returns_inner_api_observation() -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("core_tools", _core_tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(
                    200,
                    json={
                        "messages": [{"type": "text", "message": {"text": "done"}}],
                        "observation": "done",
                        "metadata": {"provider_type": "builtin"},
                    },
                )
            )
        ) as http_client:
            async with compositor.enter(
                configs={
                    "execution_context": _execution_context_config(),
                    "core_tools": DifyCoreToolsLayerConfig(
                        tools=[
                            DifyCoreToolConfig(
                                provider_type="builtin",
                                provider_id="audio",
                                tool_name="transcribe",
                                name="transcribe",
                                description="Transcribe audio.",
                                parameters=[],
                                parameters_json_schema={"type": "object", "properties": {}, "required": []},
                            )
                        ]
                    ),
                }
            ) as run:
                layer = run.get_layer("core_tools", DifyCoreToolsLayer)
                tool = (await layer.get_tools(http_client=http_client))[0]
                result = await tool.function_schema.call({}, None)  # pyright: ignore[reportArgumentType]
                assert result == "done"

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("response", "expected"),
    [
        (
            httpx.Response(404, json={"code": "app_not_found", "message": "App not found."}),
            "Tool is unavailable because its app context no longer exists.",
        ),
        (
            httpx.Response(403, json={"code": "app_tenant_mismatch", "message": "App does not belong to tenant."}),
            "Tool is unavailable because its app context is invalid.",
        ),
        (
            httpx.Response(404, json={"code": "agent_tool_declaration_not_found", "message": "tool missing"}),
            "there is not a tool named transcribe",
        ),
        (
            httpx.Response(
                422,
                json={"code": "agent_tool_credential_invalid", "message": "credential region is required"},
            ),
            "Please check your tool provider credentials",
        ),
        (
            httpx.Response(422, json={"code": "tool_parameters_invalid", "message": "query is required"}),
            "tool parameters validation error: query is required, please check your tool parameters",
        ),
        (
            httpx.Response(422, json={"code": "agent_tool_invoke_failed", "message": "workflow crashed"}),
            "tool invoke error: workflow crashed",
        ),
    ],
)
def test_core_tools_layer_maps_specific_inner_api_error_codes_to_observations(
    response: httpx.Response,
    expected: str,
) -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("core_tools", _core_tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: response)) as http_client:
            async with compositor.enter(
                configs={
                    "execution_context": _execution_context_config(),
                    "core_tools": DifyCoreToolsLayerConfig(
                        tools=[
                            DifyCoreToolConfig(
                                provider_type="builtin",
                                provider_id="audio",
                                tool_name="transcribe",
                                name="transcribe",
                                description="Transcribe audio.",
                                parameters=[],
                                parameters_json_schema={"type": "object", "properties": {}, "required": []},
                            )
                        ]
                    ),
                }
            ) as run:
                layer = run.get_layer("core_tools", DifyCoreToolsLayer)
                tool = (await layer.get_tools(http_client=http_client))[0]
                result = await tool.function_schema.call({}, None)  # pyright: ignore[reportArgumentType]
                assert result == expected

    asyncio.run(scenario())


def test_core_tools_layer_reports_missing_execution_context_without_parameter_validation_text() -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("core_tools", _core_tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={"observation": "unused"}))
        ) as http_client:
            async with compositor.enter(
                configs={
                    "execution_context": _execution_context_config().model_copy(update={"app_id": None}),
                    "core_tools": DifyCoreToolsLayerConfig(
                        tools=[
                            DifyCoreToolConfig(
                                provider_type="builtin",
                                provider_id="audio",
                                tool_name="transcribe",
                                name="transcribe",
                                description="Transcribe audio.",
                                parameters=[],
                                parameters_json_schema={"type": "object", "properties": {}, "required": []},
                            )
                        ]
                    ),
                }
            ) as run:
                layer = run.get_layer("core_tools", DifyCoreToolsLayer)
                tool = (await layer.get_tools(http_client=http_client))[0]
                result = await tool.function_schema.call({}, None)  # pyright: ignore[reportArgumentType]
                assert result == "Tool is unavailable because required execution context is missing."

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "response", [httpx.Response(429, json={"code": "knowledge_rate_limited"}), httpx.Response(502)]
)
def test_core_tools_layer_converts_retryable_failures_to_temporary_unavailable_observation(
    response: httpx.Response,
) -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("core_tools", _core_tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: response)) as http_client:
            async with compositor.enter(
                configs={
                    "execution_context": _execution_context_config(),
                    "core_tools": DifyCoreToolsLayerConfig(
                        tools=[
                            DifyCoreToolConfig(
                                provider_type="builtin",
                                provider_id="audio",
                                tool_name="transcribe",
                                name="transcribe",
                                description="Transcribe audio.",
                                parameters=[],
                                parameters_json_schema={"type": "object", "properties": {}, "required": []},
                            )
                        ]
                    ),
                }
            ) as run:
                layer = run.get_layer("core_tools", DifyCoreToolsLayer)
                tool = (await layer.get_tools(http_client=http_client))[0]
                result = await tool.function_schema.call({}, None)  # pyright: ignore[reportArgumentType]
                assert result == "Tool is temporarily unavailable. Please continue without it if possible."

    asyncio.run(scenario())
