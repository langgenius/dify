from __future__ import annotations

import asyncio
import json

import httpx

from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubDriveCommitItem,
    AgentStubDriveCommitRequest,
    AgentStubDriveFileRef,
)
from dify_agent.agent_stub.server.agent_stub_drive import (
    AgentStubDriveRequestError,
    DifyApiAgentStubDriveRequestHandler,
)
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubPrincipal
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


def _principal() -> AgentStubPrincipal:
    return AgentStubPrincipal(
        execution_context=DifyExecutionContextLayerConfig(
            tenant_id="tenant-1",
            user_id="user-1",
            user_from="account",
            workflow_id="workflow-1",
            agent_id="agent-1",
            agent_mode="workflow_run",
            invoke_from="service-api",
        ),
        session_id="session-1",
        scope=["agent_stub:connect"],
        token_id="token-1",
    )


def _patch_async_client(monkeypatch, handler) -> None:
    original_async_client = httpx.AsyncClient
    monkeypatch.setattr(
        "dify_agent.agent_stub.server.agent_stub_drive.httpx.AsyncClient",
        lambda **kwargs: original_async_client(transport=httpx.MockTransport(handler), **kwargs),
    )


def test_dify_api_agent_stub_drive_handler_injects_execution_context_for_manifest(monkeypatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert str(request.url) == (
            "https://api.example.com/inner/api/drive/agent-agent-1/manifest"
            "?tenant_id=tenant-1&prefix=skills%2F&include_download_url=true"
        )
        assert request.headers["X-Inner-Api-Key"] == "inner-secret"
        return httpx.Response(
            200,
            json={
                "items": [
                    {
                        "key": "skills/example/SKILL.md",
                        "name": "SKILL.md",
                        "size": 12,
                        "hash": "sha256:abc",
                        "mime_type": "text/markdown",
                        "file_kind": "tool_file",
                        "file_id": "tool-file-1",
                        "created_at": 123,
                        "download_url": "https://files.example.com/download",
                    }
                ]
            },
        )

    _patch_async_client(monkeypatch, handler)
    drive_handler = DifyApiAgentStubDriveRequestHandler(
        inner_api_url="https://api.example.com",
        inner_api_key="inner-secret",
    )

    async def scenario() -> None:
        response = await drive_handler.get_manifest(
            principal=_principal(),
            prefix="skills/",
            include_download_url=True,
        )
        assert response.items[0].download_url == "https://files.example.com/download"
        assert response.items[0].model_extra == {"name": "SKILL.md"}

    asyncio.run(scenario())


def test_dify_api_agent_stub_drive_handler_injects_execution_context_for_commit(monkeypatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == "https://api.example.com/inner/api/drive/agent-agent-1/commit"
        assert json.loads(request.content) == {
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "items": [
                {
                    "key": "skills/example/SKILL.md",
                    "file_ref": {"kind": "tool_file", "id": "tool-file-1"},
                    "value_owned_by_drive": True,
                    "is_skill": False,
                }
            ],
        }
        return httpx.Response(
            200,
            json={
                "items": [
                    {
                        "key": "skills/example/SKILL.md",
                        "size": 12,
                        "mime_type": "text/markdown",
                        "file_kind": "tool_file",
                        "file_id": "tool-file-1",
                        "value_owned_by_drive": True,
                    }
                ]
            },
        )

    _patch_async_client(monkeypatch, handler)
    drive_handler = DifyApiAgentStubDriveRequestHandler(
        inner_api_url="https://api.example.com",
        inner_api_key="inner-secret",
    )

    async def scenario() -> None:
        response = await drive_handler.commit(
            principal=_principal(),
            request=AgentStubDriveCommitRequest(
                items=[
                    AgentStubDriveCommitItem(
                        key="skills/example/SKILL.md",
                        file_ref=AgentStubDriveFileRef(kind="tool_file", id="tool-file-1"),
                    )
                ]
            ),
        )
        assert response.items[0].value_owned_by_drive is True

    asyncio.run(scenario())


def test_dify_api_agent_stub_drive_handler_rejects_missing_agent_id() -> None:
    drive_handler = DifyApiAgentStubDriveRequestHandler(
        inner_api_url="https://api.example.com",
        inner_api_key="inner-secret",
    )
    principal = _principal()
    principal.execution_context = principal.execution_context.model_copy(update={"agent_id": None})

    async def scenario() -> None:
        try:
            await drive_handler.get_manifest(principal=principal, prefix="", include_download_url=False)
        except AgentStubDriveRequestError as exc:
            assert exc.status_code == 400
            assert "agent_id" in str(exc)
        else:
            raise AssertionError("expected AgentStubDriveRequestError")

    asyncio.run(scenario())


def test_dify_api_agent_stub_drive_handler_rejects_missing_user_id_for_commit() -> None:
    drive_handler = DifyApiAgentStubDriveRequestHandler(
        inner_api_url="https://api.example.com",
        inner_api_key="inner-secret",
    )
    principal = _principal()
    principal.execution_context = principal.execution_context.model_copy(update={"user_id": None})

    async def scenario() -> None:
        try:
            await drive_handler.commit(
                principal=principal,
                request=AgentStubDriveCommitRequest(
                    items=[
                        AgentStubDriveCommitItem(
                            key="skills/example/SKILL.md",
                            file_ref=AgentStubDriveFileRef(kind="tool_file", id="tool-file-1"),
                        )
                    ]
                ),
            )
        except AgentStubDriveRequestError as exc:
            assert exc.status_code == 400
            assert "user_id" in str(exc)
        else:
            raise AssertionError("expected AgentStubDriveRequestError")

    asyncio.run(scenario())


def test_dify_api_agent_stub_drive_handler_maps_invalid_json_response(monkeypatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="not-json", headers={"Content-Type": "application/json"})

    _patch_async_client(monkeypatch, handler)
    drive_handler = DifyApiAgentStubDriveRequestHandler(
        inner_api_url="https://api.example.com",
        inner_api_key="inner-secret",
    )

    async def scenario() -> None:
        try:
            await drive_handler.get_manifest(principal=_principal(), prefix="skills/", include_download_url=False)
        except AgentStubDriveRequestError as exc:
            assert exc.status_code == 502
            assert exc.detail == "Dify API drive request returned invalid JSON"
        else:
            raise AssertionError("expected AgentStubDriveRequestError")

    asyncio.run(scenario())


def test_dify_api_agent_stub_drive_handler_rejects_malformed_success_payload(monkeypatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unexpected": []})

    _patch_async_client(monkeypatch, handler)
    drive_handler = DifyApiAgentStubDriveRequestHandler(
        inner_api_url="https://api.example.com",
        inner_api_key="inner-secret",
    )

    async def scenario() -> None:
        try:
            await drive_handler.get_manifest(principal=_principal(), prefix="skills/", include_download_url=False)
        except AgentStubDriveRequestError as exc:
            assert exc.status_code == 502
            assert exc.detail == "Dify API drive manifest response is invalid"
        else:
            raise AssertionError("expected AgentStubDriveRequestError")

    asyncio.run(scenario())


def test_dify_api_agent_stub_drive_handler_preserves_non_2xx_detail(monkeypatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"code": "source_not_found", "message": "missing file"})

    _patch_async_client(monkeypatch, handler)
    drive_handler = DifyApiAgentStubDriveRequestHandler(
        inner_api_url="https://api.example.com",
        inner_api_key="inner-secret",
    )

    async def scenario() -> None:
        try:
            await drive_handler.commit(
                principal=_principal(),
                request=AgentStubDriveCommitRequest(
                    items=[
                        AgentStubDriveCommitItem(
                            key="skills/example/SKILL.md",
                            file_ref=AgentStubDriveFileRef(kind="tool_file", id="tool-file-1"),
                        )
                    ]
                ),
            )
        except AgentStubDriveRequestError as exc:
            assert exc.status_code == 404
            assert exc.detail == {"code": "source_not_found", "message": "missing file"}
        else:
            raise AssertionError("expected AgentStubDriveRequestError")

    asyncio.run(scenario())
