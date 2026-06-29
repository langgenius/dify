from __future__ import annotations

import base64
import json
import secrets
import time
from typing import cast

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubConfigManifestResponse,
    AgentStubConfigPushRequest,
    AgentStubConfigPushResponse,
)
from dify_agent.agent_stub.server.agent_stub_config import (
    AgentStubConfigRequestError,
    AgentStubConfigRequestHandler,
    DifyApiAgentStubConfigRequestHandler,
)
from dify_agent.agent_stub.server.control_plane import AgentStubControlPlaneError, AgentStubControlPlaneService
from dify_agent.agent_stub.server.routes.agent_stub import create_agent_stub_http_router
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubPrincipal, AgentStubTokenCodec
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


def _base64url_secret(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _token_codec() -> AgentStubTokenCodec:
    return AgentStubTokenCodec.from_server_secret(_base64url_secret(secrets.token_bytes(32)))


def _execution_context(**updates: object) -> DifyExecutionContextLayerConfig:
    payload = {
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "user_from": "account",
        "agent_mode": "workflow_run",
        "invoke_from": "service-api",
        "agent_id": "agent-1",
        "agent_config_version_id": "cfg-1",
        "agent_config_version_kind": "build_draft",
    }
    payload.update(updates)
    return DifyExecutionContextLayerConfig.model_validate(payload)


def _principal(**context_updates: object) -> AgentStubPrincipal:
    return AgentStubPrincipal(
        execution_context=_execution_context(**context_updates),
        session_id=None,
        scope=["agent_stub:connect"],
        token_id="token-1",
    )


def _manifest_payload() -> dict[str, object]:
    return {
        "agent_id": "agent-1",
        "config_version": {"id": "cfg-1", "kind": "build_draft", "writable": True},
        "skills": [{"name": "alpha", "description": "Alpha skill"}],
        "files": [{"name": "guide.txt"}],
        "env_keys": ["API_KEY"],
        "note": "Use carefully.",
    }


@pytest.mark.anyio
async def test_dify_api_handler_manifest_success(monkeypatch: pytest.MonkeyPatch) -> None:
    original_async_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == (
            "https://api.example.com/inner/api/agent-config/agent-1/manifest"
            "?tenant_id=tenant-1&config_version_id=cfg-1&config_version_kind=build_draft"
        )
        assert request.headers["X-Inner-Api-Key"] == "inner-secret"
        return httpx.Response(200, json=_manifest_payload())

    monkeypatch.setattr(
        "dify_agent.agent_stub.server.agent_stub_config.httpx.AsyncClient",
        lambda **kwargs: original_async_client(transport=httpx.MockTransport(handler), **kwargs),
    )

    response = await DifyApiAgentStubConfigRequestHandler(
        inner_api_url="https://api.example.com",
        inner_api_key="inner-secret",
    ).manifest(principal=_principal())

    assert isinstance(response, AgentStubConfigManifestResponse)
    assert response.agent_id == "agent-1"
    assert response.config_version.kind == "build_draft"


@pytest.mark.anyio
async def test_dify_api_handler_pull_endpoints_return_bytes(monkeypatch: pytest.MonkeyPatch) -> None:
    original_async_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/skills/alpha/pull"):
            return httpx.Response(200, content=b"zip-bytes")
        if request.url.path.endswith("/files/guide.txt/pull"):
            return httpx.Response(200, content=b"file-bytes")
        raise AssertionError(f"unexpected path: {request.url.path}")

    monkeypatch.setattr(
        "dify_agent.agent_stub.server.agent_stub_config.httpx.AsyncClient",
        lambda **kwargs: original_async_client(transport=httpx.MockTransport(handler), **kwargs),
    )

    request_handler = DifyApiAgentStubConfigRequestHandler(
        inner_api_url="https://api.example.com",
        inner_api_key="inner-secret",
    )

    assert await request_handler.pull_skill(principal=_principal(), name="alpha") == b"zip-bytes"
    assert await request_handler.pull_file(principal=_principal(), name="guide.txt") == b"file-bytes"


@pytest.mark.anyio
async def test_dify_api_handler_push_env_and_note_success(monkeypatch: pytest.MonkeyPatch) -> None:
    original_async_client = httpx.AsyncClient
    captured: list[tuple[str, dict[str, object]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        captured.append((request.url.path, payload))
        if request.url.path.endswith("/push"):
            return httpx.Response(200, json=_manifest_payload())
        if request.url.path.endswith("/env"):
            return httpx.Response(200, json={"env_keys": ["API_KEY"]})
        if request.url.path.endswith("/note"):
            return httpx.Response(200, json={"note": "updated"})
        raise AssertionError(f"unexpected path: {request.url.path}")

    monkeypatch.setattr(
        "dify_agent.agent_stub.server.agent_stub_config.httpx.AsyncClient",
        lambda **kwargs: original_async_client(transport=httpx.MockTransport(handler), **kwargs),
    )

    request_handler = DifyApiAgentStubConfigRequestHandler(
        inner_api_url="https://api.example.com",
        inner_api_key="inner-secret",
    )

    push_response = await request_handler.push(
        principal=_principal(),
        request=AgentStubConfigPushRequest(note="hello"),
    )
    env_response = await request_handler.update_env(principal=_principal(), env_text="API_KEY=value\n")
    note_response = await request_handler.update_note(principal=_principal(), note="updated")

    assert isinstance(push_response, AgentStubConfigPushResponse)
    assert env_response == {"env_keys": ["API_KEY"]}
    assert note_response == {"note": "updated"}
    assert captured == [
        (
            "/inner/api/agent-config/agent-1/push",
            {
                "tenant_id": "tenant-1",
                "user_id": "user-1",
                "config_version_id": "cfg-1",
                "config_version_kind": "build_draft",
                "files": [],
                "skills": [],
                "note": "hello",
            },
        ),
        (
            "/inner/api/agent-config/agent-1/env",
            {
                "tenant_id": "tenant-1",
                "user_id": "user-1",
                "config_version_id": "cfg-1",
                "config_version_kind": "build_draft",
                "env_text": "API_KEY=value\n",
            },
        ),
        (
            "/inner/api/agent-config/agent-1/note",
            {
                "tenant_id": "tenant-1",
                "user_id": "user-1",
                "config_version_id": "cfg-1",
                "config_version_kind": "build_draft",
                "note": "updated",
            },
        ),
    ]


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("method_name", "path", "response", "expected_status", "expected_message"),
    [
        (
            "manifest",
            "/inner/api/agent-config/agent-1/manifest",
            httpx.Response(200, json={"bad": "shape"}),
            502,
            "manifest",
        ),
        (
            "pull_skill",
            "/inner/api/agent-config/agent-1/skills/alpha/pull",
            httpx.Response(404, json={"detail": "missing"}),
            404,
            "missing",
        ),
        ("push", "/inner/api/agent-config/agent-1/push", httpx.Response(200, json={"bad": "shape"}), 502, "push"),
        ("update_env", "/inner/api/agent-config/agent-1/env", httpx.Response(200, json=["bad"]), 502, "env"),
        (
            "update_note",
            "/inner/api/agent-config/agent-1/note",
            httpx.Response(200, text="not-json"),
            502,
            "invalid JSON",
        ),
    ],
)
async def test_dify_api_handler_maps_error_cases(
    monkeypatch: pytest.MonkeyPatch,
    method_name: str,
    path: str,
    response: httpx.Response,
    expected_status: int,
    expected_message: str,
) -> None:
    original_async_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == path
        return response

    monkeypatch.setattr(
        "dify_agent.agent_stub.server.agent_stub_config.httpx.AsyncClient",
        lambda **kwargs: original_async_client(transport=httpx.MockTransport(handler), **kwargs),
    )

    request_handler = DifyApiAgentStubConfigRequestHandler(
        inner_api_url="https://api.example.com",
        inner_api_key="inner-secret",
    )

    with pytest.raises(AgentStubConfigRequestError, match=expected_message) as exc_info:
        match method_name:
            case "manifest":
                await request_handler.manifest(principal=_principal())
            case "pull_skill":
                await request_handler.pull_skill(principal=_principal(), name="alpha")
            case "push":
                await request_handler.push(principal=_principal(), request=AgentStubConfigPushRequest())
            case "update_env":
                await request_handler.update_env(principal=_principal(), env_text="API_KEY=value\n")
            case "update_note":
                await request_handler.update_note(principal=_principal(), note="hello")
            case _:
                raise AssertionError(f"unexpected method: {method_name}")

    assert exc_info.value.status_code == expected_status


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("context_updates", "expected_message"),
    [
        ({"agent_id": None}, "agent_id is required"),
        ({"agent_config_version_id": None}, "agent_config_version_id is required"),
        ({"agent_config_version_kind": None}, "agent_config_version_kind is required"),
        ({"user_id": None}, "user_id is required"),
    ],
)
async def test_dify_api_handler_validates_required_execution_context_fields(
    context_updates: dict[str, object],
    expected_message: str,
) -> None:
    request_handler = DifyApiAgentStubConfigRequestHandler(
        inner_api_url="https://api.example.com",
        inner_api_key="inner-secret",
    )

    with pytest.raises(AgentStubConfigRequestError, match=expected_message) as exc_info:
        if context_updates.get("user_id", "user-1") is None:
            await request_handler.push(principal=_principal(**context_updates), request=AgentStubConfigPushRequest())
        else:
            await request_handler.manifest(principal=_principal(**context_updates))

    assert exc_info.value.status_code == 400


@pytest.mark.anyio
@pytest.mark.parametrize(
    "method_name",
    [
        "get_config_manifest",
        "pull_config_skill",
        "inspect_config_skill",
        "pull_config_file",
        "push_config",
        "update_config_env",
        "update_config_note",
    ],
)
async def test_control_plane_maps_config_request_errors(method_name: str) -> None:
    codec = _token_codec()
    authorization = f"Bearer {codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)}"

    class FakeHandler:
        async def manifest(self, *, principal):
            del principal
            raise AgentStubConfigRequestError(409, {"code": "conflict"})

        async def pull_skill(self, *, principal, name):
            del principal, name
            raise AgentStubConfigRequestError(409, {"code": "conflict"})

        async def inspect_skill(self, *, principal, name):
            del principal, name
            raise AgentStubConfigRequestError(409, {"code": "conflict"})

        async def pull_file(self, *, principal, name):
            del principal, name
            raise AgentStubConfigRequestError(409, {"code": "conflict"})

        async def push(self, *, principal, request):
            del principal, request
            raise AgentStubConfigRequestError(409, {"code": "conflict"})

        async def update_env(self, *, principal, env_text):
            del principal, env_text
            raise AgentStubConfigRequestError(409, {"code": "conflict"})

        async def update_note(self, *, principal, note):
            del principal, note
            raise AgentStubConfigRequestError(409, {"code": "conflict"})

    service = AgentStubControlPlaneService(
        codec, config_request_handler=cast(AgentStubConfigRequestHandler, FakeHandler())
    )

    with pytest.raises(AgentStubControlPlaneError) as exc_info:
        match method_name:
            case "get_config_manifest":
                await service.get_config_manifest(authorization=authorization)
            case "pull_config_skill":
                await service.pull_config_skill(name="alpha", authorization=authorization)
            case "inspect_config_skill":
                await service.inspect_config_skill(name="alpha", authorization=authorization)
            case "pull_config_file":
                await service.pull_config_file(name="guide.txt", authorization=authorization)
            case "push_config":
                await service.push_config(request=AgentStubConfigPushRequest(), authorization=authorization)
            case "update_config_env":
                await service.update_config_env(env_text="API_KEY=value\n", authorization=authorization)
            case "update_config_note":
                await service.update_config_note(note="hello", authorization=authorization)
            case _:
                raise AssertionError(f"unexpected method: {method_name}")

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == {"code": "conflict"}


@pytest.mark.parametrize(
    ("path", "method", "body", "expected_status", "expected_detail"),
    [
        ("/agent-stub/config/manifest", "get", None, 200, {"agent_id": "agent-1"}),
        ("/agent-stub/config/skills/alpha/pull", "get", None, 200, b"zip-bytes"),
        ("/agent-stub/config/skills/alpha/inspect", "get", None, 200, {"name": "alpha", "files": ["SKILL.md"]}),
        ("/agent-stub/config/files/guide.txt/pull", "get", None, 200, b"file-bytes"),
        ("/agent-stub/config/push", "post", {"note": "hello"}, 200, {"agent_id": "agent-1"}),
        ("/agent-stub/config/env", "patch", {"env_text": "API_KEY=value\n"}, 200, {"env_keys": ["API_KEY"]}),
        ("/agent-stub/config/note", "put", {"note": "hello"}, 200, {"note": "hello"}),
    ],
)
def test_http_config_routes_forward_requests(
    path: str,
    method: str,
    body: dict[str, object] | None,
    expected_status: int,
    expected_detail: dict[str, object] | bytes,
) -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)
    captured: dict[str, object] = {}

    class FakeHandler:
        async def manifest(self, *, principal):
            captured["manifest_agent_id"] = principal.execution_context.agent_id
            return AgentStubConfigManifestResponse.model_validate(_manifest_payload())

        async def pull_skill(self, *, principal, name):
            del principal
            captured["skill_name"] = name
            return b"zip-bytes"

        async def inspect_skill(self, *, principal, name):
            del principal
            captured["inspect_name"] = name
            return {"name": name, "files": ["SKILL.md"]}

        async def pull_file(self, *, principal, name):
            del principal
            captured["file_name"] = name
            return b"file-bytes"

        async def push(self, *, principal, request):
            del principal
            captured["push_note"] = request.note
            return AgentStubConfigPushResponse.model_validate(_manifest_payload())

        async def update_env(self, *, principal, env_text):
            del principal
            captured["env_text"] = env_text
            return {"env_keys": ["API_KEY"]}

        async def update_note(self, *, principal, note):
            del principal
            captured["note"] = note
            return {"note": note}

    app = FastAPI()
    app.include_router(
        create_agent_stub_http_router(codec, config_request_handler=cast(AgentStubConfigRequestHandler, FakeHandler()))
    )
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {token}"}
    response = client.request(method.upper(), path, headers=headers, json=body)

    assert response.status_code == expected_status
    if isinstance(expected_detail, bytes):
        assert response.content == expected_detail
    else:
        for key, value in expected_detail.items():
            assert response.json()[key] == value

    if path.endswith("/manifest"):
        assert captured["manifest_agent_id"] == "agent-1"
    elif path.endswith("/skills/alpha/pull"):
        assert captured["skill_name"] == "alpha"
        assert response.headers["content-type"] == "application/zip"
    elif path.endswith("/skills/alpha/inspect"):
        assert captured["inspect_name"] == "alpha"
    elif path.endswith("/files/guide.txt/pull"):
        assert captured["file_name"] == "guide.txt"
        assert response.headers["content-type"] == "application/octet-stream"
    elif path.endswith("/config/push"):
        assert captured["push_note"] == "hello"
    elif path.endswith("/config/env"):
        assert captured["env_text"] == "API_KEY=value\n"
    elif path.endswith("/config/note"):
        assert captured["note"] == "hello"


def test_http_config_routes_map_handler_errors() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)

    class ErrorHandler:
        async def manifest(self, *, principal):
            del principal
            raise AgentStubConfigRequestError(422, {"code": "invalid_request"})

        async def pull_skill(self, *, principal, name):
            del principal, name
            raise AssertionError("unexpected route")

        async def inspect_skill(self, *, principal, name):
            del principal, name
            raise AssertionError("unexpected route")

        async def pull_file(self, *, principal, name):
            del principal, name
            raise AssertionError("unexpected route")

        async def push(self, *, principal, request):
            del principal, request
            raise AssertionError("unexpected route")

        async def update_env(self, *, principal, env_text):
            del principal, env_text
            raise AssertionError("unexpected route")

        async def update_note(self, *, principal, note):
            del principal, note
            raise AssertionError("unexpected route")

    app = FastAPI()
    app.include_router(
        create_agent_stub_http_router(codec, config_request_handler=cast(AgentStubConfigRequestHandler, ErrorHandler()))
    )
    client = TestClient(app)
    response = client.get("/agent-stub/config/manifest", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 422
    assert response.json()["detail"] == {"code": "invalid_request"}
