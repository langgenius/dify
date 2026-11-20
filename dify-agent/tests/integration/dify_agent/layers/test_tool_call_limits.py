"""Exercise native Agent dispatch against the actual two Dify HTTP adapters.

FunctionModel supplies deterministic calls. MockTransport records the outbound
HTTP boundary only; native toolsets, argument validation, quota guards and
ToolReturnPart serialization execute unchanged.
"""

import asyncio
import json
from typing import Literal

import httpx
from pydantic_ai import Agent
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel
import pytest

from dify_agent.layers.dify_core_tools import layer as core_layer
from dify_agent.layers.dify_core_tools.configs import DifyCoreToolConfig
from dify_agent.layers.dify_plugin import tools_layer as plugin_layer
from dify_agent.layers.dify_plugin.configs import DifyPluginToolConfig, DifyPluginToolParameter
from dify_agent.layers.execution_context.configs import DifyExecutionContextLayerConfig
from dify_agent.layers.tool_call_limits import tool_identity
from dify_agent.protocol.tool_call_limits import (
    TOOL_CALL_LIMIT_METADATA_KEY,
    TOOL_EXECUTION_FAILED_METADATA_KEY,
    TOOL_VALIDATION_FAILED_METADATA_KEY,
    ToolCallLimitMetadata,
)
from dify_agent.runtime.context import Deps, Services
from dify_agent.runtime.tool_call_limits import ToolCallUsage


pytestmark = pytest.mark.integration


Transport = Literal["plugin", "core"]


def tool_config(transport: Transport, *, tool_name="search", alias=None, limit=3, credential="credential-a"):
    parameters = [DifyPluginToolParameter(name="query", type="string", form="llm", required=True)]
    schema = {"type": "object", "properties": {"query": {"type": "string", "minLength": 1}}, "required": ["query"]}
    common = {
        "tool_name": tool_name,
        "name": alias or tool_name,
        "max_calls_per_run": limit,
        "parameters": parameters,
        "parameters_json_schema": schema,
    }
    if transport == "plugin":
        return DifyPluginToolConfig(
            plugin_id="langgenius/github",
            provider="github",
            credential_type="api-key",
            credentials={"api_key": credential},
            **common,
        )
    return DifyCoreToolConfig(
        provider_type="plugin", provider_id="langgenius/github/github", credential_id=credential, **common
    )


def deps_and_toolsets(client, *configs):
    plugin_tools = [item for item in configs if isinstance(item, DifyPluginToolConfig)]
    core_tools = [item for item in configs if isinstance(item, DifyCoreToolConfig)]
    layers = {
        "execution_context": {
            "config": DifyExecutionContextLayerConfig(
                tenant_id="tenant",
                user_id="user",
                user_from="account",
                app_id="app",
                agent_mode="agent_app",
                invoke_from="web-app",
            ).model_dump(mode="json"),
            "state": {},
        }
    }
    toolsets = []
    if plugin_tools:
        layers["tools"] = {"config": plugin_layer.Config(tools=plugin_tools).model_dump(mode="json"), "state": {}}
        toolsets.append(plugin_layer.Toolset("tools"))
    if core_tools:
        layers["core_tools"] = {"config": core_layer.Config(tools=core_tools).model_dump(mode="json"), "state": {}}
        toolsets.append(core_layer.Toolset("core_tools"))
    return Deps(layers=layers, services=Services(client, client, inner_api_key="inner-key"), run_id="run"), toolsets


def request_tool(request: httpx.Request) -> tuple[Transport, str, dict[str, object]]:
    payload = json.loads(request.content)
    if request.url.path.endswith("/dispatch/tool/invoke"):
        return "plugin", payload["data"]["tool"], payload["data"]["tool_parameters"]
    assert request.url.path == "/inner/api/agent/tools/invoke"
    return "core", payload["tool"]["tool_name"], payload["tool"]["tool_parameters"]


def successful_response(transport: Transport, observation: str) -> httpx.Response:
    if transport == "plugin":
        message = {"code": 0, "message": "", "data": {"type": "text", "message": {"text": observation}}}
        return httpx.Response(200, text="data: " + json.dumps(message) + "\n")
    return httpx.Response(200, json={"observation": observation, "messages": [], "metadata": {}})


def tool_returns(messages) -> list[ToolReturnPart]:
    return [
        part
        for message in messages
        if isinstance(message, ModelRequest)
        for part in message.parts
        if isinstance(part, ToolReturnPart)
    ]


def limit_metadata(part: ToolReturnPart) -> ToolCallLimitMetadata:
    return ToolCallLimitMetadata.model_validate(part.metadata[TOOL_CALL_LIMIT_METADATA_KEY])


@pytest.mark.parametrize("transport", ["plugin", "core"])
def test_batch_limit_checks_dispatch_then_hides_exhausted_tool_but_other_tools_still_run(transport: Transport) -> None:
    async def scenario() -> None:
        dispatched = []
        turns = 0

        def handler(request):
            kind, operation, arguments = request_tool(request)
            dispatched.append((operation, arguments))
            return successful_response(kind, f"found {arguments['query']}")

        async def model(messages, info):
            nonlocal turns
            turns += 1
            names = {tool.name for tool in info.function_tools}
            if turns == 1:
                assert names == {"search", "other"}
                return ModelResponse(
                    parts=[
                        ToolCallPart("search", {"query": f"query-{index}"}, tool_call_id=f"search-{index}")
                        for index in range(4)
                    ]
                )
            assert names == {"other"}
            if turns == 2:
                return ModelResponse(parts=[ToolCallPart("other", {"query": "remaining task"}, tool_call_id="other-1")])
            return ModelResponse(parts=[TextPart("completed with available data")])

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            deps, toolsets = deps_and_toolsets(
                client, tool_config(transport), tool_config(transport, tool_name="export", alias="other", limit=None)
            )
            result = await Agent(FunctionModel(model), deps_type=Deps, toolsets=toolsets).run("research", deps=deps)
            assert result.output == "completed with available data"
            search_dispatches = [arguments for operation, arguments in dispatched if operation == "search"]
            assert len(search_dispatches) == 3
            assert [operation for operation, _arguments in dispatched].count("export") == 1
            records = [part for part in tool_returns(result.all_messages()) if part.tool_name == "search"]
            assert len(records) == 4
            decisions = [limit_metadata(part) for part in records]
            assert sorted(item.used for item in decisions if item.execution_status == "executed") == [1, 2, 3]
            rejected = [item for item in decisions if item.execution_status == "not_executed"]
            assert len(rejected) == 1 and rejected[0].used == rejected[0].limit == 3
            assert rejected[0].reason == "call_limit_reached"
            denied_record = records[decisions.index(rejected[0])]
            assert denied_record.content["execution_status"] == "not_executed"
            assert "was not executed" in denied_record.content["message"]

    asyncio.run(scenario())


@pytest.mark.parametrize("transport", ["plugin", "core"])
def test_invalid_model_arguments_do_not_consume_the_remaining_dispatch(transport: Transport) -> None:
    async def scenario() -> None:
        dispatched = []
        turns = 0

        def handler(request):
            kind, operation, arguments = request_tool(request)
            dispatched.append((operation, arguments))
            return successful_response(kind, "valid request completed")

        async def model(messages, info):
            nonlocal turns
            turns += 1
            if turns == 1:
                return ModelResponse(
                    parts=[
                        ToolCallPart("search", {}, tool_call_id="invalid"),
                        ToolCallPart("search", {"query": "valid"}, tool_call_id="valid"),
                    ]
                )
            assert not info.function_tools
            return ModelResponse(parts=[TextPart("finished")])

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            config = tool_config(transport, limit=1)
            deps, toolsets = deps_and_toolsets(client, config)
            result = await Agent(FunctionModel(model), deps_type=Deps, toolsets=toolsets).run("research", deps=deps)
            assert dispatched == [("search", {"query": "valid"})]
            records = tool_returns(result.all_messages())
            assert len(records) == 2
            invalid = next(part for part in records if part.tool_call_id == "invalid")
            assert invalid.metadata == {TOOL_VALIDATION_FAILED_METADATA_KEY: True}
            assert "validation error" in str(invalid.content)
            valid = next(part for part in records if part.tool_call_id == "valid")
            assert limit_metadata(valid).used == 1
            assert await deps.tool_call_limit_store.usage(
                run_id=deps.run_id, tool_identity=tool_identity(config), limit=1
            ) == ToolCallUsage(1, 1)

    asyncio.run(scenario())


@pytest.mark.parametrize("transport", ["plugin", "core"])
@pytest.mark.parametrize("failure", ["failed", "timeout"])
def test_dispatched_failures_and_timeouts_remain_charged(transport: Transport, failure: str) -> None:
    async def scenario() -> None:
        dispatched = []
        turns = 0

        def handler(request):
            kind, operation, arguments = request_tool(request)
            dispatched.append((operation, arguments))
            if failure == "timeout":
                raise httpx.ReadTimeout("upstream timed out", request=request)
            return httpx.Response(503, json={"code": "service_unavailable", "message": "upstream unavailable"})

        async def model(messages, info):
            nonlocal turns
            turns += 1
            if turns == 1:
                return ModelResponse(
                    parts=[
                        ToolCallPart("search", {"query": "first"}, tool_call_id="first"),
                        ToolCallPart("search", {"query": "retry"}, tool_call_id="retry"),
                    ]
                )
            assert not info.function_tools
            return ModelResponse(parts=[TextPart("could not obtain external data")])

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            config = tool_config(transport, limit=1)
            deps, toolsets = deps_and_toolsets(client, config)
            result = await Agent(FunctionModel(model), deps_type=Deps, toolsets=toolsets).run("research", deps=deps)
            assert len(dispatched) == 1
            records = tool_returns(result.all_messages())
            decisions = [limit_metadata(part) for part in records]
            for record, decision in zip(records, decisions, strict=True):
                if decision.execution_status == "executed":
                    assert record.metadata[TOOL_EXECUTION_FAILED_METADATA_KEY] is True
                else:
                    assert TOOL_EXECUTION_FAILED_METADATA_KEY not in record.metadata
            assert sorted(item.execution_status for item in decisions) == ["executed", "not_executed"]
            assert {item.used for item in decisions} == {1}
            assert {item.limit for item in decisions} == {1}
            assert result.output == "could not obtain external data"

    asyncio.run(scenario())


@pytest.mark.parametrize("transport", ["plugin", "core", "mixed"])
def test_aliases_credentials_and_transport_routes_share_the_strictest_configured_limit(transport: str) -> None:
    async def scenario() -> None:
        dispatched = []
        turns = 0
        first_kind = "core" if transport == "core" else "plugin"
        second_kind = "plugin" if transport == "plugin" else "core"
        configs = (
            tool_config(first_kind, alias="search_a", limit=4),
            tool_config(second_kind, alias="search_b", limit=2, credential="credential-b"),
        )

        def handler(request):
            kind, operation, arguments = request_tool(request)
            dispatched.append((kind, operation, arguments))
            return successful_response(kind, "result")

        async def model(messages, info):
            nonlocal turns
            turns += 1
            if turns == 1:
                assert {tool.name for tool in info.function_tools} == {"search_a", "search_b"}
                return ModelResponse(
                    parts=[
                        ToolCallPart("search_a", {"query": "first"}, tool_call_id="first"),
                        ToolCallPart("search_b", {"query": "second"}, tool_call_id="second"),
                        ToolCallPart("search_a", {"query": "third"}, tool_call_id="third"),
                    ]
                )
            assert not info.function_tools
            return ModelResponse(parts=[TextPart("finished")])

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            deps, toolsets = deps_and_toolsets(client, *configs)
            result = await Agent(FunctionModel(model), deps_type=Deps, toolsets=toolsets).run("research", deps=deps)
            assert len(dispatched) == 2
            decisions = [limit_metadata(part) for part in tool_returns(result.all_messages())]
            assert len({item.tool_identity for item in decisions}) == 1
            assert {item.limit for item in decisions} == {2}
            assert sum(item.execution_status == "not_executed" for item in decisions) == 1

    asyncio.run(scenario())


@pytest.mark.parametrize("transport", ["plugin", "core"])
@pytest.mark.parametrize(
    "parameter_type,schema_type,default,arguments,prepared_value",
    [
        ("string", "string", "default query", {}, "default query"),
        ("number", "number", None, {"query": "3.5"}, 3.5),
        ("string", "string", None, {"query": 123}, "123"),
        ("boolean", "boolean", None, {"query": "false"}, False),
        ("array", "array", None, {"query": '["a", "b"]'}, ["a", "b"]),
        ("object", "object", None, {"query": '{"a": 1}'}, {"a": 1}),
    ],
)
def test_enabling_quota_preserves_defaults_and_existing_parameter_conversions(
    transport: Transport, parameter_type, schema_type, default, arguments, prepared_value
) -> None:
    async def scenario() -> None:
        dispatched = []
        turns = 0
        config = tool_config(transport, limit=1).model_copy(
            update={
                "parameters": [
                    DifyPluginToolParameter(
                        name="query", type=parameter_type, form="llm", required=True, default=default
                    ),
                    DifyPluginToolParameter(name="secret", type="secret-input", form="form", required=True),
                ],
                "runtime_parameters": {"secret": "hidden value"},
                "parameters_json_schema": {
                    "type": "object",
                    "properties": {"query": {"type": schema_type}},
                    "required": ["query"],
                    "additionalProperties": False,
                },
            }
        )

        def handler(request):
            kind, operation, actual = request_tool(request)
            dispatched.append(actual)
            if kind == "plugin":
                assert actual == {"query": prepared_value, "secret": "hidden value"}
            else:
                # The API remains the actual invocation/default/casting owner.
                assert actual == arguments
                assert json.loads(request.content)["tool"]["runtime_parameters"] == {"secret": "hidden value"}
            return successful_response(kind, "completed")

        async def model(messages, info):
            nonlocal turns
            turns += 1
            if turns == 1:
                return ModelResponse(parts=[ToolCallPart("search", arguments, tool_call_id="call")])
            assert not info.function_tools
            return ModelResponse(parts=[TextPart("finished")])

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            deps, toolsets = deps_and_toolsets(client, config)
            result = await Agent(FunctionModel(model), deps_type=Deps, toolsets=toolsets).run("research", deps=deps)
            assert len(dispatched) == 1
            assert limit_metadata(tool_returns(result.all_messages())[0]).used == 1

    asyncio.run(scenario())


@pytest.mark.parametrize("transport", ["plugin", "core"])
@pytest.mark.parametrize(
    "schema", [{"type": 123}, {"type": "string", "pattern": "["}, {"$ref": "https://invalid.test/schema"}]
)
def test_invalid_schema_is_a_nonexecuted_parameter_error_without_network_or_quota(transport: Transport, schema) -> None:
    async def scenario() -> None:
        requests = []
        turns = 0
        config = tool_config(transport, limit=1).model_copy(update={"parameters_json_schema": schema})

        def handler(request):
            requests.append(request)
            raise AssertionError("Invalid schema must not retrieve references or dispatch a tool")

        async def model(messages, info):
            nonlocal turns
            turns += 1
            if turns == 1:
                return ModelResponse(parts=[ToolCallPart("search", {"query": "query"}, tool_call_id="call")])
            assert {tool.name for tool in info.function_tools} == {"search"}
            return ModelResponse(parts=[TextPart("cannot execute invalid tool schema")])

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            deps, toolsets = deps_and_toolsets(client, config)
            result = await Agent(FunctionModel(model), deps_type=Deps, toolsets=toolsets).run("research", deps=deps)
            assert not requests
            record = tool_returns(result.all_messages())[0]
            assert "validation error" in record.content
            assert record.metadata == {TOOL_VALIDATION_FAILED_METADATA_KEY: True}
            assert await deps.tool_call_limit_store.usage(
                run_id=deps.run_id, tool_identity=tool_identity(config), limit=1
            ) == ToolCallUsage(0, 1)

    asyncio.run(scenario())


def test_plugin_file_locator_keeps_model_schema_shape_after_daemon_parameter_preparation() -> None:
    async def scenario() -> None:
        dispatched = []
        turns = 0
        url = "https://example.com/report.txt"
        config = tool_config("plugin", limit=1).model_copy(
            update={
                "parameters": [DifyPluginToolParameter(name="query", type="file", form="llm", required=True)],
                "parameters_json_schema": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                },
            }
        )

        def handler(request):
            kind, operation, arguments = request_tool(request)
            dispatched.append(arguments)
            assert isinstance(arguments["query"], dict) and arguments["query"]["url"] == url
            return successful_response(kind, "file processed")

        async def model(messages, info):
            nonlocal turns
            turns += 1
            if turns == 1:
                return ModelResponse(parts=[ToolCallPart("search", {"query": [url]}, tool_call_id="file")])
            return ModelResponse(parts=[TextPart("finished")])

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            deps, toolsets = deps_and_toolsets(client, config)
            result = await Agent(FunctionModel(model), deps_type=Deps, toolsets=toolsets).run("research", deps=deps)
            assert len(dispatched) == 1
            assert limit_metadata(tool_returns(result.all_messages())[0]).used == 1

    asyncio.run(scenario())
