"""Direct clients keep real schemas/results through the final HTTPX owner."""

import asyncio
import json

import httpx
import pytest

from dify_agent.adapters.native_testing.transport import AgentRuntimeHTTPClient, bind_runtime_identity
from dify_agent.layers.dify_core_tools.client import DifyCoreToolsClient
from dify_agent.layers.dify_core_tools.configs import DifyCoreToolConfig
from dify_agent.layers.dify_plugin.tools_layer import _DifyPluginToolFileClient
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.knowledge.client import DifyKnowledgeBaseClient
from dify_agent.layers.knowledge.configs import DifyKnowledgeMetadataFilteringConfig, DifyKnowledgeRetrievalConfig
from dify_agent.protocol.native_testing import AgentRuntimeIdentity


def context():
    return DifyExecutionContextLayerConfig(
        tenant_id="tenant",
        user_id="user",
        user_from="account",
        app_id="app",
        agent_mode="workflow_run",
        invoke_from="service-api",
    )


def identity():
    return AgentRuntimeIdentity(
        run_id="actual-run", agent_generation=0, execution_mode="ordinary", parent_node=None, request_digest="a" * 64
    )


@pytest.mark.parametrize("producer", ["core", "knowledge", "parameter-file"])
def test_direct_producers_preserve_wire_and_results_on_strict_routes(producer):
    async def exercise():
        seen = []

        def receive(request):
            seen.append(request)
            assert request.headers["Authorization"] == "Bearer backend"
            assert "X-Inner-Api-Key" not in request.headers
            body = json.loads(request.content)
            if producer == "core":
                assert request.url.path == "/inner/api/agent/runtime/tools/invoke"
                assert body["tool"]["tool_parameters"] == {"query": "hello"}
                assert body["tool"]["runtime_parameters"] == {"scope": "workspace"}
                return httpx.Response(
                    200, json={"messages": [], "observation": "answer", "metadata": {"child_run": "child"}}
                )
            if producer == "knowledge":
                assert request.url.path == "/inner/api/agent/runtime/knowledge/retrieve"
                assert body["dataset_ids"] == ["dataset"]
                assert body["query"] == "hello"
                return httpx.Response(
                    200,
                    json={
                        "results": [{"metadata": {"dataset_id": "dataset"}, "content": "answer"}],
                        "usage": {"tokens": 2},
                    },
                )
            assert request.url.path == "/inner/api/agent/runtime/files/download-request"
            assert body["file"] == {"transfer_method": "tool_file", "reference": "dify-file-ref:file"}
            return httpx.Response(
                200,
                json={
                    "download_uri": "https://files/file",
                    "filename": "file.txt",
                    "mime_type": "text/plain",
                    "size": 7,
                },
            )

        async with AgentRuntimeHTTPClient(
            api_url="http://api", api_token="backend", transport=httpx.MockTransport(receive)
        ) as http:
            with bind_runtime_identity(identity()):
                if producer == "core":
                    result = await DifyCoreToolsClient(base_url="http://api", api_key="", http_client=http).invoke(
                        execution_context=context(),
                        tool_config=DifyCoreToolConfig(
                            provider_type="builtin",
                            provider_id="search",
                            tool_name="find",
                            runtime_parameters={"scope": "workspace"},
                            parameters=[],
                            parameters_json_schema={"type": "object"},
                        ),
                        tool_parameters={"query": "hello"},
                    )
                    assert result.observation == "answer"
                    assert result.metadata == {"child_run": "child"}
                elif producer == "knowledge":
                    result = await DifyKnowledgeBaseClient(
                        base_url="http://api", api_key="", http_client=http
                    ).retrieve(
                        tenant_id="tenant",
                        user_id="user",
                        app_id="app",
                        user_from="account",
                        invoke_from="service-api",
                        dataset_ids=["dataset"],
                        query="hello",
                        retrieval=DifyKnowledgeRetrievalConfig(mode="multiple", top_k=3),
                        metadata_filtering=DifyKnowledgeMetadataFilteringConfig(mode="disabled"),
                    )
                    assert result.results[0].content == "answer"
                    assert result.usage == {"tokens": 2}
                else:
                    result = await _DifyPluginToolFileClient(
                        base_url="http://api", api_key="", http_client=http
                    ).request_download(
                        execution_context=context(),
                        file_mapping={"transfer_method": "tool_file", "reference": "dify-file-ref:file"},
                    )
                    assert result.download_url == "https://files/file"
                    assert result.size == 7
        assert len(seen) == 1

    asyncio.run(exercise())


def test_policy_preparation_and_control_callbacks_all_use_bound_strict_transport():
    from dify_agent.adapters.native_testing.client import HttpAgentPolicyClient
    from dify_agent.protocol.native_testing import (
        AgentDispatchPermit,
        AgentEffectIntent,
        AgentOperationKey,
        AgentPrepareRunPayload,
        AgentReadPreparedConfigPayload,
        executable_request_digest,
    )
    from dify_agent.protocol.schemas import CreateRunRequest

    parent = {
        "ref": {
            "policy_version": "builder-native-test-v1",
            "request_id": "request",
            "invocation_id": "invocation",
            "context_digest": "b" * 64,
        },
        "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
        "input_result_ref": "input",
        "input_digest": "c" * 64,
    }
    digest = executable_request_digest(CreateRunRequest(composition={"layers": []}))
    native = AgentRuntimeIdentity(
        run_id="actual-run",
        agent_generation=0,
        execution_mode="builder_test",
        parent_node=parent,
        request_digest=digest,
    )
    intent = AgentEffectIntent(
        key=AgentOperationKey(invocation_id="invocation", occurrence_path=("tool", "call"), cursor=0),
        kind="tool",
        resource_ref="tool",
        implementation_revision="v1",
        account_ref=None,
        target={},
        parameters={},
        input_digest="d" * 64,
        capability_digest="e" * 64,
    )
    permit = AgentDispatchPermit(
        permit_id="permit", attempt_id="attempt", operation_id="operation", expires_at="2030-01-01T00:00:00Z"
    )

    async def exercise():
        seen = []

        def receive(request):
            seen.append(request.url.path.rsplit("/", 1)[-1])
            assert request.url.path.startswith("/inner/api/agent/runtime/native-testing/")
            assert request.headers["Authorization"] == "Bearer backend"
            assert "X-Inner-Api-Key" not in request.headers
            suffix = seen[-1]
            bodies = {
                "prepare-run": {"config_ref": "cfg", "config_digest": digest, "association_object_ref": "association"},
                "prepared-config": {
                    "parent_node": parent,
                    "config_ref": "cfg",
                    "config_digest": digest,
                    "config": {"composition": {"schema_version": 2, "layers": []}, "session_snapshot": None},
                },
                "before-call": {"kind": "stop", "reason_code": "physical_owner_missing"},
                "outcome": {
                    "operation_id": "operation",
                    "attempt_id": "attempt",
                    "outcome": "not_dispatched",
                    "result_ref": None,
                },
                "materialize": {"credential_type": "unauthorized", "credentials": {}, "runtime_parameters": {}},
                "claim-dispatch": {"claimed": True},
            }
            return httpx.Response(200, json=bodies[suffix])

        async with AgentRuntimeHTTPClient(
            api_url="http://api", api_token="backend", transport=httpx.MockTransport(receive)
        ) as http:
            policy = HttpAgentPolicyClient(base_url="http://api", api_key="", http_client=http)
            with bind_runtime_identity(native):
                assert (
                    await policy.prepare_run(
                        payload=AgentPrepareRunPayload(
                            parent_node=parent, agent_run_id="actual-run", request_digest=digest
                        )
                    )
                ).config_ref == "cfg"
                assert (
                    await policy.read_prepared_config(
                        payload=AgentReadPreparedConfigPayload(parent_node=parent, config_ref="cfg")
                    )
                ).config_digest == digest
                assert (
                    await policy.before_call(ref=native.parent_node.ref, intent=intent)
                ).reason_code == "physical_owner_missing"
                assert (
                    await policy.record_outcome(permit=permit, outcome="not_dispatched", result_ref=None)
                ).result_ref is None
                assert (
                    await policy.materialize(
                        ref=native.parent_node.ref, intent=intent, permit=permit, tool_ref="tool", phase="business"
                    )
                ).credentials == {}
                await policy.claim_dispatch(ref=native.parent_node.ref, intent=intent, permit=permit)
        assert seen == ["prepare-run", "prepared-config", "before-call", "outcome", "materialize", "claim-dispatch"]

    asyncio.run(exercise())


def test_llm_layer_strict_transport_keeps_stream_usage_and_checks_actual_deps_run():
    from dify_agent.adapters.native_testing.transport import AgentRuntimeTransportError
    from dify_agent.layers.dify_plugin.llm_layer import Capability, Config
    from dify_agent.runtime.context import Deps, Services
    from graphon.model_runtime.entities.message_entities import UserPromptMessage
    from tests.local.dify_agent.adapters.llm._test_support import build_stream_response, single_text_chunk

    async def exercise():
        seen = []

        def receive(request):
            body = json.loads(request.content)
            seen.append(body)
            assert request.url.path == "/inner/api/agent/runtime/llm/invoke"
            assert body["caller"]["agent_run_id"] == "actual-run"
            assert body["target"]["provider"] == "langgenius/openai/openai"
            assert body["target"]["prompt_messages"][0]["content"] == "hello"
            return build_stream_response(*single_text_chunk("answer", prompt_tokens=3, completion_tokens=5))

        async with AgentRuntimeHTTPClient(
            api_url="http://api", api_token="backend", transport=httpx.MockTransport(receive)
        ) as http:
            deps = Deps(
                layers={
                    "llm": {
                        "config": Config(
                            plugin_id="langgenius/openai", model_provider="openai", model="demo"
                        ).model_dump(mode="json"),
                        "state": {},
                    },
                    "execution_context": {"config": context().model_dump(mode="json"), "state": {}},
                },
                run_id="actual-run",
                services=Services(http, http, inner_api_url="http://api"),
            )
            with bind_runtime_identity(identity()):
                model = Capability("llm").build_model(deps)
                # The real provider is the model's existing owner; no model call.
                client = model.dify_provider.client
                chunks = [
                    chunk
                    async for chunk in client.iter_llm_result_chunks(
                        provider="openai",
                        model="demo",
                        prompt_messages=[UserPromptMessage(content="hello")],
                        model_parameters={},
                        tools=None,
                        stop=None,
                        stream=True,
                    )
                ]
                assert chunks[0].delta.message.content == "answer"
                assert chunks[0].delta.usage.total_tokens == 8
            with bind_runtime_identity(identity().model_copy(update={"run_id": "foreign"})):
                with pytest.raises(AgentRuntimeTransportError):
                    Capability("llm").build_model(deps)
        assert len(seen) == 1

    asyncio.run(exercise())
