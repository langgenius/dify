from __future__ import annotations

import base64
import builtins
import json
from types import SimpleNamespace

import httpx
import pytest

from dify_agent.agent_stub.client._agent_stub import (
    connect_agent_stub_sync,
    download_file_bytes_from_signed_url_sync,
    request_agent_stub_file_download_sync,
    request_agent_stub_file_upload_sync,
    upload_file_to_signed_url_sync,
)
from dify_agent.agent_stub.client._errors import (
    AgentStubClientError,
    AgentStubGRPCError,
    AgentStubHTTPError,
    AgentStubMissingGRPCDependencyError,
    AgentStubTransferError,
    AgentStubValidationError,
)
from dify_agent.agent_stub.protocol.agent_stub import AgentStubFileMapping


def _reference(record_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"record_id": record_id}, separators=(",", ":")).encode()).decode()
    return f"dify-file-ref:{payload}"


def test_connect_agent_stub_sync_posts_connections_request_with_authorization() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == "https://agent.example.com/agent-stub/connections"
        assert request.headers["Authorization"] == "Bearer test-jwe"
        assert json.loads(request.content) == {
            "protocol_version": 1,
            "argv": ["connect", "--", "echo", "hello"],
            "metadata": {},
        }
        return httpx.Response(200, json={"connection_id": "conn-1", "status": "connected"})

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        response = connect_agent_stub_sync(
            url="https://agent.example.com/agent-stub/",
            auth_jwe="test-jwe",
            argv=["connect", "--", "echo", "hello"],
            sync_http_client=http_client,
        )
    finally:
        http_client.close()

    assert response.connection_id == "conn-1"
    assert response.status == "connected"


def test_connect_agent_stub_sync_rejects_invalid_base_url() -> None:
    with pytest.raises(AgentStubValidationError, match="invalid DIFY_AGENT_STUB_URL|invalid Agent Stub base URL"):
        _ = connect_agent_stub_sync(
            url="https://agent.example.com/agent-stub?x=1",
            auth_jwe="test-jwe",
            argv=["connect"],
        )


def test_connect_agent_stub_sync_maps_non_2xx_response_to_http_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"detail": "invalid token"})

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(AgentStubHTTPError, match="401") as exc_info:
            _ = connect_agent_stub_sync(
                url="https://agent.example.com/agent-stub",
                auth_jwe="test-jwe",
                argv=["connect"],
                sync_http_client=http_client,
            )
    finally:
        http_client.close()

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "invalid token"


def test_connect_agent_stub_sync_maps_malformed_json_response_to_client_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="not-json", headers={"Content-Type": "application/json"})

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(AgentStubClientError, match="invalid JSON"):
            _ = connect_agent_stub_sync(
                url="https://agent.example.com/agent-stub",
                auth_jwe="test-jwe",
                argv=["connect"],
                sync_http_client=http_client,
            )
    finally:
        http_client.close()


def test_connect_agent_stub_sync_maps_schema_invalid_success_payload_to_validation_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"connection_id": 123, "status": "unexpected"})

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(AgentStubValidationError, match="invalid Agent Stub connection response"):
            _ = connect_agent_stub_sync(
                url="https://agent.example.com/agent-stub",
                auth_jwe="test-jwe",
                argv=["connect"],
                sync_http_client=http_client,
            )
    finally:
        http_client.close()


def test_request_agent_stub_file_upload_sync_posts_upload_request() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == "https://agent.example.com/agent-stub/files/upload-request"
        assert json.loads(request.content) == {"filename": "report.pdf", "mimetype": "application/pdf"}
        return httpx.Response(200, json={"upload_url": "https://files.example.com/upload"})

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        response = request_agent_stub_file_upload_sync(
            url="https://agent.example.com/agent-stub",
            auth_jwe="test-jwe",
            filename="report.pdf",
            mimetype="application/pdf",
            sync_http_client=http_client,
        )
    finally:
        http_client.close()

    assert response.upload_url == "https://files.example.com/upload"


def test_request_agent_stub_file_download_sync_posts_download_request() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == "https://agent.example.com/agent-stub/files/download-request"
        assert json.loads(request.content) == {
            "file": {"transfer_method": "tool_file", "reference": _reference("tool-file-1")}
        }
        return httpx.Response(
            200,
            json={
                "filename": "report.pdf",
                "mime_type": "application/pdf",
                "size": 123,
                "download_url": "https://files.example.com/download",
            },
        )

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        response = request_agent_stub_file_download_sync(
            url="https://agent.example.com/agent-stub",
            auth_jwe="test-jwe",
            file=AgentStubFileMapping(transfer_method="tool_file", reference=_reference("tool-file-1")),
            sync_http_client=http_client,
        )
    finally:
        http_client.close()

    assert response.download_url == "https://files.example.com/download"


def test_upload_file_to_signed_url_sync_posts_multipart_file() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == "https://files.example.com/upload"
        assert b"report.pdf" in request.content
        return httpx.Response(201, json={"id": "tool-file-1", "name": "report.pdf", "size": 9})

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        from io import BytesIO

        payload = upload_file_to_signed_url_sync(
            upload_url="https://files.example.com/upload",
            filename="report.pdf",
            file_obj=BytesIO(b"contents!"),
            mimetype="application/pdf",
            sync_http_client=http_client,
        )
    finally:
        http_client.close()

    assert payload["id"] == "tool-file-1"


def test_download_file_bytes_from_signed_url_sync_returns_bytes() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"payload")

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        payload = download_file_bytes_from_signed_url_sync(
            download_url="https://files.example.com/download",
            sync_http_client=http_client,
        )
    finally:
        http_client.close()

    assert payload == b"payload"


def test_download_file_bytes_from_signed_url_sync_maps_timeout_to_transfer_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("boom")

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(AgentStubTransferError, match="download timed out"):
            _ = download_file_bytes_from_signed_url_sync(
                download_url="https://files.example.com/download",
                sync_http_client=http_client,
            )
    finally:
        http_client.close()


def test_connect_agent_stub_sync_dispatches_grpc_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        "dify_agent.agent_stub.client._agent_stub_grpc.connect_agent_stub_grpc_sync",
        lambda **kwargs: (
            captured.update(kwargs) or type("Response", (), {"connection_id": "conn-1", "status": "connected"})()
        ),
    )

    response = connect_agent_stub_sync(url="grpc://agent.example.com:9091", auth_jwe="token", argv=["connect"])

    assert captured["url"] == "grpc://agent.example.com:9091"
    assert response.connection_id == "conn-1"


def test_connect_agent_stub_sync_reports_missing_grpc_dependencies(monkeypatch: pytest.MonkeyPatch) -> None:
    original_import = builtins.__import__

    def fake_import(name: str, globals=None, locals=None, fromlist=(), level: int = 0):
        if name in {"grpclib.client", "grpclib.exceptions"}:
            raise ImportError("grpclib is not installed")
        return original_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    with pytest.raises(AgentStubMissingGRPCDependencyError, match=r"optional dify-agent\[grpc\] dependencies"):
        _ = connect_agent_stub_sync(url="grpc://agent.example.com:9091", auth_jwe="token", argv=["connect"])


def test_request_agent_stub_file_upload_sync_dispatches_grpc_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        "dify_agent.agent_stub.client._agent_stub_grpc.request_agent_stub_file_upload_grpc_sync",
        lambda **kwargs: (
            captured.update(kwargs) or type("Response", (), {"upload_url": "https://files.example.com/upload"})()
        ),
    )

    response = request_agent_stub_file_upload_sync(
        url="grpc://agent.example.com:9091",
        auth_jwe="token",
        filename="report.pdf",
        mimetype="application/pdf",
    )

    assert captured == {
        "url": "grpc://agent.example.com:9091",
        "auth_jwe": "token",
        "filename": "report.pdf",
        "mimetype": "application/pdf",
        "timeout": 30.0,
    }
    assert response.upload_url == "https://files.example.com/upload"


def test_request_agent_stub_file_download_sync_dispatches_grpc_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}
    file_mapping = AgentStubFileMapping(transfer_method="tool_file", reference=_reference("tool-file-1"))

    monkeypatch.setattr(
        "dify_agent.agent_stub.client._agent_stub_grpc.request_agent_stub_file_download_grpc_sync",
        lambda **kwargs: (
            captured.update(kwargs)
            or type(
                "Response",
                (),
                {
                    "filename": "report.pdf",
                    "mime_type": "application/pdf",
                    "size": 123,
                    "download_url": "https://files.example.com/download",
                },
            )()
        ),
    )

    response = request_agent_stub_file_download_sync(
        url="grpc://agent.example.com:9091",
        auth_jwe="token",
        file=file_mapping,
    )

    assert captured == {
        "url": "grpc://agent.example.com:9091",
        "auth_jwe": "token",
        "file": file_mapping,
        "timeout": 30.0,
    }
    assert response.download_url == "https://files.example.com/download"


def test_request_agent_stub_file_upload_grpc_sync_attaches_bearer_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    import dify_agent.agent_stub.client._agent_stub_grpc as grpc_module

    captured: dict[str, object] = {}

    class FakeChannel:
        def __init__(self, *, host: str, port: int, ssl: bool) -> None:
            captured.update(host=host, port=port, ssl=ssl)

        def close(self) -> None:
            captured["closed"] = True

    class FakeMethod:
        async def __call__(self, request, *, metadata, timeout):
            captured.update(request=request, metadata=metadata, timeout=timeout)
            return {"upload_url": "https://files.example.com/upload"}

    class FakeStub:
        def __init__(self, channel) -> None:
            captured["channel"] = channel
            self.CreateFileUploadRequest = FakeMethod()

    class FakeGRPCError(Exception):
        def __init__(self, status, message: str) -> None:
            self.status = status
            self.message = message
            super().__init__(message)

    class FakeStreamTerminatedError(Exception):
        pass

    monkeypatch.setattr(
        grpc_module,
        "_require_runtime",
        lambda: SimpleNamespace(
            Channel=FakeChannel,
            AgentStubServiceStub=FakeStub,
            agent_stub_pb2=object(),
            GRPCError=FakeGRPCError,
            StreamTerminatedError=FakeStreamTerminatedError,
        ),
    )
    monkeypatch.setattr(
        grpc_module,
        "_require_conversions",
        lambda: SimpleNamespace(
            proto_file_upload_request=lambda _pb2, *, filename, mimetype: {
                "filename": filename,
                "mimetype": mimetype,
            },
            file_upload_response_from_proto=lambda response: type(
                "Response",
                (),
                {"upload_url": response["upload_url"]},
            )(),
        ),
    )

    response = grpc_module.request_agent_stub_file_upload_grpc_sync(
        url="grpc://agent.example.com:9091",
        auth_jwe="test-jwe",
        filename="report.pdf",
        mimetype="application/pdf",
        timeout=12.0,
    )

    assert captured["host"] == "agent.example.com"
    assert captured["port"] == 9091
    assert captured["ssl"] is False
    assert captured["request"] == {"filename": "report.pdf", "mimetype": "application/pdf"}
    assert captured["metadata"] == (("authorization", "Bearer test-jwe"),)
    assert captured["timeout"] == 12.0
    assert captured["closed"] is True
    assert response.upload_url == "https://files.example.com/upload"


def test_request_agent_stub_file_download_grpc_sync_maps_grpc_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    import dify_agent.agent_stub.client._agent_stub_grpc as grpc_module

    class FakeChannel:
        def __init__(self, *, host: str, port: int, ssl: bool) -> None:
            del host, port, ssl

        def close(self) -> None:
            return None

    class FakeMethod:
        async def __call__(self, request, *, metadata, timeout):
            del request, metadata, timeout
            raise FakeGRPCError(SimpleNamespace(name="RESOURCE_EXHAUSTED"), "rate limited")

    class FakeStub:
        def __init__(self, channel) -> None:
            del channel
            self.CreateFileDownloadRequest = FakeMethod()

    class FakeGRPCError(Exception):
        def __init__(self, status, message: str) -> None:
            self.status = status
            self.message = message
            super().__init__(message)

    class FakeStreamTerminatedError(Exception):
        pass

    monkeypatch.setattr(
        grpc_module,
        "_require_runtime",
        lambda: SimpleNamespace(
            Channel=FakeChannel,
            AgentStubServiceStub=FakeStub,
            agent_stub_pb2=object(),
            GRPCError=FakeGRPCError,
            StreamTerminatedError=FakeStreamTerminatedError,
        ),
    )
    monkeypatch.setattr(
        grpc_module,
        "_require_conversions",
        lambda: SimpleNamespace(
            proto_file_download_request=lambda _pb2, *, file: {"file": file},
            file_download_response_from_proto=lambda response: response,
        ),
    )

    with pytest.raises(AgentStubGRPCError, match="RESOURCE_EXHAUSTED") as exc_info:
        _ = grpc_module.request_agent_stub_file_download_grpc_sync(
            url="grpc://agent.example.com:9091",
            auth_jwe="test-jwe",
            file=AgentStubFileMapping(transfer_method="tool_file", reference=_reference("tool-file-1")),
        )

    assert exc_info.value.status == "RESOURCE_EXHAUSTED"
    assert exc_info.value.detail == "rate limited"
