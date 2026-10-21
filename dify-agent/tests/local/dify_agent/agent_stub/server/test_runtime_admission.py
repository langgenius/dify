"""Ordinary Stub admission; only durable reader and external HTTP are doubles."""

import asyncio
import base64
import importlib
import json
import time

import httpx
import pytest

from dify_agent.adapters.native_testing.transport import (
    AgentRuntimeHTTPClient,
    AgentRuntimeTransportError,
    bind_runtime_identity,
)
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubTokenCodec
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol.native_testing import AgentRuntimeIdentity


def context():
    return DifyExecutionContextLayerConfig(
        tenant_id="tenant",
        user_id="user",
        user_from="account",
        agent_mode="agent_app",
        invoke_from="debugger",
        agent_id="agent",
        agent_config_version_id="config",
        agent_config_version_kind="draft",
    )


def identity():
    return AgentRuntimeIdentity(
        run_id="run", execution_mode="ordinary", parent_node=None, request_digest="a" * 64, agent_generation=0
    )


def codec():
    return AgentStubTokenCodec(b"a" * 32)


def principal():
    c = codec()
    with bind_runtime_identity(identity()):
        token = c.encode_runtime_token(context(), run_id="run", session_id=None)
    return c.decode_token(token)


def admission(reader):
    return importlib.import_module("dify_agent.agent_stub.server.admission").AgentStubAdmission(reader=reader)


def test_issuance_requires_actual_run_and_keeps_legacy_unselected():
    c = codec()
    assert c.decode_token(c.encode_connection_token(context())).runtime is None
    with pytest.raises(AgentRuntimeTransportError):
        c.encode_runtime_token(context(), run_id="run", session_id=None)
    with bind_runtime_identity(identity()):
        with pytest.raises(AgentRuntimeTransportError):
            c.encode_runtime_token(context(), run_id="other", session_id=None)
    assert principal().runtime == identity()


def test_live_ordinary_config_get_uses_final_owner_and_direct_injection_refuses():
    from dify_agent.agent_stub.server.agent_stub_config import DifyApiAgentStubConfigRequestHandler

    async def exercise():
        seen = []
        reads = []

        async def reader(selected):
            reads.append(selected)
            return identity()

        a = admission(reader)
        async with AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="backend",
            transport=httpx.MockTransport(lambda req: seen.append(req) or httpx.Response(200, json={})),
        ) as client:
            h = DifyApiAgentStubConfigRequestHandler(
                inner_api_url="http://api",
                inner_api_key="",
                sandbox_files_base_url="http://files",
                runtime_client=lambda: client,
                admission=a,
            )
            pr = principal()
            wrong = principal()
            with pytest.raises(AgentRuntimeTransportError):
                await h.inspect_skill(principal=pr, name="alpha")
            async with a.scope(pr):
                await h.inspect_skill(principal=pr, name="alpha")
                wrong.execution_context.tenant_id = "other"
                with pytest.raises(AgentRuntimeTransportError):
                    await h.inspect_skill(principal=wrong, name="alpha")
            assert len(seen) == 1
            req = seen[0]
            assert req.url.path == "/inner/api/agent/runtime/config/agent/skills/alpha/inspect"
            assert req.content == b""
            assert req.headers["Authorization"] == "Bearer backend"
            assert "x-inner-api-key" not in req.headers
            header = req.headers["X-Dify-Agent-Run"]
            assert json.loads(base64.urlsafe_b64decode(header + "=" * (-len(header) % 4)))["agent_run_id"] == "run"
            assert len(reads) >= 2

    asyncio.run(exercise())


@pytest.mark.parametrize("kind", ["missing", "generation", "run", "digest", "expired"])
def test_invalid_owner_refuses_before_send(kind):
    async def exercise():
        pr = principal()
        selected = identity()
        if kind == "generation":
            selected = selected.model_copy(update={"agent_generation": 1})
        if kind == "run":
            selected = selected.model_copy(update={"run_id": "other"})
        if kind == "digest":
            selected = selected.model_copy(update={"request_digest": "b" * 64})
        if kind == "missing":
            pr.runtime = None
        if kind == "expired":
            pr.expires_at = int(time.time()) - 1

        async def reader(_):
            return selected

        with pytest.raises(AgentRuntimeTransportError):
            async with admission(reader).scope(pr):
                pytest.fail("invalid owner admitted")

    asyncio.run(exercise())


def test_post_body_liveness_loss_and_detached_scope_refuse():
    async def exercise():
        live = True
        seen = []

        async def reader(_):
            if not live:
                raise AgentRuntimeTransportError("cancelled")
            return identity()

        a = admission(reader)

        class Body(httpx.AsyncByteStream):
            async def __aiter__(self):
                nonlocal live
                live = False
                yield b"{}"

        async with AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="backend",
            transport=httpx.MockTransport(lambda req: seen.append(req) or httpx.Response(200)),
        ) as client:
            async with a.scope(principal()):
                with pytest.raises(AgentRuntimeTransportError):
                    await client.send(
                        httpx.Request("POST", "http://api/inner/api/agent/runtime/files/upload-request", stream=Body())
                    )
            live = True
            go = asyncio.Event()

            async def detached():
                await go.wait()
                with pytest.raises(AgentRuntimeTransportError):
                    await client.post("http://api/inner/api/agent/runtime/files/upload-request", json={})

            async with a.scope(principal()):
                task = asyncio.create_task(detached())
            go.set()
            await task
        assert seen == []

    asyncio.run(exercise())


@pytest.mark.parametrize("suffix", ["&tenant_id=other", "&unknown=x", "&%74enant_id=other"])
def test_config_query_duplicate_or_extra_refuses(suffix):
    async def exercise():
        async with AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="backend",
            transport=httpx.MockTransport(lambda req: pytest.fail("network reached")),
        ) as client:
            with bind_runtime_identity(identity()):
                with pytest.raises(AgentRuntimeTransportError):
                    await client.get(
                        "http://api/inner/api/agent/runtime/config/agent/manifest?tenant_id=tenant&config_version_id=config&config_version_kind=draft"
                        + suffix
                    )

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "method,operation",
    [
        ("GET", "manifest"),
        ("GET", "skills/alpha/inspect"),
        ("POST", "download-request"),
        ("POST", "push"),
        ("PATCH", "env"),
        ("PUT", "note"),
    ],
)
def test_six_config_routes_only_accept_their_method(method, operation):
    async def exercise():
        seen = []
        async with AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="backend",
            transport=httpx.MockTransport(lambda req: seen.append(req) or httpx.Response(200)),
        ) as client:
            url = "http://api/inner/api/agent/runtime/config/agent/" + operation
            params = (
                {"tenant_id": "tenant", "config_version_id": "config", "config_version_kind": "draft"}
                if method == "GET"
                else None
            )
            with bind_runtime_identity(identity()):
                await client.request(method, url, params=params)
                with pytest.raises(AgentRuntimeTransportError):
                    await client.request("DELETE", url, params=params)
        assert len(seen) == 1

    asyncio.run(exercise())


def test_connect_and_delegated_download_require_same_admitted_owner():
    from dify_agent.agent_stub.protocol.agent_stub import AgentStubFileDownloadRequest
    from dify_agent.agent_stub.server.agent_stub_config import DifyApiAgentStubConfigRequestHandler
    from dify_agent.agent_stub.server.control_plane import AgentStubControlPlaneError, AgentStubControlPlaneService

    async def exercise():
        c = codec()
        with bind_runtime_identity(identity()):
            token = c.encode_runtime_token(context(), run_id="run", session_id=None)

        async def reader(_):
            return identity()

        a = admission(reader)
        seen = []
        async with AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="backend",
            transport=httpx.MockTransport(
                lambda req: (
                    seen.append(req)
                    or httpx.Response(
                        200,
                        json={
                            "download_uri": "/files/test?sign=x",
                            "filename": "test",
                            "mime_type": "text/plain",
                            "size": 4,
                        },
                    )
                )
            ),
        ) as client:
            h = DifyApiAgentStubConfigRequestHandler(
                inner_api_url="http://api",
                inner_api_key="",
                sandbox_files_base_url="http://files",
                runtime_client=lambda: client,
                admission=a,
            )
            service = AgentStubControlPlaneService(token_codec=c, admission=a, config_request_handler=h)
            assert (await service.connect(authorization="Bearer " + token)).status == "connected"
            request = AgentStubFileDownloadRequest.model_validate(
                {"config": {"kind": "skill", "name": "alpha"}, "for_frontend": False}
            )
            response = await service.create_file_download_request(request=request, authorization="Bearer " + token)
            assert response.download_url == "http://files/files/test?sign=x"
            assert seen[0].url.path == "/inner/api/agent/runtime/config/agent/download-request"
            with pytest.raises(AgentStubControlPlaneError):
                await service.connect(authorization="Bearer " + c.encode_connection_token(context()))

    asyncio.run(exercise())


@pytest.mark.parametrize("name", ["..", "../alpha", "%61lpha", "alpha/../beta", "alpha?tenant_id=other"])
def test_skill_alias_refuses_before_httpx_normalization(name):
    from dify_agent.agent_stub.server.agent_stub_config import DifyApiAgentStubConfigRequestHandler

    async def exercise():
        async def reader(_):
            return identity()

        a = admission(reader)
        async with AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="backend",
            transport=httpx.MockTransport(lambda req: pytest.fail("network reached")),
        ) as client:
            h = DifyApiAgentStubConfigRequestHandler(
                inner_api_url="http://api",
                inner_api_key="",
                sandbox_files_base_url="http://files",
                runtime_client=lambda: client,
                admission=a,
            )
            pr = principal()
            async with a.scope(pr):
                with pytest.raises(AgentRuntimeTransportError):
                    await h.inspect_skill(principal=pr, name=name)

    asyncio.run(exercise())


def test_context_mutation_during_live_read_refuses():
    async def exercise():
        pr = principal()
        pr.expires_at = int(time.time()) + 1

        async def reader(_):
            pr.execution_context.tenant_id = "changed-during-read"
            return identity()

        with pytest.raises(AgentRuntimeTransportError):
            async with admission(reader).scope(pr):
                pytest.fail("changed principal admitted")

    asyncio.run(exercise())


def test_expiry_during_final_live_read_refuses(monkeypatch):
    async def exercise():
        pr = principal()
        reads = 0

        async def reader(_):
            nonlocal reads
            reads += 1
            if reads == 2:
                monkeypatch.setattr(time, "time", lambda: pr.expires_at + 1)
            return identity()

        async with AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="backend",
            transport=httpx.MockTransport(lambda req: pytest.fail("expired request sent")),
        ) as client:
            async with admission(reader).scope(pr):
                with pytest.raises(AgentRuntimeTransportError):
                    await client.post("http://api/inner/api/agent/runtime/files/upload-request", json={})
        assert reads == 2

    asyncio.run(exercise())


def test_standalone_strict_refuses_valid_runtime_token_without_live_store():
    from fastapi.testclient import TestClient

    from dify_agent.agent_stub.server.app import create_agent_stub_app
    from dify_agent.server.settings import ServerSettings

    settings = ServerSettings(
        server_secret_key=base64.urlsafe_b64encode(b"x" * 32).rstrip(b"=").decode(), _env_file=None
    )
    c = settings.create_agent_stub_token_codec()
    with bind_runtime_identity(identity()):
        token = c.encode_runtime_token(context(), run_id="run", session_id=None)
    with TestClient(create_agent_stub_app(settings)) as client:
        result = client.post(
            "/agent-stub/connections",
            json={"protocol_version": 1, "argv": ["connect"]},
            headers={"Authorization": "Bearer " + token},
        )
    assert result.status_code == 403


def test_runtime_token_cannot_enter_explicit_legacy_service():
    from dify_agent.agent_stub.server.control_plane import AgentStubControlPlaneError, AgentStubControlPlaneService

    async def exercise():
        c = codec()
        with bind_runtime_identity(identity()):
            token = c.encode_runtime_token(context(), run_id="run", session_id=None)
        with pytest.raises(AgentStubControlPlaneError):
            await AgentStubControlPlaneService(token_codec=c).connect(authorization="Bearer " + token)

    asyncio.run(exercise())


@pytest.mark.parametrize("file_operation", [False, True])
def test_strict_timeout_preserves_public_error(file_operation):
    from dify_agent.agent_stub.protocol.agent_stub import AgentStubFileUploadRequest
    from dify_agent.agent_stub.server.agent_stub_config import (
        AgentStubConfigRequestError,
        DifyApiAgentStubConfigRequestHandler,
    )
    from dify_agent.agent_stub.server.agent_stub_files import (
        AgentStubFileRequestError,
        DifyApiAgentStubFileRequestHandler,
    )

    async def exercise():
        async def reader(_):
            return identity()

        def timeout(req):
            raise httpx.ReadTimeout("timeout", request=req)

        a = admission(reader)
        async with AgentRuntimeHTTPClient(
            api_url="http://api", api_token="backend", transport=httpx.MockTransport(timeout)
        ) as client:
            kwargs = dict(
                inner_api_url="http://api",
                inner_api_key="",
                sandbox_files_base_url="http://files",
                runtime_client=lambda: client,
                admission=a,
            )
            pr = principal()
            async with a.scope(pr):
                with pytest.raises((AgentStubConfigRequestError, AgentStubFileRequestError)) as err:
                    if file_operation:
                        await DifyApiAgentStubFileRequestHandler(
                            **kwargs, max_upload_size_bytes=1024
                        ).create_upload_request(
                            principal=pr, request=AgentStubFileUploadRequest(filename="test", mimetype="text/plain")
                        )
                    else:
                        await DifyApiAgentStubConfigRequestHandler(**kwargs).inspect_skill(principal=pr, name="alpha")
                assert err.value.status_code == 504

    asyncio.run(exercise())


def test_strict_file_upload_uses_signed_context_and_final_header():
    from dify_agent.agent_stub.protocol.agent_stub import AgentStubFileUploadRequest
    from dify_agent.agent_stub.server.agent_stub_files import DifyApiAgentStubFileRequestHandler

    async def exercise():
        seen = []

        async def reader(_):
            return identity()

        a = admission(reader)
        async with AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="backend",
            transport=httpx.MockTransport(
                lambda req: seen.append(req) or httpx.Response(200, json={"upload_uri": "/files/upload?sign=x"})
            ),
        ) as client:
            h = DifyApiAgentStubFileRequestHandler(
                inner_api_url="http://api",
                inner_api_key="",
                sandbox_files_base_url="http://files",
                max_upload_size_bytes=1024,
                runtime_client=lambda: client,
                admission=a,
            )
            pr = principal()
            request = AgentStubFileUploadRequest(filename="test", mimetype="text/plain")
            with pytest.raises(AgentRuntimeTransportError):
                await h.create_upload_request(principal=pr, request=request)
            async with a.scope(pr):
                result = await h.create_upload_request(principal=pr, request=request)
        assert result.upload_url == "http://files/files/upload?sign=x"
        assert len(seen) == 1
        assert seen[0].url.path == "/inner/api/agent/runtime/files/upload-request"
        assert json.loads(seen[0].content)["tenant_id"] == "tenant"
        assert seen[0].headers["Authorization"] == "Bearer backend"
        assert "X-Dify-Agent-Run" in seen[0].headers

    asyncio.run(exercise())


def test_native_claims_refuse_before_reader_or_issuance():
    from tests.local.dify_agent.adapters.native_testing.test_transport import identity as native_identity

    c = codec()
    native = native_identity(native=True)
    with bind_runtime_identity(native):
        with pytest.raises(AgentRuntimeTransportError):
            c.encode_runtime_token(context(), run_id=native.run_id, session_id=None)
    claims = c.build_connection_claims(context())
    claims.runtime = native
    pr = c.decode_token(c.encode_claims(claims))

    async def reader(_):
        pytest.fail("native reader reached")

    async def exercise():
        with pytest.raises(AgentRuntimeTransportError):
            async with admission(reader).scope(pr):
                pytest.fail("native admitted")

    asyncio.run(exercise())


def test_confirmed_stub_token_preserves_claimed_envelope_and_config_get_forwards_it():
    from dify_agent.agent_stub.server.agent_stub_config import DifyApiAgentStubConfigRequestHandler
    from dify_agent.protocol.native_testing import (
        AgentDispatchPermit,
        AgentEffectIntent,
        AgentNativeTestRef,
        AgentOperationKey,
    )
    from dify_agent.runtime.native_effects import NativeDispatchEnvelope, _dispatch

    ref = AgentNativeTestRef(
        policy_version="builder-native-test-v1",
        request_id="request",
        invocation_id="invocation",
        context_digest="a" * 64,
    )
    selected = AgentRuntimeIdentity(
        run_id="run",
        execution_mode="builder_test",
        native_test_profile="confirmed",
        request_digest="a" * 64,
        agent_generation=0,
        parent_node={
            "ref": ref,
            "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
            "input_result_ref": "input",
            "input_digest": "b" * 64,
        },
    )
    envelope = NativeDispatchEnvelope(
        ref,
        AgentEffectIntent(
            key=AgentOperationKey(
                invocation_id="invocation",
                occurrence_path=("4c959aea-9025-4db9-9361-eed1191c11c7", "config_pull", "skill"),
                cursor=0,
            ),
            kind="shell",
            resource_ref="workspace",
            implementation_revision="v1",
            account_ref=None,
            target={"kind": "skill", "shell": "shell"},
            parameters={"script": "pull"},
            input_digest="b" * 64,
            capability_digest="c" * 64,
        ),
        AgentDispatchPermit(
            permit_id="permit", attempt_id="attempt", operation_id="operation", expires_at="2099-01-01T00:00:00Z"
        ),
    )
    c = codec()
    with bind_runtime_identity(selected):
        with pytest.raises(AgentRuntimeTransportError):
            c.encode_runtime_token(context(), run_id="run", session_id=None)
        token = _dispatch.set(envelope)
        try:
            pr = c.decode_token(c.encode_runtime_token(context(), run_id="run", session_id=None))
        finally:
            _dispatch.reset(token)

    async def exercise():
        seen = []

        async def reader(identity):
            return selected

        a = admission(reader)
        async with AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="backend",
            transport=httpx.MockTransport(lambda req: seen.append(req) or httpx.Response(200, json={})),
        ) as client:
            h = DifyApiAgentStubConfigRequestHandler(
                inner_api_url="http://api",
                inner_api_key="",
                sandbox_files_base_url="http://files",
                runtime_client=lambda: client,
                admission=a,
            )
            async with a.scope(pr):
                await h.inspect_skill(principal=pr, name="alpha")
                with pytest.raises(AgentRuntimeTransportError):
                    await h.update_note(principal=pr, note="forbidden")
            assert len(seen) == 1
            header = seen[0].headers["X-Dify-Agent-Dispatch"]
            actual = json.loads(base64.urlsafe_b64decode(header + "=" * (-len(header) % 4)))
            assert actual == envelope.wire()

    asyncio.run(exercise())


def test_confirmed_stub_durable_reader_requires_exact_active_identity():
    from dify_agent.runtime.native_continuation import NativeContinuationConflict
    from dify_agent.storage.redis_run_store import RedisRunStore

    selected = AgentRuntimeIdentity(
        run_id="run",
        execution_mode="builder_test",
        native_test_profile="confirmed",
        request_digest="a" * 64,
        agent_generation=0,
        parent_node={
            "ref": {
                "policy_version": "builder-native-test-v1",
                "request_id": "request",
                "invocation_id": "invocation",
                "context_digest": "a" * 64,
            },
            "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
            "input_result_ref": "input",
            "input_digest": "b" * 64,
        },
    )

    async def exercise():
        from unittest.mock import patch

        from redis.asyncio import Redis

        redis = Redis()
        response = [selected.model_dump_json()]

        async def read(*_args, **_kwargs):
            return response[0]

        with patch.object(redis, "eval", side_effect=read):
            store = RedisRunStore(redis)
            assert await store.read_active_stub_identity(selected) == selected
            response[0] = selected.model_copy(update={"agent_generation": 1}).model_dump_json()
            with pytest.raises(NativeContinuationConflict):
                await store.read_active_stub_identity(selected)
        await redis.aclose()

    asyncio.run(exercise())
