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
    AgentStubConfigDownloadSource,
    AgentStubConfigManifestResponse,
    AgentStubConfigPushRequest,
    AgentStubConfigPushResponse,
    AgentStubFileDownloadRequest,
    AgentStubFileDownloadResponse,
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
    payload: dict[str, object] = {
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
        "config_version": {"id": "cfg-1", "kind": "build_draft", "writable": True, "source": "inner-api"},
        "skills": {"items": [{"id": "alpha", "name": "alpha", "description": "Alpha skill", "file_id": "tool-file-1"}]},
        "files": {"items": [{"id": "guide.txt", "name": "guide.txt", "file_id": "upload-file-1"}]},
        "env_keys": ["API_KEY"],
        "note": "Use carefully.",
        "ignored": True,
    }


@pytest.mark.anyio
async def test_dify_api_handler_manifest_success(monkeypatch: pytest.MonkeyPatch) -> None:
    original_async_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == (
            "https://api.example.com/inner/api/agent-config/agent-1/manifest"
            "?tenant_id=tenant-1&config_version_id=cfg-1&config_version_kind=build_draft&user_id=user-1"
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
        sandbox_files_base_url="https://sandbox-files.example.com",
    ).manifest(principal=_principal())

    assert isinstance(response, AgentStubConfigManifestResponse)
    assert response.agent_id == "agent-1"
    assert response.config_version.kind == "build_draft"
    assert response.skills.items[0].model_dump() == {
        "name": "alpha",
        "description": "Alpha skill",
        "size": None,
        "hash": None,
        "mime_type": None,
    }
    assert response.files.items[0].model_dump() == {
        "name": "guide.txt",
        "size": None,
        "hash": None,
        "mime_type": None,
    }


@pytest.mark.parametrize("prompt", ["  原文 🪷 [§skill:research:Research§]\r\n\n", ""])
def test_http_prompt_routes_use_signed_scope_and_preserve_text(monkeypatch: pytest.MonkeyPatch, prompt: str) -> None:
    original_async_client = httpx.AsyncClient
    saved = {"prompt": "original"}
    requests: list[str] = []
    scope = {
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "config_version_id": "cfg-1",
        "config_version_kind": "build_draft",
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/inner/api/agent-config/agent-1/prompt"
        assert request.headers["X-Inner-Api-Key"] == "inner-secret"
        requests.append(request.method)
        if request.method == "GET":
            assert dict(request.url.params) == scope
        else:
            assert request.method == "PUT"
            assert json.loads(request.content) == {**scope, "prompt": prompt}
            saved["prompt"] = prompt
        return httpx.Response(200, json=saved)

    monkeypatch.setattr(
        "dify_agent.agent_stub.server.agent_stub_config.httpx.AsyncClient",
        lambda **kwargs: original_async_client(transport=httpx.MockTransport(handler), **kwargs),
    )
    codec = _token_codec()
    app = FastAPI()
    app.include_router(
        create_agent_stub_http_router(
            codec,
            config_request_handler=DifyApiAgentStubConfigRequestHandler(
                inner_api_url="https://api.example.com",
                inner_api_key="inner-secret",
                sandbox_files_base_url="https://sandbox-files.example.com",
            ),
        )
    )
    with TestClient(app) as client:
        headers = {"Authorization": f"Bearer {codec.encode_connection_token(_execution_context())}"}
        assert client.get(
            "/agent-stub/config/prompt",
            headers=headers,
            params={**dict.fromkeys(scope, "other"), "agent_id": "other"},
        ).json() == {"prompt": "original"}
        response = client.put("/agent-stub/config/prompt", headers=headers, json={"prompt": prompt})
        assert response.status_code == 200
        assert response.json() == {"prompt": prompt}
        assert client.get("/agent-stub/config/prompt", headers=headers).json() == {"prompt": prompt}
    assert requests == ["GET", "PUT", "GET"]


@pytest.mark.parametrize("method", ["GET", "PUT"])
@pytest.mark.parametrize(
    ("status", "payload", "expected_status"),
    [
        (200, {}, 502),
        (200, {"prompt": None}, 502),
        (200, {"prompt": 123}, 502),
        (403, {"code": "config_not_writable"}, 403),
    ],
)
def test_http_prompt_routes_map_inner_response_errors(
    monkeypatch: pytest.MonkeyPatch, method: str, status: int, payload: object, expected_status: int
) -> None:
    original_async_client = httpx.AsyncClient
    monkeypatch.setattr(
        "dify_agent.agent_stub.server.agent_stub_config.httpx.AsyncClient",
        lambda **kwargs: original_async_client(
            transport=httpx.MockTransport(lambda request: httpx.Response(status, json=payload)), **kwargs
        ),
    )
    codec = _token_codec()
    app = FastAPI()
    app.include_router(
        create_agent_stub_http_router(
            codec,
            config_request_handler=DifyApiAgentStubConfigRequestHandler(
                inner_api_url="https://api.example.com",
                inner_api_key="inner-secret",
                sandbox_files_base_url="https://sandbox-files.example.com",
            ),
        )
    )
    with TestClient(app) as client:
        response = client.request(
            method,
            "/agent-stub/config/prompt",
            headers={"Authorization": f"Bearer {codec.encode_connection_token(_execution_context())}"},
            json={"prompt": "new"} if method == "PUT" else None,
        )
    assert response.status_code == expected_status
    if status == 403:
        assert response.json() == {"detail": payload}


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"prompt": None},
        {"prompt": 123},
        *[
            {"prompt": "x", key: "other"}
            for key in ("tenant_id", "agent_id", "user_id", "config_version_id", "config_version_kind")
        ],
    ],
)
def test_http_prompt_rejects_invalid_text_and_sandbox_scope_overrides(body: dict[str, object]) -> None:
    codec = _token_codec()
    app = FastAPI()
    app.include_router(create_agent_stub_http_router(codec))
    with TestClient(app) as client:
        response = client.put(
            "/agent-stub/config/prompt",
            headers={"Authorization": f"Bearer {codec.encode_connection_token(_execution_context())}"},
            json=body,
        )
    assert response.status_code == 422


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("operation", "field"),
    [
        (operation, field)
        for operation in ("get_prompt", "update_prompt")
        for field in ("agent_id", "agent_config_version_id", "agent_config_version_kind", "user_id")
        if operation == "update_prompt" or field != "user_id"
    ],
)
async def test_prompt_requires_execution_scope(operation: str, field: str) -> None:
    handler = DifyApiAgentStubConfigRequestHandler(
        inner_api_url="https://api.example.com",
        inner_api_key="secret",
        sandbox_files_base_url="https://files.example.com",
    )
    with pytest.raises(AgentStubConfigRequestError) as exc_info:
        principal = _principal(**{field: None})
        if operation == "get_prompt":
            await handler.get_prompt(principal=principal)
        else:
            await handler.update_prompt(principal=principal, prompt="new")
    assert exc_info.value.status_code == 400


@pytest.mark.anyio
async def test_dify_api_handler_config_download_returns_sandbox_data_plane_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_async_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/inner/api/agent-config/agent-1/download-request"
        assert json.loads(request.content) == {
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "config_version_id": "cfg-1",
            "config_version_kind": "build_draft",
            "config": {"kind": "skill", "name": "alpha"},
        }
        return httpx.Response(
            200,
            json={
                "filename": "alpha.zip",
                "mime_type": "application/zip",
                "size": 123,
                "download_uri": "/files/tools/alpha.zip?sign=1",
            },
        )

    monkeypatch.setattr(
        "dify_agent.agent_stub.server.agent_stub_config.httpx.AsyncClient",
        lambda **kwargs: original_async_client(transport=httpx.MockTransport(handler), **kwargs),
    )

    request_handler = DifyApiAgentStubConfigRequestHandler(
        inner_api_url="https://api.example.com",
        inner_api_key="inner-secret",
        sandbox_files_base_url="https://sandbox-files.example.com/dify",
    )

    response = await request_handler.create_download_request(
        principal=_principal(),
        source=AgentStubConfigDownloadSource(kind="skill", name="alpha"),
    )

    assert response == AgentStubFileDownloadResponse(
        filename="alpha.zip",
        mime_type="application/zip",
        size=123,
        download_url="https://sandbox-files.example.com/dify/files/tools/alpha.zip?sign=1",
    )


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
        sandbox_files_base_url="https://sandbox-files.example.com",
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
            "create_download_request",
            "/inner/api/agent-config/agent-1/download-request",
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
        sandbox_files_base_url="https://sandbox-files.example.com",
    )

    with pytest.raises(AgentStubConfigRequestError, match=expected_message) as exc_info:
        match method_name:
            case "manifest":
                await request_handler.manifest(principal=_principal())
            case "create_download_request":
                await request_handler.create_download_request(
                    principal=_principal(),
                    source=AgentStubConfigDownloadSource(kind="skill", name="alpha"),
                )
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
        sandbox_files_base_url="https://sandbox-files.example.com",
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
        "create_file_download_request",
        "inspect_config_skill",
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

        async def create_download_request(self, *, principal, source):
            del principal, source
            raise AgentStubConfigRequestError(409, {"code": "conflict"})

        async def inspect_skill(self, *, principal, name):
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
            case "create_file_download_request":
                await service.create_file_download_request(
                    request=AgentStubFileDownloadRequest(
                        config=AgentStubConfigDownloadSource(kind="skill", name="alpha"),
                        for_frontend=False,
                    ),
                    authorization=authorization,
                )
            case "inspect_config_skill":
                await service.inspect_config_skill(name="alpha", authorization=authorization)
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
        (
            "/agent-stub/files/download-request",
            "post",
            {"config": {"kind": "skill", "name": "alpha"}, "for_frontend": False},
            200,
            {"download_url": "https://sandbox-files.example.com/files/alpha.zip"},
        ),
        ("/agent-stub/config/skills/alpha/inspect", "get", None, 200, {"name": "alpha", "files": ["SKILL.md"]}),
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
    expected_detail: dict[str, object],
) -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)
    captured: dict[str, object] = {}

    class FakeHandler:
        async def manifest(self, *, principal):
            captured["manifest_agent_id"] = principal.execution_context.agent_id
            return AgentStubConfigManifestResponse.model_validate(_manifest_payload())

        async def create_download_request(self, *, principal, source):
            captured["download_agent_id"] = principal.execution_context.agent_id
            captured["download_source"] = source.model_dump()
            return AgentStubFileDownloadResponse(
                filename="alpha.zip",
                mime_type="application/zip",
                size=123,
                download_url="https://sandbox-files.example.com/files/alpha.zip",
            )

        async def inspect_skill(self, *, principal, name):
            del principal
            captured["inspect_name"] = name
            return {"name": name, "files": ["SKILL.md"]}

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
        create_agent_stub_http_router(
            codec,
            config_request_handler=cast(AgentStubConfigRequestHandler, cast(object, FakeHandler())),
        )
    )
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {token}"}
    response = client.request(method.upper(), path, headers=headers, json=body)

    assert response.status_code == expected_status
    for key, value in expected_detail.items():
        assert response.json()[key] == value

    if path.endswith("/manifest"):
        assert captured["manifest_agent_id"] == "agent-1"
    elif path.endswith("/files/download-request"):
        assert captured["download_agent_id"] == "agent-1"
        assert captured["download_source"] == {"kind": "skill", "name": "alpha"}
    elif path.endswith("/skills/alpha/inspect"):
        assert captured["inspect_name"] == "alpha"
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

        async def create_download_request(self, *, principal, source):
            del principal, source
            raise AssertionError("unexpected route")

        async def inspect_skill(self, *, principal, name):
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
