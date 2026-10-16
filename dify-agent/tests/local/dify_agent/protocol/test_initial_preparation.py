"""Real Pydantic/HTTPX boundaries; no runtime or Redis test collection."""

import asyncio
import json

import httpx
import pytest
from pydantic import ValidationError

from dify_agent.client import Client, DifyAgentClientError
from dify_agent.client._client import _create_run_json
from dify_agent.protocol import native_testing as wire
from dify_agent.protocol.schemas import CreateRunRequest

REF = {
    "policy_version": "builder-native-test-v1",
    "request_id": "req",
    "invocation_id": "inv",
    "context_digest": "a" * 64,
}
PARENT = {
    "ref": REF,
    "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
    "input_result_ref": "input",
    "input_digest": "b" * 64,
}


def test_parent_is_pure_canonical_and_marked_request_requires_exact_parent():
    assert hasattr(wire, "AgentParentNodeRef"), "S1 pure parent DTO is missing"
    parent = wire.AgentParentNodeRef.model_validate(PARENT)
    with pytest.raises(ValidationError):
        wire.AgentParentNodeRef.model_validate(PARENT | {"execution_id": PARENT["execution_id"].upper()})
    raw = {
        "composition": {"layers": []},
        "execution_mode": "builder_test",
        "native_test_ref": REF,
        "native_test_protocol_version": 1,
    }
    with pytest.raises(ValidationError):
        CreateRunRequest.model_validate(raw)
    request = CreateRunRequest.model_validate(raw | {"native_parent_node": PARENT})
    assert request.native_parent_node == parent
    with pytest.raises(ValidationError):
        CreateRunRequest.model_validate(
            raw | {"native_parent_node": PARENT | {"ref": REF | {"invocation_id": "foreign"}}}
        )


def test_ordinary_serialization_remains_old_server_compatible():
    serialized = json.loads(_create_run_json(CreateRunRequest(composition={"layers": []})))
    assert "native_parent_node" not in serialized
    assert "native_parent_node" not in CreateRunRequest(composition={"layers": []}).model_dump(mode="json")
    assert "execution_mode" not in serialized


def test_digest_covers_only_executable_material_and_callback_has_no_authority_fields():
    assert hasattr(wire, "executable_request_digest"), "S1 canonical executable digest is missing"
    request = CreateRunRequest(composition={"layers": []})
    digest = wire.executable_request_digest(request)
    assert wire.executable_request_digest(request.model_copy(update={"metadata": {"different": True}})) == digest
    assert wire.executable_request_digest(request.model_copy(update={"session_snapshot": None})) == digest
    assert (
        wire.executable_request_digest(
            CreateRunRequest(composition={"layers": [{"name": "prompt", "config": {"x": 1}}]})
        )
        != digest
    )
    payload = {"parent_node": PARENT, "agent_run_id": "run", "request_digest": digest}
    assert wire.AgentPrepareRunPayload.model_validate(payload).agent_run_id == "run"
    for extra in ({"actor": "actor"}, {"tenant": "tenant"}, {"ready": True}, {"approved": True}):
        with pytest.raises(ValidationError):
            wire.AgentPrepareRunPayload.model_validate(payload | extra)


@pytest.mark.parametrize("reply", ["valid", "redirect", "oversize", "foreign", "private-error"])
def test_sdk_identity_read_is_bounded_exact_and_once(reply):
    assert hasattr(Client, "read_run_identity_sync"), "S1 SDK identity read is missing"
    selection = wire.ReadAgentRuntimeIdentity(parent_node=PARENT, request_digest="c" * 64)
    calls = []
    identity = {
        "run_id": "run",
        "execution_mode": "builder_test",
        "parent_node": PARENT,
        "request_digest": "c" * 64,
        "agent_generation": 0,
    }

    def handle(request):
        calls.append(request)
        assert request.headers["Authorization"] == "Bearer synthetic-key"
        assert json.loads(request.content) == selection.model_dump(mode="json")
        if reply == "redirect":
            return httpx.Response(307, headers={"location": "http://other.invalid"})
        if reply == "oversize":
            return httpx.Response(200, content=b" " * 4097)
        if reply == "private-error":
            return httpx.Response(500, json={"private": "private-canary"})
        if reply == "foreign":
            return httpx.Response(200, json=identity | {"run_id": "foreign"})
        return httpx.Response(200, json=identity)

    with (
        httpx.Client(transport=httpx.MockTransport(handle), follow_redirects=True) as http,
        Client(
            base_url="http://synthetic.invalid",
            headers={"Authorization": "Bearer synthetic-key"},
            sync_http_client=http,
        ) as sdk,
    ):
        if reply == "valid":
            assert sdk.read_run_identity_sync("run", selection).run_id == "run"
        else:
            with pytest.raises(DifyAgentClientError) as caught:
                sdk.read_run_identity_sync("run", selection)
            assert "private-canary" not in str(caught.value)
    assert len(calls) == 1


@pytest.mark.parametrize("reply", ["valid", "oversize", "foreign", "redirect", "private-error"])
def test_api_prepare_adapter_is_bounded_once_and_checks_digest(reply):
    from dify_agent.adapters.native_testing.client import AgentPolicyTransportUnavailable, HttpAgentPolicyClient

    assert hasattr(HttpAgentPolicyClient, "prepare_run"), "S1 API prepare transport missing"
    calls = []
    payload = wire.AgentPrepareRunPayload(parent_node=PARENT, agent_run_id="run", request_digest="c" * 64)

    def handle(request):
        calls.append(request)
        assert request.headers["x-inner-api-key"] == "synthetic"
        if reply == "oversize":
            return httpx.Response(200, content=b" " * 4097)
        if reply == "redirect":
            return httpx.Response(307, headers={"location": "http://other.invalid"})
        if reply == "private-error":
            return httpx.Response(409, json={"private": "private-canary"})
        return httpx.Response(
            200,
            json={
                "config_ref": "cfg",
                "config_digest": ("d" if reply == "foreign" else "c") * 64,
                "association_object_ref": "association",
            },
        )

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle), follow_redirects=True) as http:
            client = HttpAgentPolicyClient(base_url="http://synthetic.invalid", api_key="synthetic", http_client=http)
            if reply == "valid":
                assert (await client.prepare_run(payload=payload)).association_object_ref == "association"
            else:
                with pytest.raises(AgentPolicyTransportUnavailable) as caught:
                    await client.prepare_run(payload=payload)
                assert "private-canary" not in str(caught.value)

    asyncio.run(exercise())
    assert len(calls) == 1


@pytest.mark.parametrize("reply", ["valid", "foreign", "oversize"])
def test_async_sdk_identity_stream_has_same_exact_owner_and_byte_cap(reply):
    calls = []
    selection = wire.ReadAgentRuntimeIdentity(parent_node=PARENT, request_digest="c" * 64)

    def handle(request):
        calls.append(request)
        if reply == "oversize":
            return httpx.Response(200, content=b" " * 4097)
        return httpx.Response(
            200,
            json={
                "run_id": "foreign" if reply == "foreign" else "run",
                "execution_mode": "builder_test",
                "parent_node": PARENT,
                "request_digest": "c" * 64,
                "agent_generation": 0,
            },
        )

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
            async with Client(
                base_url="http://synthetic.invalid",
                headers={"Authorization": "Bearer synthetic"},
                async_http_client=http,
            ) as sdk:
                if reply == "valid":
                    assert (await sdk.read_run_identity("run", selection)).run_id == "run"
                else:
                    with pytest.raises(DifyAgentClientError):
                        await sdk.read_run_identity("run", selection)

    asyncio.run(exercise())
    assert len(calls) == 1


@pytest.mark.parametrize("reply", ["valid", "foreign", "digest", "oversize", "extra"])
def test_protected_config_adapter_checks_current_parent_digest_and_actual_byte_cap(reply):
    from dify_agent.adapters.native_testing.client import AgentPolicyTransportUnavailable, HttpAgentPolicyClient

    config = {"composition": {"schema_version": 2, "layers": []}, "session_snapshot": None}
    digest = wire.executable_request_digest(CreateRunRequest(composition={"layers": []}))
    calls = []

    def handle(request):
        calls.append(request)
        assert request.headers["x-inner-api-key"] == "synthetic"
        if reply == "oversize":
            return httpx.Response(200, content=b" " * (1024 * 1024 + 1))
        return httpx.Response(
            200,
            json={
                "parent_node": PARENT if reply != "foreign" else PARENT | {"input_result_ref": "foreign"},
                "config_ref": "cfg",
                "config_digest": "d" * 64 if reply == "digest" else digest,
                "config": config | {"metadata": {"credentials": {"api_key": "private-canary"}}}
                if reply == "extra"
                else config,
            },
        )

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
            client = HttpAgentPolicyClient(base_url="http://synthetic.invalid", api_key="synthetic", http_client=http)
            payload = wire.AgentReadPreparedConfigPayload(parent_node=PARENT, config_ref="cfg")
            if reply == "valid":
                assert (await client.read_prepared_config(payload=payload)).config == config
            else:
                with pytest.raises(AgentPolicyTransportUnavailable):
                    await client.read_prepared_config(payload=payload)

    asyncio.run(exercise())
    assert len(calls) == 1
