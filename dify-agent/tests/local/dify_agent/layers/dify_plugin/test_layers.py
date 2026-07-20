import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from pydantic import JsonValue

from agenton.compositor import Compositor, LayerNode, LayerProvider
from dify_agent.adapters.llm import DifyLLMAdapterModel
from dify_agent.layers.dify_plugin.configs import (
    DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
    DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID,
    DifyPluginLLMLayerConfig,
    DifyPluginToolConfig,
    DifyPluginToolOption,
    DifyPluginToolParameter,
    DifyPluginToolParameterForm,
    DifyPluginToolParameterType,
    DifyPluginToolsLayerConfig,
)
from dify_agent.layers.dify_plugin.llm_layer import DifyPluginLLMLayer
from dify_agent.layers.dify_plugin.tools_layer import DifyPluginToolsLayer, _PluginToolFileContext
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer


def _execution_context_config() -> DifyExecutionContextLayerConfig:
    return DifyExecutionContextLayerConfig(
        tenant_id="tenant-1",
        user_id="user-1",
        user_from="account",
        agent_mode="workflow_run",
        invoke_from="service-api",
    )


def _llm_config() -> DifyPluginLLMLayerConfig:
    return DifyPluginLLMLayerConfig(
        plugin_id="langgenius/openai",
        model_provider="openai",
        model="demo-model",
        credentials={"api_key": "secret"},
        model_settings={"temperature": 0.2},
    )


def _tools_config() -> DifyPluginToolsLayerConfig:
    return DifyPluginToolsLayerConfig(
        tools=[
            DifyPluginToolConfig(
                plugin_id="langgenius/tools",
                provider="search",
                tool_name="web_search",
                credential_type="api-key",
                description="Search the web.",
                credentials={"api_key": "secret"},
                runtime_parameters={"api_version": "2026-01", "auth_scope": "workspace"},
                parameters=_prepared_tool_parameters(),
                parameters_json_schema=_prepared_tool_schema(),
            )
        ]
    )


def _missing_hidden_parameter_tools_config() -> DifyPluginToolsLayerConfig:
    return DifyPluginToolsLayerConfig(
        tools=[
            DifyPluginToolConfig(
                plugin_id="langgenius/tools",
                provider="search",
                tool_name="web_search",
                credential_type="api-key",
                description="Search the web.",
                credentials={"api_key": "secret"},
                runtime_parameters={"api_version": "2026-01"},
                parameters=_prepared_tool_parameters(),
                parameters_json_schema=_prepared_tool_schema(),
            )
        ]
    )


def _execution_context_provider() -> LayerProvider[DifyExecutionContextLayer]:
    return LayerProvider.from_factory(
        layer_type=DifyExecutionContextLayer,
        create=lambda config: DifyExecutionContextLayer.from_config_with_settings(
            DifyExecutionContextLayerConfig.model_validate(config),
            daemon_url="http://plugin-daemon",
            daemon_api_key="daemon-secret",
        ),
    )


def _tools_provider() -> LayerProvider[DifyPluginToolsLayer]:
    return LayerProvider.from_factory(
        layer_type=DifyPluginToolsLayer,
        create=lambda config: DifyPluginToolsLayer.from_config_with_settings(
            DifyPluginToolsLayerConfig.model_validate(config),
            inner_api_url="http://dify-api",
            inner_api_key="inner-secret",
        ),
    )


def _prepared_tool_parameters() -> list[DifyPluginToolParameter]:
    return [
        DifyPluginToolParameter(
            name="query",
            type=DifyPluginToolParameterType.STRING,
            form=DifyPluginToolParameterForm.LLM,
            required=True,
            llm_description="Search query",
        ),
        DifyPluginToolParameter(
            name="region",
            type=DifyPluginToolParameterType.SELECT,
            form=DifyPluginToolParameterForm.LLM,
            required=False,
            llm_description="Search region",
            options=[DifyPluginToolOption(value="global"), DifyPluginToolOption(value="cn")],
        ),
        DifyPluginToolParameter(
            name="api_version",
            type=DifyPluginToolParameterType.STRING,
            form=DifyPluginToolParameterForm.FORM,
            required=True,
            llm_description="Hidden API version",
        ),
        DifyPluginToolParameter(
            name="auth_scope",
            type=DifyPluginToolParameterType.STRING,
            form=DifyPluginToolParameterForm.FORM,
            required=True,
            llm_description="Hidden auth scope",
        ),
    ]


def _prepared_tool_schema() -> dict[str, JsonValue]:
    return {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query"},
            "region": {
                "type": "string",
                "description": "Search region",
                "enum": ["global", "cn"],
            },
        },
        "required": ["query"],
    }


def _llm_only_parameter(*, name: str, description: str, default: JsonValue = None) -> DifyPluginToolParameter:
    return DifyPluginToolParameter(
        name=name,
        type=DifyPluginToolParameterType.STRING,
        form=DifyPluginToolParameterForm.LLM,
        required=default is None,
        default=default,
        llm_description=description,
    )


def _file_parameter(
    *,
    name: str = "source",
    parameter_type: DifyPluginToolParameterType = DifyPluginToolParameterType.FILE,
) -> DifyPluginToolParameter:
    return DifyPluginToolParameter(
        name=name,
        type=parameter_type,
        form=DifyPluginToolParameterForm.LLM,
        required=True,
        llm_description="Source file",
    )


def _file_tools_config(
    *,
    parameter_type: DifyPluginToolParameterType = DifyPluginToolParameterType.FILE,
) -> DifyPluginToolsLayerConfig:
    return DifyPluginToolsLayerConfig(
        tools=[
            DifyPluginToolConfig(
                plugin_id="langgenius/tools",
                provider="search",
                tool_name="read_file",
                credential_type="api-key",
                parameters=[_file_parameter(parameter_type=parameter_type)],
                parameters_json_schema={
                    "type": "object",
                    "properties": {"source": {"type": "string"}},
                    "required": ["source"],
                },
            )
        ]
    )


def _invoke_stream_response(
    *,
    error_payload: dict[str, object] | None = None,
    chunked_blob: bool = False,
) -> httpx.Response:
    if error_payload is not None:
        return httpx.Response(400, json=error_payload)

    if chunked_blob:
        stream_payload = "\n".join(
            [
                f"data: {json.dumps({'code': 0, 'message': 'ok', 'data': {'type': 'blob_chunk', 'message': {'id': 'blob-1', 'sequence': 0, 'total_length': 11, 'blob': 'aGVsbG8g', 'end': False}}})}",
                f"data: {json.dumps({'code': 0, 'message': 'ok', 'data': {'type': 'blob_chunk', 'message': {'id': 'blob-1', 'sequence': 1, 'total_length': 11, 'blob': 'd29ybGQ=', 'end': True}}})}",
                "",
            ]
        )
        return httpx.Response(200, text=stream_payload)

    stream_payload = "\n".join(
        [
            f"data: {json.dumps({'code': 0, 'message': 'ok', 'data': {'type': 'text', 'message': {'text': 'found '}}})}",
            f"data: {json.dumps({'code': 0, 'message': 'ok', 'data': {'type': 'json', 'message': {'json_object': {'count': 1}}}})}",
            "",
        ]
    )
    return httpx.Response(200, text=stream_payload)


def _tool_transport(
    *,
    invoke_error_payload: dict[str, object] | None = None,
    chunked_blob: bool = False,
) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/dispatch/tool/invoke"):
            payload = json.loads(request.content.decode("utf-8"))
            assert payload["user_id"] == "user-1"
            assert payload["data"]["provider"] == "search"
            assert payload["data"]["tool"] == "web_search"
            assert payload["data"]["credential_type"] == "api-key"
            assert payload["data"]["tool_parameters"] == {
                "query": "dify",
                "region": "global",
                "api_version": "2026-01",
                "auth_scope": "workspace",
            }
            return _invoke_stream_response(error_payload=invoke_error_payload, chunked_blob=chunked_blob)

        raise AssertionError(f"Unexpected request path: {request.url.path}")

    return httpx.MockTransport(handler)


def _file_tool_transport(
    *,
    expected_source: object,
    download_response: dict[str, object] | None = None,
) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/inner/api/download/file/request"):
            assert download_response is not None
            payload = json.loads(request.content.decode("utf-8"))
            assert payload["file"] == {"transfer_method": "tool_file", "reference": "dify-file-ref:file-1"}
            return httpx.Response(200, json={"data": download_response})

        if request.url.path.endswith("/dispatch/tool/invoke"):
            payload = json.loads(request.content.decode("utf-8"))
            assert payload["data"]["tool_parameters"]["source"] == expected_source
            return _invoke_stream_response()

        raise AssertionError(f"Unexpected request path: {request.url.path}")

    return httpx.MockTransport(handler)


def test_dify_plugin_type_id_constants_match_implementation_classes() -> None:
    assert DIFY_PLUGIN_LLM_LAYER_TYPE_ID == DifyPluginLLMLayer.type_id
    assert DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID == DifyPluginToolsLayer.type_id


def test_dify_plugin_llm_layer_builds_adapter_model_from_direct_dependency() -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("renamed-execution-context", _execution_context_provider()),
                LayerNode("llm", DifyPluginLLMLayer, deps={"execution_context": "renamed-execution-context"}),
            ]
        )
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: httpx.Response(200))) as client:
            async with compositor.enter(
                configs={
                    "renamed-execution-context": _execution_context_config(),
                    "llm": _llm_config(),
                }
            ) as run:
                execution_context = run.get_layer("renamed-execution-context", DifyExecutionContextLayer)
                llm = run.get_layer("llm", DifyPluginLLMLayer)

                model = llm.get_model(http_client=client)

                assert llm.deps.execution_context is execution_context
                assert isinstance(model, DifyLLMAdapterModel)
                assert model.model_name == "demo-model"
                assert model.model_provider == "openai"
                assert model.credentials == {"api_key": "secret"}
                assert model.provider.name == "DifyPlugin/langgenius/openai"
                assert model.provider.client.http_client is client

    asyncio.run(scenario())


def test_dify_plugin_tools_layer_uses_prepared_tool_definition_and_invokes_daemon() -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("tools", _tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(transport=_tool_transport()) as client:
            async with compositor.enter(
                configs={"execution_context": _execution_context_config(), "tools": _tools_config()}
            ) as run:
                tools_layer = run.get_layer("tools", DifyPluginToolsLayer)
                tool = (await tools_layer.get_tools(http_client=client, dify_api_http_client=client))[0]

                tool_def = await tool.prepare_tool_def(None)  # pyright: ignore[reportArgumentType]
                result = await tool.function_schema.call(
                    {"query": "dify", "region": "global"},
                    None,  # pyright: ignore[reportArgumentType]
                )

                assert tool.name == "web_search"
                assert tool.description == "Search the web."
                assert tool_def is not None
                assert tool_def.parameters_json_schema == _prepared_tool_schema()
                assert tool_def.strict is False
                assert result == 'found {"count": 1}'

    asyncio.run(scenario())


def test_dify_plugin_tools_layer_uses_each_tool_plugin_id_for_transport() -> None:
    async def scenario() -> None:
        seen_requests: list[tuple[str, str, str, str]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/dispatch/tool/invoke"):
                payload = json.loads(request.content.decode("utf-8"))
                seen_requests.append(
                    (
                        request.headers["X-Plugin-ID"],
                        payload["user_id"],
                        payload["data"]["provider"],
                        payload["data"]["tool"],
                    )
                )
                return _invoke_stream_response()

            raise AssertionError(f"Unexpected request path: {request.url.path}")

        tools_config = DifyPluginToolsLayerConfig(
            tools=[
                DifyPluginToolConfig(
                    plugin_id="langgenius/tools-a",
                    provider="search-a",
                    tool_name="web_search_a",
                    credential_type="api-key",
                    parameters=[_llm_only_parameter(name="query", description="Search query A")],
                    parameters_json_schema={
                        "type": "object",
                        "properties": {"query": {"type": "string", "description": "Search query A"}},
                        "required": ["query"],
                    },
                ),
                DifyPluginToolConfig(
                    plugin_id="langgenius/tools-b",
                    provider="search-b",
                    tool_name="web_search_b",
                    credential_type="api-key",
                    parameters=[_llm_only_parameter(name="query", description="Search query B")],
                    parameters_json_schema={
                        "type": "object",
                        "properties": {"query": {"type": "string", "description": "Search query B"}},
                        "required": ["query"],
                    },
                ),
            ]
        )

        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("tools", _tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            async with compositor.enter(
                configs={"execution_context": _execution_context_config(), "tools": tools_config}
            ) as run:
                tools = await run.get_layer("tools", DifyPluginToolsLayer).get_tools(
                    http_client=client, dify_api_http_client=client
                )

                await tools[0].function_schema.call({"query": "first"}, None)  # pyright: ignore[reportArgumentType]
                await tools[1].function_schema.call({"query": "second"}, None)  # pyright: ignore[reportArgumentType]

        assert seen_requests == [
            ("langgenius/tools-a", "user-1", "search-a", "web_search_a"),
            ("langgenius/tools-b", "user-1", "search-b", "web_search_b"),
        ]

    asyncio.run(scenario())


def test_dify_plugin_tools_layer_casts_prepared_parameter_values_before_invocation() -> None:
    async def scenario() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/dispatch/tool/invoke"):
                payload = json.loads(request.content.decode("utf-8"))
                assert payload["user_id"] == "user-1"
                assert payload["data"]["tool_parameters"] == {
                    "enabled": True,
                    "count": 7,
                    "tags": ["a", "b"],
                    "metadata": {"source": "docs"},
                    "model": {"provider": "openai", "model": "gpt-4o-mini"},
                }
                return _invoke_stream_response()

            raise AssertionError(f"Unexpected request path: {request.url.path}")

        tools_config = DifyPluginToolsLayerConfig(
            tools=[
                DifyPluginToolConfig(
                    plugin_id="langgenius/tools",
                    provider="search",
                    tool_name="web_search",
                    credential_type="api-key",
                    parameters=[
                        DifyPluginToolParameter(
                            name="enabled",
                            type=DifyPluginToolParameterType.BOOLEAN,
                            form=DifyPluginToolParameterForm.LLM,
                            required=True,
                            llm_description="Enable search",
                        ),
                        DifyPluginToolParameter(
                            name="count",
                            type=DifyPluginToolParameterType.NUMBER,
                            form=DifyPluginToolParameterForm.LLM,
                            required=True,
                            llm_description="Result count",
                        ),
                        DifyPluginToolParameter(
                            name="tags",
                            type=DifyPluginToolParameterType.ARRAY,
                            form=DifyPluginToolParameterForm.LLM,
                            required=True,
                            llm_description="Tags",
                            input_schema={"type": "array", "items": {"type": "string"}},
                        ),
                        DifyPluginToolParameter(
                            name="metadata",
                            type=DifyPluginToolParameterType.OBJECT,
                            form=DifyPluginToolParameterForm.LLM,
                            required=True,
                            llm_description="Metadata",
                            input_schema={"type": "object", "additionalProperties": True},
                        ),
                        DifyPluginToolParameter(
                            name="model",
                            type=DifyPluginToolParameterType.MODEL_SELECTOR,
                            form=DifyPluginToolParameterForm.LLM,
                            required=True,
                            llm_description="Model selector",
                            input_schema={"type": "object", "additionalProperties": True},
                        ),
                    ],
                    parameters_json_schema={
                        "type": "object",
                        "properties": {
                            "enabled": {"type": "boolean", "description": "Enable search"},
                            "count": {"type": "number", "description": "Result count"},
                            "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags"},
                            "metadata": {
                                "type": "object",
                                "additionalProperties": True,
                                "description": "Metadata",
                            },
                            "model": {
                                "type": "object",
                                "additionalProperties": True,
                                "description": "Model selector",
                            },
                        },
                        "required": ["enabled", "count", "tags", "metadata", "model"],
                    },
                )
            ]
        )

        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("tools", _tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            async with compositor.enter(
                configs={"execution_context": _execution_context_config(), "tools": tools_config}
            ) as run:
                tool = (
                    await run.get_layer("tools", DifyPluginToolsLayer).get_tools(
                        http_client=client, dify_api_http_client=client
                    )
                )[0]

                result = await tool.function_schema.call(
                    {
                        "enabled": "yes",
                        "count": "7",
                        "tags": '["a", "b"]',
                        "metadata": '{"source": "docs"}',
                        "model": {"provider": "openai", "model": "gpt-4o-mini"},
                    },
                    None,  # pyright: ignore[reportArgumentType]
                )

                assert result == 'found {"count": 1}'

    asyncio.run(scenario())


def test_dify_plugin_tools_layer_sends_prepared_parameter_defaults_to_daemon() -> None:
    async def scenario() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/dispatch/tool/invoke"):
                payload = json.loads(request.content.decode("utf-8"))
                assert payload["data"]["tool_parameters"] == {
                    "query": "dify",
                    "region": "global",
                }
                return _invoke_stream_response()

            raise AssertionError(f"Unexpected request path: {request.url.path}")

        tools_config = DifyPluginToolsLayerConfig(
            tools=[
                DifyPluginToolConfig(
                    plugin_id="langgenius/tools",
                    provider="search",
                    tool_name="web_search",
                    credential_type="api-key",
                    parameters=[
                        _llm_only_parameter(name="query", description="Search query"),
                        _llm_only_parameter(name="region", description="Search region", default="global"),
                    ],
                    parameters_json_schema={
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Search query"},
                            "region": {"type": "string", "description": "Search region"},
                        },
                        "required": ["query"],
                    },
                )
            ]
        )

        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("tools", _tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            async with compositor.enter(
                configs={"execution_context": _execution_context_config(), "tools": tools_config}
            ) as run:
                tool = (
                    await run.get_layer("tools", DifyPluginToolsLayer).get_tools(
                        http_client=client, dify_api_http_client=client
                    )
                )[0]

                result = await tool.function_schema.call(
                    {"query": "dify"},
                    None,  # pyright: ignore[reportArgumentType]
                )

                assert result == 'found {"count": 1}'

    asyncio.run(scenario())


def test_dify_plugin_tools_layer_converts_remote_url_file_string() -> None:
    async def scenario() -> None:
        expected_source = {
            "dify_model_identity": "__dify__file__",
            "type": "custom",
            "url": "https://example.com/report.pdf",
            "filename": "report.pdf",
            "mime_type": "application/pdf",
            "extension": ".pdf",
            "size": -1,
        }
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("tools", _tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(transport=_file_tool_transport(expected_source=expected_source)) as client:
            async with compositor.enter(
                configs={"execution_context": _execution_context_config(), "tools": _file_tools_config()}
            ) as run:
                tool = (
                    await run.get_layer("tools", DifyPluginToolsLayer).get_tools(
                        http_client=client,
                        dify_api_http_client=client,
                    )
                )[0]
                result = await tool.function_schema.call(
                    {"source": "https://example.com/report.pdf"},
                    None,  # pyright: ignore[reportArgumentType]
                )

        assert result == 'found {"count": 1}'

    asyncio.run(scenario())


def test_dify_plugin_tools_layer_converts_remote_url_file_mapping() -> None:
    async def scenario() -> None:
        expected_source = {
            "dify_model_identity": "__dify__file__",
            "type": "custom",
            "url": "https://example.com/report.pdf",
            "filename": "report.pdf",
            "mime_type": "application/pdf",
            "extension": ".pdf",
            "size": -1,
        }
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("tools", _tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(transport=_file_tool_transport(expected_source=expected_source)) as client:
            async with compositor.enter(
                configs={"execution_context": _execution_context_config(), "tools": _file_tools_config()}
            ) as run:
                tool = (
                    await run.get_layer("tools", DifyPluginToolsLayer).get_tools(
                        http_client=client,
                        dify_api_http_client=client,
                    )
                )[0]
                result = await tool.function_schema.call(
                    {"source": {"transfer_method": "remote_url", "url": "https://example.com/report.pdf"}},
                    None,  # pyright: ignore[reportArgumentType]
                )

        assert result == 'found {"count": 1}'

    asyncio.run(scenario())


def test_dify_plugin_tools_layer_resolves_tool_file_mapping_before_invocation() -> None:
    async def scenario() -> None:
        expected_source = {
            "dify_model_identity": "__dify__file__",
            "type": "custom",
            "url": "https://signed.example/report.pdf",
            "filename": "report.pdf",
            "mime_type": "application/pdf",
            "extension": ".pdf",
            "size": 42,
        }
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("tools", _tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(
            transport=_file_tool_transport(
                expected_source=expected_source,
                download_response={
                    "filename": "report.pdf",
                    "mime_type": "application/pdf",
                    "size": 42,
                    "download_url": "https://signed.example/report.pdf",
                },
            )
        ) as client:
            async with compositor.enter(
                configs={"execution_context": _execution_context_config(), "tools": _file_tools_config()}
            ) as run:
                tool = (
                    await run.get_layer("tools", DifyPluginToolsLayer).get_tools(
                        http_client=client,
                        dify_api_http_client=client,
                    )
                )[0]
                result = await tool.function_schema.call(
                    {"source": {"transfer_method": "tool_file", "reference": "dify-file-ref:file-1"}},
                    None,  # pyright: ignore[reportArgumentType]
                )

        assert result == 'found {"count": 1}'

    asyncio.run(scenario())


def test_dify_plugin_tools_layer_converts_files_parameter_values() -> None:
    async def scenario() -> None:
        expected_source = [
            {
                "dify_model_identity": "__dify__file__",
                "type": "custom",
                "url": "https://example.com/a.txt",
                "filename": "a.txt",
                "mime_type": "text/plain",
                "extension": ".txt",
                "size": -1,
            },
            {
                "dify_model_identity": "__dify__file__",
                "type": "custom",
                "url": "https://example.com/b.txt",
                "filename": "b.txt",
                "mime_type": "text/plain",
                "extension": ".txt",
                "size": -1,
            },
        ]
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("tools", _tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(transport=_file_tool_transport(expected_source=expected_source)) as client:
            async with compositor.enter(
                configs={
                    "execution_context": _execution_context_config(),
                    "tools": _file_tools_config(parameter_type=DifyPluginToolParameterType.FILES),
                }
            ) as run:
                tool = (
                    await run.get_layer("tools", DifyPluginToolsLayer).get_tools(
                        http_client=client,
                        dify_api_http_client=client,
                    )
                )[0]
                result = await tool.function_schema.call(
                    {"source": ["https://example.com/a.txt", "https://example.com/b.txt"]},
                    None,  # pyright: ignore[reportArgumentType]
                )

        assert result == 'found {"count": 1}'

    asyncio.run(scenario())


def test_dify_plugin_tools_layer_rejects_multiple_values_for_single_file() -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("tools", _tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: httpx.Response(500))) as client:
            async with compositor.enter(
                configs={"execution_context": _execution_context_config(), "tools": _file_tools_config()}
            ) as run:
                tool = (
                    await run.get_layer("tools", DifyPluginToolsLayer).get_tools(
                        http_client=client,
                        dify_api_http_client=client,
                    )
                )[0]
                result = await tool.function_schema.call(
                    {"source": ["https://example.com/a.txt", "https://example.com/b.txt"]},
                    None,  # pyright: ignore[reportArgumentType]
                )
        assert "only accepts one file" in result

    asyncio.run(scenario())


def test_dify_plugin_tools_layer_rejects_path_without_shell() -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("tools", _tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: httpx.Response(500))) as client:
            async with compositor.enter(
                configs={"execution_context": _execution_context_config(), "tools": _file_tools_config()}
            ) as run:
                tool = (
                    await run.get_layer("tools", DifyPluginToolsLayer).get_tools(
                        http_client=client,
                        dify_api_http_client=client,
                    )
                )[0]
                result = await tool.function_schema.call(
                    {"source": "outputs/report.pdf"},
                    None,  # pyright: ignore[reportArgumentType]
                )
        assert "require an active shell layer" in result

    asyncio.run(scenario())


def test_plugin_tool_file_context_uploads_sandbox_path_and_resolves_signed_url() -> None:
    class FakeShell:
        script: str | None = None

        async def run_remote_script_complete(self, script: str, **_kwargs: object) -> object:
            self.script = script
            return SimpleNamespace(
                exit_code=0,
                status="done",
                output_complete=True,
                output=(
                    "noise\n"
                    "<<<DIFY_PLUGIN_TOOL_FILE_UPLOAD_BEGIN>>>"
                    '{"transfer_method":"tool_file","reference":"dify-file-ref:file-1"}'
                    "<<<DIFY_PLUGIN_TOOL_FILE_UPLOAD_END>>>\n"
                ),
            )

    class FakeFileClient:
        async def request_download(self, **_kwargs: object) -> object:
            return SimpleNamespace(
                filename="report.pdf",
                mime_type="application/pdf",
                size=42,
                download_url="https://signed.example/report.pdf",
            )

    async def scenario() -> None:
        shell = FakeShell()
        context = _PluginToolFileContext(
            file_client=FakeFileClient(),  # type: ignore[arg-type]
            execution_context=_execution_context_config(),
            shell=shell,  # type: ignore[arg-type]
        )
        result = await context.to_plugin_file_parameter("outputs/report.pdf")

        assert result == {
            "dify_model_identity": "__dify__file__",
            "type": "custom",
            "url": "https://signed.example/report.pdf",
            "filename": "report.pdf",
            "mime_type": "application/pdf",
            "extension": ".pdf",
            "size": 42,
        }
        assert shell.script is not None
        assert "outputs/report.pdf" in shell.script

    asyncio.run(scenario())


def test_dify_plugin_tools_layer_requires_hidden_runtime_parameters_in_prepared_config() -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("tools", _tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(transport=_tool_transport()) as client:
            async with compositor.enter(
                configs={
                    "execution_context": _execution_context_config(),
                    "tools": _missing_hidden_parameter_tools_config(),
                }
            ) as run:
                with pytest.raises(ValueError, match="requires non-LLM runtime_parameters for: auth_scope"):
                    await run.get_layer("tools", DifyPluginToolsLayer).get_tools(
                        http_client=client, dify_api_http_client=client
                    )

    asyncio.run(scenario())


def test_dify_plugin_tools_layer_returns_agent_friendly_error_text() -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("tools", _tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(
            transport=_tool_transport(
                invoke_error_payload={
                    "error_type": "PluginDaemonBadRequestError",
                    "message": "missing query",
                }
            )
        ) as client:
            async with compositor.enter(
                configs={"execution_context": _execution_context_config(), "tools": _tools_config()}
            ) as run:
                tool = (
                    await run.get_layer("tools", DifyPluginToolsLayer).get_tools(
                        http_client=client, dify_api_http_client=client
                    )
                )[0]
                result = await tool.function_schema.call(
                    {"query": "dify", "region": "global"},
                    None,  # pyright: ignore[reportArgumentType]
                )

                assert result == "tool parameters validation error: missing query, please check your tool parameters"

    asyncio.run(scenario())


def test_dify_plugin_tools_layer_propagates_unexpected_transport_errors() -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("tools", _tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/dispatch/tool/invoke"):
                raise RuntimeError("unexpected transport failure")

            raise AssertionError(f"Unexpected request path: {request.url.path}")

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            async with compositor.enter(
                configs={"execution_context": _execution_context_config(), "tools": _tools_config()}
            ) as run:
                tool = (
                    await run.get_layer("tools", DifyPluginToolsLayer).get_tools(
                        http_client=client, dify_api_http_client=client
                    )
                )[0]

                with pytest.raises(RuntimeError, match="unexpected transport failure"):
                    await tool.function_schema.call(
                        {"query": "dify", "region": "global"},
                        None,  # pyright: ignore[reportArgumentType]
                    )

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("invoke_error_payload", "expected_text"),
    [
        (
            {
                "error_type": "PluginInvokeError",
                "message": json.dumps(
                    {
                        "error_type": "PluginDaemonUnauthorizedError",
                        "message": "invalid api key",
                    }
                ),
            },
            "Please check your tool provider credentials",
        ),
        (
            {
                "error_type": "PluginInvokeError",
                "message": json.dumps(
                    {
                        "error_type": "ToolNotFoundError",
                        "message": "missing plugin tool",
                    }
                ),
            },
            "there is not a tool named web_search",
        ),
    ],
)
def test_dify_plugin_tools_layer_maps_nested_plugin_invoke_errors_to_agent_text(
    invoke_error_payload: dict[str, object],
    expected_text: str,
) -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("tools", _tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(transport=_tool_transport(invoke_error_payload=invoke_error_payload)) as client:
            async with compositor.enter(
                configs={"execution_context": _execution_context_config(), "tools": _tools_config()}
            ) as run:
                tool = (
                    await run.get_layer("tools", DifyPluginToolsLayer).get_tools(
                        http_client=client, dify_api_http_client=client
                    )
                )[0]
                result = await tool.function_schema.call(
                    {"query": "dify", "region": "global"},
                    None,  # pyright: ignore[reportArgumentType]
                )

                assert result == expected_text

    asyncio.run(scenario())


def test_dify_plugin_tools_layer_merges_blob_chunks_before_observation_conversion() -> None:
    async def scenario() -> None:
        compositor = Compositor(
            [
                LayerNode("execution_context", _execution_context_provider()),
                LayerNode("tools", _tools_provider(), deps={"execution_context": "execution_context"}),
            ]
        )
        async with httpx.AsyncClient(transport=_tool_transport(chunked_blob=True)) as client:
            async with compositor.enter(
                configs={"execution_context": _execution_context_config(), "tools": _tools_config()}
            ) as run:
                tool = (
                    await run.get_layer("tools", DifyPluginToolsLayer).get_tools(
                        http_client=client, dify_api_http_client=client
                    )
                )[0]
                result = await tool.function_schema.call(
                    {"query": "dify", "region": "global"},
                    None,  # pyright: ignore[reportArgumentType]
                )

                assert "hello world" in result
                assert "sequence=0" not in result

    asyncio.run(scenario())
