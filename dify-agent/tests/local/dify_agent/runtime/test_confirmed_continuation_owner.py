"""Real SDK continuation with a synthetic authenticated API authority."""

import asyncio
import importlib
import importlib.util
import json
import os
from contextlib import asynccontextmanager
from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError
from pydantic_ai import Agent, DeferredToolRequests
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from dify_agent.adapters.native_testing.transport import AgentRuntimeHTTPClient, bind_runtime_identity
from dify_agent.layers.dify_core_tools.layer import Toolset
from dify_agent.protocol.native_testing import (
    AgentNativeTestRef,
    AgentRuntimeIdentity,
    NativeTestCapabilities,
    NativeTestProtocolUnsupported,
    executable_request_digest,
    require_native_test_capabilities,
)
from dify_agent.protocol.schemas import CreateRunRequest
from dify_agent.runtime.context import Deps, Services
from dify_agent.runtime.native_continuation import AgentCheckpoint, NativePolicyStopped

REF = AgentNativeTestRef(
    policy_version="builder-native-test-v1", request_id="request", invocation_id="invocation", context_digest="a" * 64
)
PARENT = {
    "ref": REF.model_dump(),
    "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
    "input_result_ref": "input",
    "input_digest": "b" * 64,
}


def request():
    return CreateRunRequest.model_validate(
        {
            "execution_mode": "builder_test",
            "idempotency_key": "create-confirmed",
            "native_test_profile": "confirmed",
            "native_test_ref": REF,
            "native_test_protocol_version": 1,
            "native_parent_node": PARENT,
            "composition": {
                "layers": [
                    {
                        "name": "execution_context",
                        "config": {
                            "agent_mode": "workflow_run",
                            "tenant_id": "tenant",
                            "user_id": "actor",
                            "user_from": "account",
                            "app_id": "app",
                            "invoke_from": "debugger",
                        },
                    },
                    {
                        "name": "core_tools",
                        "config": {
                            "tools": [
                                {
                                    "provider_type": "plugin",
                                    "provider_id": "provider",
                                    "tool_name": "write",
                                    "parameters_json_schema": {
                                        "type": "object",
                                        "properties": {"target": {"type": "string"}},
                                        "required": ["target"],
                                    },
                                }
                            ]
                        },
                    },
                ]
            },
        }
    )


def owner_type():
    name = "dify_agent.runtime.confirmed_continuation"
    assert importlib.util.find_spec(name) is not None, "Concrete confirmed continuation owner is missing"
    return importlib.import_module(name).ConfirmedNativeContinuationOwner


def test_confirmed_profile_requires_only_implemented_features_and_old_default_is_strict():
    caps = NativeTestCapabilities(
        protocol_version=1, features={"pending-call-v1", "policy-gate-v1", "create-idempotency-v1"}
    )
    assert request().native_test_profile == "confirmed"
    require_native_test_capabilities(caps, profile="confirmed")
    with pytest.raises(NativeTestProtocolUnsupported):
        require_native_test_capabilities(caps)
    ordinary = CreateRunRequest(composition={"layers": []})
    assert ordinary.native_test_profile == "isolated"
    with pytest.raises(ValidationError):
        CreateRunRequest(composition={"layers": []}, native_test_profile="confirmed")


@asynccontextmanager
async def checkpoint_storage(durable):
    if not durable:
        yield None, "run"
        return
    from redis.asyncio import Redis
    from dify_agent.storage.redis_run_store import RedisRunStore

    redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
    prefix = "confirmed-owner-" + uuid4().hex
    store = RedisRunStore(redis, prefix=prefix, run_retention_seconds=60)
    try:
        record = await store.create_run()
        yield store, record.run_id
    finally:
        keys = [key async for key in redis.scan_iter(prefix + ":*")]
        if keys:
            await redis.delete(*keys)
        await redis.aclose()


@pytest.mark.parametrize(
    "durable",
    [
        False,
        pytest.param(
            True,
            marks=pytest.mark.skipif(
                not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="requires provisioned Redis"
            ),
        ),
    ],
)
@pytest.mark.parametrize("decision", ["dispatch", "stop", "recorded", "changed", "unknown"])
def test_real_sdk_confirmed_owner_wait_restore_and_exact_single_dispatch(decision, durable):
    async def scenario(store, run_id):
        owner_class = owner_type()
        req = request()
        digest = executable_request_digest(req)
        identity = AgentRuntimeIdentity(
            execution_mode="builder_test", parent_node=PARENT, request_digest=digest, run_id=run_id, agent_generation=0
        )
        mode = "waiting"
        calls = []
        saved = {}

        def transport(wire):
            nonlocal mode
            assert wire.headers["Authorization"] == "Bearer service"
            body = json.loads(wire.content)
            route = wire.url.path.rsplit("/", 1)[-1]
            calls.append(route)
            if route == "prepare-run":
                return httpx.Response(
                    200, json={"config_ref": "config", "config_digest": digest, "association_object_ref": "association"}
                )
            if route == "prepared-config":
                return httpx.Response(
                    200,
                    json={
                        "parent_node": PARENT,
                        "config_ref": "config",
                        "config_digest": digest,
                        "config": req.model_dump(mode="json", include={"composition", "session_snapshot"}),
                    },
                )
            if route == "prepare-intent":
                intent = {
                    "key": body["key"],
                    "kind": "tool",
                    "resource_ref": "tool",
                    "implementation_revision": "version",
                    "account_ref": None,
                    "target": body["target"],
                    "parameters": ({"target": "changed-resource"} if mode == "changed" else body["parameters"]),
                    "input_digest": "b" * 64,
                    "capability_digest": "c" * 64,
                }
                return httpx.Response(200, json=intent)
            if route == "before-call":
                return httpx.Response(
                    200,
                    json={
                        "waiting": {"kind": "waiting", "pending_operation_id": "pending"},
                        "dispatch": {
                            "kind": "dispatch",
                            "permit_id": "permit",
                            "attempt_id": "attempt",
                            "operation_id": "operation",
                            "expires_at": "2099-01-01T00:00:00Z",
                        },
                        "stop": {"kind": "stop", "reason_code": "approval_denied"},
                        "unknown": {"kind": "stop", "reason_code": "operation_unknown"},
                        "changed": {
                            "kind": "dispatch",
                            "permit_id": "permit",
                            "attempt_id": "attempt",
                            "operation_id": "operation",
                            "expires_at": "2099-01-01T00:00:00Z",
                        },
                        "recorded": {"kind": "recorded", "operation_id": "operation", "result_ref": "result"},
                    }[mode],
                )
            if route == "invoke":
                assert body["tool"]["tool_parameters"] == {"target": "dynamic-resource"}
                assert body["native_dispatch"]["intent"]["parameters"] == {"target": "dynamic-resource"}
                return httpx.Response(200, json={"observation": "stored"})
            if route == "results":
                saved["result"] = body["result"]
                return httpx.Response(200, json={"result_ref": "result"})
            if route == "read-result":
                return httpx.Response(200, json={"result": saved.get("result", "stored")})
            if route == "outcome":
                mode = "recorded"
                return httpx.Response(
                    200,
                    json={
                        "operation_id": "operation",
                        "attempt_id": "attempt",
                        "outcome": body["outcome"],
                        "result_ref": body["result_ref"],
                    },
                )
            raise AssertionError(route)

        model_requests = []

        def model(messages, info):
            model_requests.append(messages)
            if any(isinstance(part, ToolReturnPart) for message in messages for part in message.parts):
                return ModelResponse(parts=[TextPart("done")])
            return ModelResponse(parts=[ToolCallPart("write", {"target": "dynamic-resource"}, tool_call_id="call")])

        async with AgentRuntimeHTTPClient(
            api_url="http://api", api_token="service", transport=httpx.MockTransport(transport)
        ) as client:
            services = Services(client, client, inner_api_url="http://api")

            def deps():
                return Deps(
                    layers={layer.name: {"config": layer.config, "state": {}} for layer in req.composition.layers},
                    services=services,
                    run_id=run_id,
                )

            with bind_runtime_identity(identity):
                owner = owner_class(http_client=client, base_url="http://api")
                continuation = await owner.prepare(run_id=run_id, request=req)
                agent = Agent(
                    FunctionModel(model),
                    toolsets=[Toolset("core_tools")],
                    output_type=[str, DeferredToolRequests],
                    capabilities=continuation.capabilities,
                )
                first_deps = deps()
                first = await agent.run("write", deps=first_deps)
                assert isinstance(first.output, DeferredToolRequests)
                checkpoint = AgentCheckpoint.model_validate_json(
                    continuation.capture(result=first, deps=first_deps).model_dump_json()
                )
                assert calls.count("invoke") == 0
                assert checkpoint.native_test_profile == "confirmed"
                if store is not None:
                    from dify_agent.storage.redis_run_store import RedisRunStore

                    await store.persist_waiting(run_id=run_id, checkpoint=checkpoint, event=checkpoint.waiting_event())
                    restarted_store = RedisRunStore(store.redis, prefix=store.prefix)
                    checkpoint = await restarted_store.get_checkpoint(run_id)
                    assert checkpoint.native_test_profile == "confirmed"
                mode = decision
                restarted = owner_class(http_client=client, base_url="http://api")
                if decision in {"stop", "unknown"}:
                    with pytest.raises(NativePolicyStopped, match="approval_denied|operation_unknown"):
                        await restarted.restore(checkpoint=checkpoint)
                    assert calls.count("invoke") == 0
                    assert len(model_requests) == 1
                    return
                prepared = await restarted.restore(checkpoint=checkpoint)
                restored_agent = Agent(
                    FunctionModel(model),
                    toolsets=[Toolset("core_tools")],
                    output_type=[str, DeferredToolRequests],
                    capabilities=prepared.continuation.capabilities,
                )
                if decision == "changed":
                    with pytest.raises(NativePolicyStopped, match="native_effect_arguments_changed"):
                        await restored_agent.run(
                            message_history=checkpoint.history,
                            deferred_tool_results=prepared.deferred_tool_results,
                            deps=deps(),
                        )
                    assert calls.count("invoke") == 0
                    assert len(model_requests) == 1
                    return
                result = await restored_agent.run(
                    message_history=checkpoint.history,
                    deferred_tool_results=prepared.deferred_tool_results,
                    deps=deps(),
                )
                assert result.output == "done"
                assert calls.count("invoke") == (1 if decision == "dispatch" else 0)
                assert len(model_requests) == 2  # Only the original request and final answer.
                replay = await restarted.restore(checkpoint=checkpoint)
                replay_agent = Agent(
                    FunctionModel(model),
                    toolsets=[Toolset("core_tools")],
                    capabilities=replay.continuation.capabilities,
                )
                assert (
                    await replay_agent.run(
                        message_history=checkpoint.history,
                        deferred_tool_results=replay.deferred_tool_results,
                        deps=deps(),
                    )
                ).output == "done"
                assert calls.count("invoke") == (1 if decision == "dispatch" else 0)

    async def exercise():
        async with checkpoint_storage(durable) as (store, run_id):
            await scenario(store, run_id)

    asyncio.run(exercise())


def test_confirmed_scheduler_keeps_ordinary_legacy_services_and_uses_strict_run_client():
    from dify_agent.runtime.run_scheduler import RunScheduler
    from types import SimpleNamespace

    async def exercise():
        owner_class = owner_type()
        async with (
            httpx.AsyncClient() as legacy,
            AgentRuntimeHTTPClient(
                api_url="http://api", api_token="service", transport=httpx.MockTransport(lambda r: httpx.Response(200))
            ) as strict,
        ):
            services = Services(
                legacy,
                legacy,
                inner_api_key="ordinary-key",
                plugin_daemon_api_key="ordinary-daemon",
                confirmed_api_http_client=strict,
            )
            scheduler = RunScheduler(
                store=None, services=services, native_owner=owner_class(http_client=strict, base_url="http://api")
            )
            marked_runner = scheduler._default_runner_factory(
                SimpleNamespace(run_id="run"), request(), is_cancelled=lambda: False
            )
            assert marked_runner.services.dify_api_http_client is strict
            assert marked_runner.services.inner_api_key == ""
            assert marked_runner.services.plugin_daemon_api_key == ""
            ordinary_runner = scheduler._default_runner_factory(
                SimpleNamespace(run_id="ordinary"),
                CreateRunRequest(composition={"layers": []}),
                is_cancelled=lambda: False,
            )
            assert ordinary_runner.services is services
            assert ordinary_runner.services.dify_api_http_client is legacy
            assert ordinary_runner.services.inner_api_key == "ordinary-key"

    asyncio.run(exercise())


def test_confirmed_profile_requires_create_recovery_capability_before_post():
    from dify_agent.client import Client

    async def exercise():
        sent = []

        def transport(wire):
            sent.append(wire.method)
            return httpx.Response(200, json={"protocol_version": 1, "features": ["pending-call-v1", "policy-gate-v1"]})

        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
            client = Client(base_url="http://backend", async_http_client=http)
            with pytest.raises(NativeTestProtocolUnsupported):
                await client.create_run(request())
        assert sent == ["GET"]

    asyncio.run(exercise())


@pytest.mark.parametrize("synchronous", [False, True])
def test_confirmed_sdk_negotiates_implemented_profile_and_sends_one_create(synchronous):
    from dify_agent.client import Client

    sent = []

    def transport(wire):
        sent.append(wire.method)
        if wire.method == "GET":
            return httpx.Response(
                200,
                json={
                    "protocol_version": 1,
                    "features": ["pending-call-v1", "policy-gate-v1", "create-idempotency-v1"],
                },
            )
        return httpx.Response(202, json={"run_id": "run", "status": "running"})

    if synchronous:
        with httpx.Client(transport=httpx.MockTransport(transport)) as http:
            client = Client(base_url="http://backend", sync_http_client=http)
            assert client.create_run_sync(request()).run_id == "run"
    else:

        async def exercise():
            async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
                client = Client(base_url="http://backend", async_http_client=http)
                assert (await client.create_run(request())).run_id == "run"

        asyncio.run(exercise())
    assert sent == ["GET", "POST"]


def test_confirmed_profile_requires_bounded_create_identity():
    value = request().model_dump(mode="json")
    for key in (None, "", "x" * 257):
        with pytest.raises(ValidationError):
            CreateRunRequest.model_validate({**value, "idempotency_key": key})


def test_ordinary_legacy_run_keeps_its_existing_unbound_transport_scope():
    from dify_agent.runtime.run_scheduler import RunScheduler
    from dify_agent.adapters.native_testing.transport import AgentRuntimeTransportError, current_runtime_identity

    async def exercise():
        async with (
            httpx.AsyncClient() as legacy,
            AgentRuntimeHTTPClient(api_url="http://api", api_token="service") as strict,
        ):
            services = Services(legacy, legacy, inner_api_key="ordinary", confirmed_api_http_client=strict)
            scheduler = RunScheduler(store=None, services=services)
            async with scheduler._transport_scope(
                "ordinary", expected_generation=0, request=CreateRunRequest(composition={"layers": []})
            ):
                with pytest.raises(AgentRuntimeTransportError, match="agent_runtime_binding_missing"):
                    current_runtime_identity()

    asyncio.run(exercise())
