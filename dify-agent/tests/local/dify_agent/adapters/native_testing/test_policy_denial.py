"""Bounded policy HTTP diagnostics through the real strict client boundary."""

import asyncio

import httpx
import pytest

from dify_agent.adapters.native_testing.client import AgentPolicyTransportUnavailable, HttpAgentPolicyClient
from dify_agent.adapters.native_testing.transport import AgentRuntimeHTTPClient, bind_runtime_identity
from dify_agent.protocol.native_testing import AgentRuntimeIdentity
from tests.local.dify_agent.runtime.test_native_effects import INTENT, REF


@pytest.mark.parametrize(
    "body,code",
    [
        (
            {"code": "native_agent_control_refused", "message": "private nonce=hidden-secret"},
            "native_agent_control_refused",
        ),
        ({"code": "secret-bearing-custom-message", "message": "private nonce=hidden-secret"}, "unrecognized"),
        (["private nonce=hidden-secret"], "unrecognized"),
    ],
)
def test_policy_http_denial_reports_only_fixed_route_status_and_allowlisted_code(body, code):
    async def exercise():
        identity = AgentRuntimeIdentity(
            run_id="run", execution_mode="ordinary", parent_node=None, request_digest="a" * 64, agent_generation=0
        )
        async with AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="private-token",
            transport=httpx.MockTransport(lambda request: httpx.Response(409, json=body)),
        ) as http:
            policy = HttpAgentPolicyClient(base_url="http://api", api_key="", http_client=http, ref=REF)
            with bind_runtime_identity(identity):
                with pytest.raises(AgentPolicyTransportUnavailable) as caught:
                    await policy.before_call(ref=REF, intent=INTENT)
            assert str(caught.value) == f"native_policy_http_refused:before-call:409:{code}"
            assert caught.value.__cause__ is None
            assert "hidden-secret" not in str(caught.value)
            assert "private-token" not in str(caught.value)

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "content",
    [b"not-json private-nonce", b'{"code":"native_agent_control_refused","private":"' + b"x" * 5000 + b'"}'],
    ids=["malformed", "oversized"],
)
def test_malformed_or_oversized_http_denial_body_is_not_disclosed(content):
    async def exercise():
        identity = AgentRuntimeIdentity(
            run_id="run", execution_mode="ordinary", parent_node=None, request_digest="a" * 64, agent_generation=0
        )
        async with AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="private-token",
            transport=httpx.MockTransport(lambda request: httpx.Response(502, content=content)),
        ) as http:
            policy = HttpAgentPolicyClient(base_url="http://api", api_key="", http_client=http, ref=REF)
            with bind_runtime_identity(identity):
                with pytest.raises(AgentPolicyTransportUnavailable) as caught:
                    await policy.before_call(ref=REF, intent=INTENT)
            assert str(caught.value) == "native_policy_http_refused:before-call:502:unrecognized"
            assert caught.value.__cause__ is None

    asyncio.run(exercise())


@pytest.mark.parametrize("failure", ["http_denial", "network_loss"])
def test_http_denial_cannot_recover_as_lost_ack_but_network_loss_reads_completed_receipt(failure):
    import json
    from dify_agent.runtime.confirmed_continuation import _APIResultStore
    from dify_agent.runtime.native_effects import NativeEffectDispatcher
    from tests.local.dify_agent.runtime.test_native_effects import PERMIT

    async def exercise():
        calls = []

        def transport(request):
            route = request.url.path.rsplit("/", 1)[-1]
            calls.append(route)
            if route == "results":
                if failure == "network_loss":
                    raise httpx.ReadError("private endpoint response lost")
                return httpx.Response(409, json={"code": "native_agent_control_refused", "message": "private secret"})
            if route == "outcome":
                assert json.loads(request.content)["outcome"] == "unknown"
                return httpx.Response(
                    200,
                    json={
                        "operation_id": PERMIT.operation_id,
                        "attempt_id": PERMIT.attempt_id,
                        "outcome": "completed",
                        "result_ref": "saved",
                    },
                )
            assert route == "read-result"
            return httpx.Response(200, json={"result": {"saved": True}})

        identity = AgentRuntimeIdentity(
            run_id="run", execution_mode="ordinary", parent_node=None, request_digest="a" * 64, agent_generation=0
        )
        async with AgentRuntimeHTTPClient(
            api_url="http://api", api_token="private-token", transport=httpx.MockTransport(transport)
        ) as http:
            policy = HttpAgentPolicyClient(base_url="http://api", api_key="", http_client=http, ref=REF)

            async def invoke(permit):
                calls.append("physical")
                return {"private": "secret"}

            with bind_runtime_identity(identity):
                action = NativeEffectDispatcher(policy=policy).invoke_permitted(
                    ref=REF, permit=PERMIT, intent=INTENT, invoke=invoke, result_store=_APIResultStore(policy, REF)
                )
                if failure == "http_denial":
                    with pytest.raises(
                        AgentPolicyTransportUnavailable,
                        match="^native_policy_http_refused:results:409:native_agent_control_refused$",
                    ):
                        await action
                    assert calls == ["physical", "results", "outcome"]
                else:
                    assert await action == {"saved": True}
                    assert calls == ["physical", "results", "outcome", "read-result"]

    asyncio.run(exercise())
