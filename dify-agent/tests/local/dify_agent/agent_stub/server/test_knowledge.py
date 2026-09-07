from __future__ import annotations

import asyncio
import base64
import io
import json
from uuid import uuid4

import httpx
import pytest
from fakeredis.aioredis import FakeRedis
from fastapi import FastAPI
from PIL import Image
from pydantic import ValidationError
from pydantic_ai.messages import BinaryContent, ModelRequest, ToolReturnPart, UserPromptPart

from dify_agent.agent_stub.server.knowledge import AgentStubKnowledgeHandler, _validate_thumbnail, project_result
from dify_agent.agent_stub.server.routes.agent_stub import create_agent_stub_http_router
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubPrincipal, AgentStubTokenCodec
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.knowledge_fs.history import (
    HISTORICAL_EVIDENCE,
    IMAGE_MARKER,
    without_historical_knowledge_evidence,
)
from dify_agent.layers.knowledge_fs.session import KnowledgeFsDelivery
from dify_agent.protocol.knowledge_fs import (
    KnowledgeFsBinding,
    KnowledgeFsCitation,
    KnowledgeFsCommand,
    KnowledgeFsCommandResult,
    KnowledgeFsError,
    KnowledgeFsPrepareRequest,
    KnowledgeFsPreparedRequest,
)
from dify_agent.storage.redis_keys import run_cancel_intent_key, run_record_key
from dify_agent.storage.redis_knowledge_sessions import RedisKnowledgeSessionStore

SPACE = "00000000-0000-4000-8000-000000000001"
NODE = "00000000-0000-4000-8000-000000000002"
DOCUMENT = "00000000-0000-4000-8000-000000000003"
RECEIPT = "kfs_" + "a" * 32
BINDING = KnowledgeFsBinding(id="docs", control_space_id=SPACE, name="产品")
CONTEXT = DifyExecutionContextLayerConfig(
    tenant_id="tenant",
    app_id="app",
    user_id="account",
    user_from="account",
    agent_id="agent",
    agent_config_version_id="snapshot",
    agent_config_version_kind="snapshot",
    agent_mode="agent_app",
    invoke_from="published",
)
CITATION = KnowledgeFsCitation(
    id=RECEIPT,
    control_space_id=SPACE,
    space_name="产品",
    node_id=NODE,
    document_asset_id=DOCUMENT,
    artifact_hash="a" * 64,
    parse_artifact_id="parse",
    document_version=1,
    document_title="产品介绍.pdf",
)


def command(name="spaces", **kwargs):
    return KnowledgeFsCommand(command_id=uuid4(), command=name, **kwargs)


async def session_fixture():
    redis = FakeRedis()
    store = RedisKnowledgeSessionStore(redis)
    await redis.set(run_record_key(store.prefix, "run"), json.dumps({"status": "running"}))
    session = await store.create(
        run_id="run", execution_context=CONTEXT, bindings=[BINDING], agent_supports_vision=True
    )
    return redis, store, session


def delivery(cmd=None, **kwargs):
    cmd = cmd or command()
    return KnowledgeFsDelivery(
        result=KnowledgeFsCommandResult(command_id=cmd.command_id, command=cmd.command, citations=[CITATION], **kwargs)
    )


@pytest.mark.parametrize(
    "payload",
    [
        {"command": "write", "path": "/knowledge/a"},
        {"command": "spaces", "tenant_id": "other"},
        {"command": "search", "space": "docs", "query": "x", "url": "http://evil"},
        *[
            {"command": "cat", "space": "docs", "path": path}
            for path in ["/sources", "/knowledge/../a", "/knowledge/%2e%2e/a", "/knowledge//a", "/knowledge/a?token=x"]
        ],
        {"command": "open", "space": "docs", "node_id": "not-a-uuid"},
        {"command": "image", "space": "docs", "item_id": "image-1"},
        {"command": "search", "space": "docs", "query": "x", "limit": 51},
        {"command": "spaces", "query": None},
    ],
)
def test_read_only_command_rejects_privileged_or_ambiguous_arguments(payload):
    with pytest.raises(ValidationError):
        KnowledgeFsCommand.model_validate({"command_id": str(uuid4()), **payload})


@pytest.mark.parametrize(
    "name,args",
    [
        ("spaces", {}),
        ("capabilities", {}),
        ("search", {"query": "Hello"}),
        ("ls", {"path": "/knowledge"}),
        ("tree", {"path": "/knowledge", "depth": 4}),
        ("find", {"path": "/knowledge", "query": "manual"}),
        ("grep", {"path": "/knowledge", "query": "值"}),
        ("cat", {"path": "/knowledge/a", "limit": 50}),
        ("stat", {"path": "/knowledge/a"}),
        ("diff", {"old_path": "/knowledge/a", "new_path": "/knowledge/b"}),
        ("open", {"node_id": NODE}),
        ("images", {"receipt_id": RECEIPT}),
        ("image", {"receipt_id": RECEIPT, "item_id": "img"}),
    ],
)
def test_every_command_survives_private_envelope_serialization(name, args):
    cmd = command(name, **({"space": "docs"} if name != "spaces" else {}), **args)
    request = KnowledgeFsPrepareRequest(execution_context=CONTEXT, bindings=[BINDING], command=cmd)
    restored = KnowledgeFsPrepareRequest.model_validate_json(request.model_dump_json(exclude_unset=True))
    assert restored == request


def test_redis_atomic_replay_concurrency_time_budget_and_scope():
    async def scenario():
        redis, store, session = await session_fixture()
        await store.reserve(session, "one")
        await store.reserve(session, "two")
        with pytest.raises(KnowledgeFsError, match="concurrently"):
            await store.reserve(session, "three")
        await store.release(session, "one")
        with pytest.raises(KnowledgeFsError, match="already executed"):
            await store.reserve(session, "one")
        await store.release(session, "two")
        await store.deliver(session, delivery())
        assert await store.citation(session, RECEIPT) == CITATION
        assert len(await store.drain(session)) == 1
        assert await store.drain(session) == []
        other = await store.create(
            run_id="run", execution_context=CONTEXT, bindings=[BINDING], agent_supports_vision=True
        )
        with pytest.raises(KnowledgeFsError, match="another run"):
            await store.citation(other, RECEIPT)
        resumed = await store.create(
            run_id="run",
            execution_context=CONTEXT,
            bindings=[BINDING],
            agent_supports_vision=True,
            resume_budget_id=session.budget_id,
        )
        assert await store.citation(resumed, RECEIPT) == CITATION
        with pytest.raises(KnowledgeFsError, match="scope changed"):
            await store.create(
                run_id="run",
                execution_context=CONTEXT,
                bindings=[BINDING],
                agent_supports_vision=False,
                resume_budget_id=session.budget_id,
            )
        await redis.hset(store._key("budget", session.budget_id), "time_ms", 600000)
        with pytest.raises(KnowledgeFsError, match="budget exhausted"):
            await store.reserve(session, "next")
        await store.close(session)
        with pytest.raises(KnowledgeFsError, match="expired"):
            await store.refresh(session)
        await redis.aclose()

    asyncio.run(scenario())


@pytest.mark.parametrize("counter,value", [("commands", 64), ("bytes", 1024 * 1024), ("images", 8)])
def test_aggregate_budgets_are_enforced(counter, value):
    async def scenario():
        redis, store, session = await session_fixture()
        await redis.hset(store._key("budget", session.budget_id), counter, value)
        with pytest.raises(KnowledgeFsError):
            if counter == "commands":
                await store.reserve(session, "next")
            else:
                item = delivery()
                if counter == "images":
                    item.image_base64 = "YQ=="
                await store.deliver(session, item)
        assert await store.drain(session) == []
        await redis.aclose()

    asyncio.run(scenario())


def test_stub_http_to_private_api_round_trip_never_exposes_capabilities():
    async def scenario():
        redis, store, session = await session_fixture()
        requests = []

        async def upstream(request):
            requests.append(request)
            if request.url.path.endswith("/prepare"):
                parsed = KnowledgeFsPrepareRequest.model_validate_json(request.content)
                assert parsed.command.query == "你好"
                assert request.headers["X-Inner-Api-Key"] == "private-secret"
                return httpx.Response(
                    200,
                    json={
                        "operation": "retrieveEvidence",
                        "url": "http://kfs/retrieve",
                        "method": "POST",
                        "headers": {"Authorization": "Bearer private-capability"},
                        "binding": BINDING.model_dump(),
                    },
                )
            assert request.headers["Authorization"] == "Bearer private-capability"
            return httpx.Response(
                200,
                json={
                    "mode": "fast",
                    "items": [
                        {
                            "nodeId": NODE,
                            "text": "正文",
                            "score": 0.9,
                            "citation": {
                                "artifactHash": "a" * 64,
                                "documentAssetId": DOCUMENT,
                                "documentVersion": 1,
                                "parseArtifactId": "parse",
                            },
                        }
                    ],
                },
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as network:
            handler = AgentStubKnowledgeHandler(lambda: store, lambda: network, "http://api", "private-secret")
            codec = AgentStubTokenCodec.from_server_secret(base64.urlsafe_b64encode(b"x" * 32).rstrip(b"=").decode())
            app = FastAPI()
            app.include_router(create_agent_stub_http_router(codec, knowledge_request_handler=handler))
            token = codec.encode_connection_token(CONTEXT, session_id=session.id)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stub") as client:
                cmd = command("search", space="docs", query="你好")
                body = cmd.model_dump(mode="json", exclude_unset=True)
                response = await client.post(
                    "/agent-stub/knowledge/commands", json=body, headers={"Authorization": f"Bearer {token}"}
                )
                assert response.status_code == 200, response.text
                assert response.json()["citations"][0]["document_version"] == 1
                assert "private-" not in response.text and '"score"' not in response.text
                replay = await client.post(
                    "/agent-stub/knowledge/commands", json=body, headers={"Authorization": f"Bearer {token}"}
                )
                assert replay.status_code == 409
                invalid = await client.post(
                    "/agent-stub/knowledge/commands",
                    json={**body, "namespace_id": "other"},
                    headers={"Authorization": f"Bearer {token}"},
                )
                assert invalid.status_code == 422
                too_large = await client.post(
                    "/agent-stub/knowledge/commands", content=b"x" * 25000, headers={"Authorization": f"Bearer {token}"}
                )
                assert too_large.status_code == 413
                unauth = await client.post("/agent-stub/knowledge/commands", json=body)
                assert unauth.status_code == 401
                assert len(requests) == 2
        await redis.aclose()

    asyncio.run(scenario())


def test_cancellation_closes_upstream_and_delivers_no_late_evidence():
    async def scenario():
        redis, store, session = await session_fixture()
        started, closed = asyncio.Event(), asyncio.Event()

        async def upstream(request):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                closed.set()

        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            handler = AgentStubKnowledgeHandler(lambda: store, lambda: client, "http://api", "secret")
            principal = AgentStubPrincipal(CONTEXT, session.id, [], "token")
            task = asyncio.create_task(handler.execute(principal, command()))
            await started.wait()
            await redis.xadd(run_cancel_intent_key(store.prefix, session.run_id), {"reason": "cancel"})
            with pytest.raises(KnowledgeFsError, match="no longer active"):
                await asyncio.wait_for(task, 2)
            assert closed.is_set()
            assert await store.drain(session) == []
        await redis.aclose()

    asyncio.run(scenario())


def test_thumbnail_limits_and_history_preserve_user_images_not_old_evidence():
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2)).save(buffer, format="PNG")
    pixels = buffer.getvalue()
    assert _validate_thumbnail(pixels, "image/png") == (pixels, "image/png")
    with pytest.raises(KnowledgeFsError):
        _validate_thumbnail(pixels, "image/jpeg")
    buffer = io.BytesIO()
    Image.new("RGB", (4097, 1)).save(buffer, format="PNG")
    with pytest.raises(KnowledgeFsError):
        _validate_thumbnail(buffer.getvalue(), "image/png")
    user_image = BinaryContent(data=pixels, media_type="image/png")
    evidence_image = BinaryContent(
        data=pixels, media_type="image/png", vendor_metadata={"dify_knowledge_fs_evidence": True}
    )
    history = [
        ModelRequest(
            parts=[
                ToolReturnPart(
                    tool_name="shell_run",
                    content="old private evidence",
                    metadata={"knowledge_fs_citations": [CITATION.model_dump()]},
                ),
                UserPromptPart(content=[IMAGE_MARKER, evidence_image, user_image, "user text"]),
            ]
        )
    ]
    clean = without_historical_knowledge_evidence(history)
    assert clean[0].parts[0].content == HISTORICAL_EVIDENCE
    assert clean[0].parts[1].content == [user_image, "user text"]
    assert history[0].parts[0].content == "old private evidence"


def test_search_receipt_without_parse_id_reopens_and_pins_provenance():
    plan = KnowledgeFsPreparedRequest(operation="openNodeKnowledgeFs", binding=BINDING)
    previous = CITATION.model_copy(update={"parse_artifact_id": None})
    raw = {
        "citation": {
            "artifactHash": CITATION.artifact_hash,
            "documentAssetId": DOCUMENT,
            "documentVersion": 1,
            "documentTitle": "产品介绍.pdf",
            "parseArtifactId": "parse",
        },
        "node": {"id": NODE, "text": "evidence"},
    }
    result = project_result(command("open", space="docs", receipt_id=RECEIPT), plan, raw, previous)
    assert result.citations[0] == CITATION
    raw["citation"]["artifactHash"] = "b" * 64
    with pytest.raises(KnowledgeFsError, match="Document changed"):
        project_result(command("open", space="docs", receipt_id=RECEIPT), plan, raw, previous)


def test_real_layer_delivers_images_as_model_parts_and_cleans_up(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel
    from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer
    from dify_agent.layers.knowledge_fs.configs import DifyKnowledgeFsLayerConfig, DifyKnowledgeFsRuntimeState
    from dify_agent.layers.knowledge_fs.layer import DifyKnowledgeFsLayer, DifyKnowledgeFsDeps
    from dify_agent.layers.shell.layer import DifyShellLayer
    from dify_agent.layers.shell.configs import DifyShellLayerConfig

    async def scenario():
        redis, store, _ = await session_fixture()
        shell = DifyShellLayer.from_config_with_settings(
            DifyShellLayerConfig(),
            agent_stub_api_base_url="http://stub",
            agent_stub_token_factory=lambda *args, **kwargs: "secret-jwe",
        )
        remote = AsyncMock(
            side_effect=[
                SimpleNamespace(exit_code=0, output_complete=True, output="1\n"),
                SimpleNamespace(exit_code=0, output_complete=True, output=delivery().result.model_dump_json()),
            ]
        )
        monkeypatch.setattr(DifyShellLayer, "run_remote_script", remote)
        layer = DifyKnowledgeFsLayer(
            config=DifyKnowledgeFsLayerConfig(spaces=[BINDING], agent_supports_vision=True), get_store=lambda: store
        )
        layer.runtime_state = DifyKnowledgeFsRuntimeState()
        layer.deps = DifyKnowledgeFsDeps(
            shell=shell,
            execution_context=DifyExecutionContextLayer.from_config_with_settings(
                CONTEXT, daemon_url="http://daemon", daemon_api_key="secret"
            ),
        )
        async with layer.resource_context():
            await layer.start(run_id="run", resume=False)
            assert remote.await_count == 2
            assert await layer.observe("no command") == "no command"
            buffer = io.BytesIO()
            Image.new("RGB", (2, 2)).save(buffer, format="PNG")
            await store.deliver(
                layer._session,
                KnowledgeFsDelivery(
                    result=delivery().result,
                    image_base64=base64.b64encode(buffer.getvalue()).decode(),
                    image_media_type="image/png",
                ),
            )
            agent = Agent(TestModel(call_tools=["evidence"]))

            @agent.tool_plain
            async def evidence():
                return await layer.observe("shell output")

            result = await agent.run("inspect evidence")
            parts = [part for message in result.all_messages() for part in message.parts]
            assert any(
                isinstance(part, ToolReturnPart) and part.metadata.get("knowledge_fs_citations") for part in parts
            )
            assert any(
                isinstance(part, UserPromptPart)
                and isinstance(part.content, list)
                and any(isinstance(content, BinaryContent) for content in part.content)
                for part in parts
            )
            session_id = layer._session.id
            assert "secret" not in layer.runtime_state.model_dump_json()
        assert shell.agent_stub_session_id is None and shell.knowledge_observation is None
        with pytest.raises(KnowledgeFsError, match="expired"):
            await store.load(session_id)
        await redis.aclose()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("protocol", "gateway_output", "error"),
    [
        ("old-cli", "", "KNOWLEDGE_CLI_OUTDATED"),
        ("1", "not-json", "KNOWLEDGE_GATEWAY_UNAVAILABLE"),
        ("1", "error-envelope", "KNOWLEDGE_GATEWAY_UNAVAILABLE"),
    ],
)
def test_layer_preflight_rejects_incompatible_deployments_and_closes_lease(
    monkeypatch, protocol, gateway_output, error
):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer
    from dify_agent.layers.knowledge_fs.configs import DifyKnowledgeFsLayerConfig, DifyKnowledgeFsRuntimeState
    from dify_agent.layers.knowledge_fs.layer import DifyKnowledgeFsLayer, DifyKnowledgeFsDeps
    from dify_agent.layers.shell.layer import DifyShellLayer
    from dify_agent.layers.shell.configs import DifyShellLayerConfig

    async def scenario():
        redis, store, _ = await session_fixture()
        shell = DifyShellLayer.from_config_with_settings(
            DifyShellLayerConfig(),
            agent_stub_api_base_url="http://stub",
            agent_stub_token_factory=lambda *args, **kwargs: "private-token",
        )
        output = gateway_output
        if output == "error-envelope":
            output = KnowledgeFsCommandResult(
                command="spaces", command_id=uuid4(), status="error", code="KNOWLEDGE_CONTEXT_INVALID"
            ).model_dump_json()
        remote = AsyncMock(
            side_effect=[
                SimpleNamespace(exit_code=0, output_complete=True, output=protocol),
                SimpleNamespace(exit_code=0, output_complete=True, output=output),
            ]
        )
        monkeypatch.setattr(DifyShellLayer, "run_remote_script", remote)
        layer = DifyKnowledgeFsLayer(config=DifyKnowledgeFsLayerConfig(spaces=[BINDING]), get_store=lambda: store)
        layer.runtime_state = DifyKnowledgeFsRuntimeState()
        layer.deps = DifyKnowledgeFsDeps(
            shell=shell,
            execution_context=DifyExecutionContextLayer.from_config_with_settings(
                CONTEXT, daemon_url="http://daemon", daemon_api_key="private-key"
            ),
        )
        with pytest.raises(KnowledgeFsError) as raised:
            async with layer.resource_context():
                await layer.start(run_id="run", resume=False)
        assert raised.value.code == error
        assert layer._session is None
        assert shell.agent_stub_session_id is None
        assert shell.knowledge_observation is None
        await redis.aclose()

    asyncio.run(scenario())
