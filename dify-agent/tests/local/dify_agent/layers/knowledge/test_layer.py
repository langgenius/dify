"""Knowledge module behavior using actual native Agent hooks and tool dispatch."""

import json

import httpx
import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, UserPromptPart
from pydantic_ai.models.function import FunctionModel

from dify_agent.layers.knowledge.layer import Capability, Config, State, TEMPORARY_UNAVAILABLE_OBSERVATION
from dify_agent.layers.knowledge.client import DifyKnowledgeBaseClientError
from dify_agent.layers.execution_context.configs import DifyExecutionContextLayerConfig
from dify_agent.runtime.context import Deps, Services
from tests.local.dify_agent.module_support import invoke_native_tool


def config(*, eager=False, query="release", dataset="dataset"):
    return Config(
        sets=[
            {
                "id": "support",
                "name": "Support",
                "datasets": [{"id": dataset}],
                "query": {"mode": "user_query", "value": query} if eager else {"mode": "generated_query"},
                "retrieval": {"mode": "multiple", "top_k": 4},
            }
        ]
    )


def deps_for(client, config, state=None):
    identity = DifyExecutionContextLayerConfig(
        tenant_id="tenant",
        user_id="user",
        user_from="account",
        app_id="app",
        agent_mode="agent_app",
        invoke_from="web-app",
    )
    return Deps(
        layers={
            "knowledge": {"config": config.model_dump(mode="json"), "state": state or State().model_dump(mode="json")},
            "execution_context": {"config": identity.model_dump(mode="json"), "state": {}},
        },
        services=Services(client, client),
        run_id="test",
    )


@pytest.mark.anyio
async def test_eager_results_are_in_user_role_and_cache_uses_current_config():
    requests = []

    def handler(request):
        assert request.url.path == "/inner/api/knowledge/retrieve"
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "metadata": {"dataset_name": "Docs", "document_name": "Release", "score": 0.8},
                        "title": "Release",
                        "files": [],
                        "content": "Version notes",
                    }
                ],
                "usage": {},
            },
        )

    seen = []

    async def model(messages, info):
        assert info.function_tools == []
        seen.append(list(messages))
        return ModelResponse(parts=[TextPart("done")])

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deps = deps_for(client, config(eager=True))
        for _ in range(2):
            await Agent(FunctionModel(model), deps_type=Deps, capabilities=[Capability("knowledge")]).run(
                "question", deps=deps
            )
        assert len(requests) == 1
        assert requests[0]["caller"]["tenant_id"] == "tenant"
        assert requests[0]["dataset_ids"] == ["dataset"]
        prompts = [
            p.content for m in seen[0] if isinstance(m, ModelRequest) for p in m.parts if isinstance(p, UserPromptPart)
        ]
        assert prompts[0] == "question"
        assert "Knowledge retrieval results" in prompts[1]
        assert "Version notes" in prompts[1]
        assert deps.layers["knowledge"]["state"]["eager_results"][0]["status"] == "success"
        old_fingerprint = deps.layers["knowledge"]["state"]["eager_config_fingerprint"]
        deps.layers["knowledge"]["config"] = config(eager=True, query="changed", dataset="new").model_dump(mode="json")
        await Agent(FunctionModel(model), deps_type=Deps, capabilities=[Capability("knowledge")]).run(
            "question", deps=deps
        )
        assert len(requests) == 2
        assert requests[1]["query"] == "changed" and requests[1]["dataset_ids"] == ["new"]
        assert deps.layers["knowledge"]["state"]["eager_config_fingerprint"] != old_fingerprint
        assert not client.is_closed


@pytest.mark.anyio
@pytest.mark.parametrize(
    "query,status,expected",
    [
        ("release", 200, "No relevant knowledge base results"),
        ("   ", 200, "requires a non-empty query"),
        ("release", 429, "temporarily unavailable"),
    ],
)
async def test_generated_query_native_tool_preserves_local_validation_and_retry_policy(query, status, expected):
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            status, json={"results": [], "usage": {}} if status == 200 else {"code": "busy", "message": "busy"}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deps = deps_for(client, config())

        def inspect(info):
            schema = info.function_tools[0].parameters_json_schema
            assert schema["properties"]["set_name"]["enum"] == ["Support"]
            assert set(schema["properties"]) == {"set_name", "query"}

        result = await invoke_native_tool(
            deps,
            Capability("knowledge").get_toolset(),
            "knowledge_base_search",
            {"set_name": "Support", "query": query},
            inspect=inspect,
        )
        assert expected in result.output
        assert len(requests) == (0 if not query.strip() else 1)


@pytest.mark.anyio
async def test_nonretryable_eager_failure_leaves_previous_cache_for_retry():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(404, json={"code": "dataset_not_found", "message": "missing"})
        )
    ) as client:
        deps = deps_for(client, config(eager=True), {"eager_config_fingerprint": "previous", "eager_results": []})

        async def model(messages, info):
            raise AssertionError("model must not execute after eager failure")

        with pytest.raises(DifyKnowledgeBaseClientError):
            await Agent(FunctionModel(model), deps_type=Deps, capabilities=[Capability("knowledge")]).run(
                "question", deps=deps
            )
        assert deps.layers["knowledge"]["state"]["eager_config_fingerprint"] == "previous"


@pytest.mark.anyio
async def test_retryable_eager_failure_is_saved_as_user_observation():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(429, json={"code": "busy", "message": "busy"}))
    ) as client:
        deps = deps_for(client, config(eager=True))

        async def model(messages, info):
            assert any(
                TEMPORARY_UNAVAILABLE_OBSERVATION in str(p.content)
                for m in messages
                if isinstance(m, ModelRequest)
                for p in m.parts
                if isinstance(p, UserPromptPart)
            )
            return ModelResponse(parts=[TextPart("done")])

        await Agent(FunctionModel(model), deps_type=Deps, capabilities=[Capability("knowledge")]).run(
            "question", deps=deps
        )
        state = State.model_validate(deps.layers["knowledge"]["state"])
        assert state.eager_results[0].status == "temporarily_unavailable"
        assert state.eager_config_fingerprint is not None
