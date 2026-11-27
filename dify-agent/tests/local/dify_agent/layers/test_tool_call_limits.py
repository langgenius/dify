"""Quota guards preserve operation identity and native tool-return contracts."""

import asyncio
import json
from typing import cast

import httpx
from pydantic import JsonValue
from pydantic_ai import Agent, RunContext, ToolReturn
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage
import pytest

from dify_agent.layers.dify_core_tools.configs import DifyCoreToolConfig, DifyCoreToolsLayerConfig
from dify_agent.layers.dify_plugin.configs import (
    DifyPluginToolConfig,
    DifyPluginToolParameter,
    DifyPluginToolsLayerConfig,
)
from dify_agent.layers.tool_call_limits import (
    DifyToolConfig,
    ToolCallLimitGuard,
    tool_identity,
    prepare_core_tool_validation_arguments,
    validate_limited_tool_arguments,
)
from dify_agent.protocol.tool_call_limits import (
    TOOL_CALL_LIMIT_METADATA_KEY,
    TOOL_EXECUTION_FAILED_METADATA_KEY,
    ToolCallLimitMetadata,
)
from dify_agent.runtime.context import Deps, Services
from dify_agent.runtime.tool_call_limits import ToolCallReservation, ToolCallUsage


def plugin_tool(**changes: object) -> DifyPluginToolConfig:
    values = {
        "plugin_id": "langgenius/github",
        "plugin_unique_identifier": "langgenius/github:1.0.0@package-a",
        "provider": "github",
        "tool_name": "search",
        "name": "search_fast",
        "credential_type": "api-key",
        "credentials": {"api_key": "credential-a"},
        "max_calls_per_run": 5,
    }
    values.update(changes)
    return DifyPluginToolConfig.model_validate(values)


def core_tool(**changes: object) -> DifyCoreToolConfig:
    values = {
        "provider_type": "plugin",
        "provider_id": "langgenius/github/github",
        "tool_name": "search",
        "name": "search_safe",
        "credential_id": "credential-b",
        "max_calls_per_run": 2,
    }
    values.update(changes)
    return DifyCoreToolConfig.model_validate(values)


def configured_deps(client: httpx.AsyncClient, *tools: DifyToolConfig) -> Deps:
    return Deps(
        layers={
            "tools": {
                "config": DifyPluginToolsLayerConfig(
                    tools=[tool for tool in tools if isinstance(tool, DifyPluginToolConfig)]
                ).model_dump(mode="json"),
                "state": {},
            },
            "core_tools": {
                "config": DifyCoreToolsLayerConfig(
                    tools=[tool for tool in tools if isinstance(tool, DifyCoreToolConfig)]
                ).model_dump(mode="json"),
                "state": {},
            },
        },
        services=Services(client, client),
        run_id="run-a",
    )


def context(deps: Deps, call_id: str | None = "call") -> RunContext[Deps]:
    return RunContext(deps=deps, model=TestModel(), usage=RunUsage(), tool_call_id=call_id)


def test_alias_credentials_installation_version_and_transport_do_not_create_new_quota() -> None:
    async def scenario() -> None:
        direct = plugin_tool()
        duplicate = plugin_tool(
            name="another_alias",
            credentials={"api_key": "credential-c"},
            plugin_unique_identifier="langgenius/github:2.0.0@package-b",
            max_calls_per_run=None,
        )
        routed = core_tool()
        assert tool_identity(direct) == tool_identity(duplicate) == tool_identity(routed)
        async with httpx.AsyncClient() as client:
            deps = configured_deps(client, direct, duplicate, routed)
            guards = [ToolCallLimitGuard.for_tool(deps, tool) for tool in (direct, duplicate, routed)]
            assert all(guard is not None and guard.limit == 2 for guard in guards)
            first_guard, second_guard, third_guard = cast(list[ToolCallLimitGuard], guards)
            assert (await first_guard.reserve(context(deps, "first"))).allowed
            assert (await second_guard.reserve(context(deps, "second"))).allowed
            assert not await third_guard.available(context(deps))
            assert await third_guard.reserve(context(deps, "third")) == ToolCallReservation(
                2, 2, False, "call_limit_reached"
            )
            assert await first_guard.reserve(context(deps, "first")) == ToolCallReservation(
                2, 2, False, "duplicate_tool_call"
            )

    asyncio.run(scenario())


@pytest.mark.parametrize("provider_id", ["github", "langgenius/github/github"])
def test_legacy_short_plugin_provider_uses_the_same_operation_key(provider_id: str) -> None:
    assert tool_identity(plugin_tool()) == tool_identity(core_tool(provider_id=provider_id))


@pytest.mark.parametrize("provider", ["jina", "siliconflow", "stepfun", "gitee_ai"])
def test_legacy_plugin_aliases_match_the_existing_api_provider_normalization(provider: str) -> None:
    direct = plugin_tool(plugin_id=f"langgenius/{provider}_tool", provider=provider)
    assert tool_identity(direct) == tool_identity(core_tool(provider_id=provider))
    assert tool_identity(direct) == tool_identity(core_tool(provider_id=f"langgenius/{provider}/{provider}"))


def test_other_provider_operations_have_independent_limits_and_only_explicit_limits_apply() -> None:
    async def scenario() -> None:
        direct = plugin_tool(max_calls_per_run=5)
        other_tools = (
            core_tool(tool_name="export", max_calls_per_run=1),
            core_tool(provider_id="another/github/github", max_calls_per_run=1),
            core_tool(provider_type="api", max_calls_per_run=1),
        )
        async with httpx.AsyncClient() as client:
            deps = configured_deps(client, direct, *other_tools)
            guard = ToolCallLimitGuard.for_tool(deps, direct)
            assert guard is not None and guard.limit == 5
            unlimited = plugin_tool(tool_name="unlimited", max_calls_per_run=None)
            assert ToolCallLimitGuard.for_tool(deps, unlimited) is None
            # A directly built tool still contributes its own configuration.
            standalone = ToolCallLimitGuard.for_tool(deps, plugin_tool(tool_name="standalone", max_calls_per_run=9))
            assert standalone is not None and standalone.limit == 9
            assert (await guard.reserve(context(deps))).allowed
            new_run = Deps(layers=deps.layers, services=deps.services, run_id="run-b")
            assert await guard.available(context(new_run))

    asyncio.run(scenario())


def test_guard_needs_a_real_call_identifier_before_it_reserves() -> None:
    async def scenario() -> None:
        tool = plugin_tool()
        async with httpx.AsyncClient() as client:
            deps = configured_deps(client, tool)
            guard = ToolCallLimitGuard.for_tool(deps, tool)
            assert guard is not None
            with pytest.raises(ValueError, match="stable native tool call id"):
                await guard.reserve(context(deps, None))
            assert await deps.tool_call_limit_store.usage(
                run_id=deps.run_id, tool_identity=guard.identity, limit=guard.limit
            ) == ToolCallUsage(0, 5)

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "schema,parameters,runtime_parameters,arguments",
    [
        ({"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}, [], {}, {}),
        ({"type": "object", "properties": {"query": {"type": "string"}}}, [], {}, {"query": 123}),
        (
            {"type": "object"},
            [{"name": "secret", "type": "secret-input", "form": "form", "required": True}],
            {},
            {},
        ),
        ({"$ref": "https://unresolvable.invalid/schema.json"}, [], {}, {}),
    ],
)
def test_invalid_parameters_cannot_consume_quota(
    schema: dict[str, JsonValue],
    parameters: list[dict[str, object]],
    runtime_parameters: dict[str, object],
    arguments: dict[str, object],
) -> None:
    async def scenario() -> None:
        tool = plugin_tool()
        async with httpx.AsyncClient() as client:
            deps = configured_deps(client, tool)
            guard = ToolCallLimitGuard.for_tool(deps, tool)
            assert guard is not None
            with pytest.raises(ValueError):
                validate_limited_tool_arguments(
                    schema,
                    [DifyPluginToolParameter.model_validate(parameter) for parameter in parameters],
                    runtime_parameters,
                    arguments,
                )
                await guard.reserve(context(deps))
            assert await deps.tool_call_limit_store.usage(
                run_id=deps.run_id, tool_identity=guard.identity, limit=guard.limit
            ) == ToolCallUsage(0, guard.limit)

    asyncio.run(scenario())


def test_valid_hidden_defaults_and_local_schema_references_require_no_external_resolution() -> None:
    schema = {
        "$defs": {"query": {"type": "string", "minLength": 1}},
        "type": "object",
        "properties": {"query": {"$ref": "#/$defs/query"}},
        "required": ["query"],
    }
    parameters = [
        DifyPluginToolParameter(name="secret", type="secret-input", form="form", required=True),
        DifyPluginToolParameter(name="region", type="string", form="form", required=True, default="us"),
    ]
    validate_limited_tool_arguments(
        cast(dict[str, JsonValue], schema), parameters, {"secret": "hidden"}, {"query": "rag"}
    )


def test_guard_metadata_roundtrip_and_denial_are_separate_from_success_content() -> None:
    guard = ToolCallLimitGuard("identity", 3)
    success = guard.result(ToolCallReservation(3, 3, True), "external result")
    assert success.return_value == "external result"
    metadata = ToolCallLimitMetadata.model_validate(success.metadata[TOOL_CALL_LIMIT_METADATA_KEY])
    assert metadata.execution_status == "executed" and metadata.reason is None and metadata.used == 3
    assert ToolCallLimitMetadata.model_validate_json(metadata.model_dump_json()) == metadata
    denied = guard.denied(ToolCallReservation(3, 3, False, "call_limit_reached"))
    assert denied.return_value["execution_status"] == "not_executed"
    assert denied.return_value["used"] == 3
    assert "was not executed" in denied.return_value["message"]
    assert "external result" not in json.dumps(denied.return_value)
    assert denied.metadata[TOOL_CALL_LIMIT_METADATA_KEY]["reason"] == "call_limit_reached"
    duplicate = guard.denied(ToolCallReservation(1, 3, False, "duplicate_tool_call"))
    assert duplicate.return_value["reason"] == "duplicate_tool_call"
    assert "not confirmed" in duplicate.return_value["message"]


def test_native_tool_records_keep_authoritative_metadata_after_parallel_dispatch() -> None:
    async def scenario() -> None:
        tool = plugin_tool(max_calls_per_run=2)
        async with httpx.AsyncClient() as client:
            deps = configured_deps(client, tool)
            guard = ToolCallLimitGuard.for_tool(deps, tool)
            assert guard is not None
            dispatched: list[str] = []

            async def model(messages, info):
                returns = [
                    part
                    for message in messages
                    if isinstance(message, ModelRequest)
                    for part in message.parts
                    if isinstance(part, ToolReturnPart)
                ]
                if not returns:
                    return ModelResponse(
                        parts=[
                            ToolCallPart("search", {"query": f"query-{index}"}, tool_call_id=f"call-{index}")
                            for index in range(3)
                        ]
                    )
                return ModelResponse(parts=[TextPart("finished")])

            agent = Agent(FunctionModel(model), deps_type=Deps)

            @agent.tool
            async def search(ctx: RunContext[Deps], query: str) -> ToolReturn:
                reservation = await guard.reserve(ctx)
                if not reservation.allowed:
                    return guard.denied(reservation)
                dispatched.append(query)
                return guard.result(reservation, f"found {query}")

            result = await agent.run("search", deps=deps)
            assert result.output == "finished" and len(dispatched) == 2
            returns = [
                part
                for message in result.all_messages()
                if isinstance(message, ModelRequest)
                for part in message.parts
                if isinstance(part, ToolReturnPart)
            ]
            assert len(returns) == 3
            metadata = [
                ToolCallLimitMetadata.model_validate(part.metadata[TOOL_CALL_LIMIT_METADATA_KEY]) for part in returns
            ]
            assert sum(item.execution_status == "executed" for item in metadata) == 2
            rejected = [item for item in metadata if item.execution_status == "not_executed"]
            assert len(rejected) == 1 and rejected[0].used == rejected[0].limit == 2
            assert rejected[0].reason == "call_limit_reached"

    asyncio.run(scenario())


def test_core_validation_uses_api_runtime_precedence_without_mutating_any_input() -> None:
    schema = {
        "type": "object",
        "properties": {"query": {"type": "number"}},
        "required": ["query"],
        "additionalProperties": False,
    }
    parameters = [
        DifyPluginToolParameter(name="query", type="number", form="llm", required=True),
        DifyPluginToolParameter(name="hidden", type="secret-input", form="form", required=True),
    ]
    runtime = {"query": "7", "hidden": "secret"}
    model = {"query": "not-a-number"}
    prepared = prepare_core_tool_validation_arguments(cast(dict[str, JsonValue], schema), parameters, runtime, model)
    assert prepared == {"query": 7, "hidden": "secret"}
    validate_limited_tool_arguments(
        cast(dict[str, JsonValue], schema), parameters, runtime, model, prepared_arguments=prepared
    )
    assert runtime == {"query": "7", "hidden": "secret"} and model == {"query": "not-a-number"}


def test_core_validation_preserves_multiple_select_conversion_and_required_checks() -> None:
    schema = {
        "type": "object",
        "properties": {"choice": {"type": "array", "items": {"type": "string", "enum": ["a", "b"]}}},
        "required": ["choice"],
    }
    parameters = [DifyPluginToolParameter(name="choice", type="select", form="llm", required=True)]
    arguments = {"choice": "a, b"}
    prepared = prepare_core_tool_validation_arguments(cast(dict[str, JsonValue], schema), parameters, {}, arguments)
    assert prepared == {"choice": ["a", "b"]}
    validate_limited_tool_arguments(
        cast(dict[str, JsonValue], schema), parameters, {}, arguments, prepared_arguments=prepared
    )
    with pytest.raises(ValueError, match="not found"):
        prepare_core_tool_validation_arguments(cast(dict[str, JsonValue], schema), parameters, {}, {"choice": []})


def test_failed_execution_marker_only_applies_to_an_admitted_dispatch() -> None:
    guard = ToolCallLimitGuard("identity", 3)
    result = guard.result(ToolCallReservation(1, 3, True), "upstream timed out", failed=True)
    assert result.metadata[TOOL_EXECUTION_FAILED_METADATA_KEY] is True
    assert result.metadata[TOOL_CALL_LIMIT_METADATA_KEY]["execution_status"] == "executed"
    success = guard.result(ToolCallReservation(1, 3, True), "result")
    assert TOOL_EXECUTION_FAILED_METADATA_KEY not in success.metadata
    with pytest.raises(ValueError, match="unexecuted"):
        guard.result(ToolCallReservation(3, 3, False, "call_limit_reached"), "not executed", failed=True)
