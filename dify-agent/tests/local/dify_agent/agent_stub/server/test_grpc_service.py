from __future__ import annotations

import base64
import json
import secrets
from types import SimpleNamespace
from typing import cast

import pytest

pytest.importorskip("grpclib")
pytest.importorskip("google.protobuf")

from grpclib.const import Status
from grpclib.exceptions import GRPCError

from dify_agent.agent_stub.grpc._generated import agent_stub_pb2
from dify_agent.agent_stub.server.agent_stub_files import AgentStubFileRequestError, AgentStubFileRequestHandler
from dify_agent.agent_stub.server.control_plane import AgentStubControlPlaneService
from dify_agent.agent_stub.server.grpc_service import AgentStubGRPCTransport
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubTokenCodec
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


def _base64url_secret(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _token_codec() -> AgentStubTokenCodec:
    return AgentStubTokenCodec.from_server_secret(_base64url_secret(secrets.token_bytes(32)))


def _execution_context() -> DifyExecutionContextLayerConfig:
    return DifyExecutionContextLayerConfig(
        tenant_id="tenant-1",
        user_id="user-1",
        user_from="account",
        agent_mode="workflow_run",
        invoke_from="service-api",
    )


def _reference(record_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"record_id": record_id}, separators=(",", ":")).encode()).decode()
    return f"dify-file-ref:{payload}"


def test_agent_stub_grpc_transport_connects_with_bearer_metadata() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context())
    transport = AgentStubGRPCTransport(
        AgentStubControlPlaneService(
            codec,
            connection_id_factory=lambda: "conn-1",
        )
    )

    async def scenario() -> None:
        response = await transport.connect(
            request=agent_stub_pb2.ConnectRequest(
                protocol_version=1,
                argv=["connect"],
                metadata_json='{"source":"cli"}',
            ),
            metadata=(("authorization", f"Bearer {token}"),),
        )
        assert response.connection_id == "conn-1"
        assert response.status == "connected"

    import asyncio

    asyncio.run(scenario())


def test_agent_stub_grpc_transport_maps_missing_authorization_to_unauthenticated() -> None:
    codec = _token_codec()
    transport = AgentStubGRPCTransport(AgentStubControlPlaneService(codec))

    async def scenario() -> None:
        with pytest.raises(GRPCError) as exc_info:
            await transport.connect(
                request=agent_stub_pb2.ConnectRequest(protocol_version=1, argv=["connect"], metadata_json="{}"),
                metadata=(),
            )
        assert exc_info.value.status == Status.UNAUTHENTICATED

    import asyncio

    asyncio.run(scenario())


def test_agent_stub_grpc_transport_delegates_file_upload_requests() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context())

    class FakeHandler:
        async def create_upload_request(self, *, principal, request):
            assert principal.execution_context.tenant_id == "tenant-1"
            assert request.filename == "report.pdf"
            return type("Response", (), {"upload_url": "https://files.example.com/upload"})()

        async def create_download_request(self, *, principal, request):
            del principal, request
            raise AssertionError("unexpected download request")

    transport = AgentStubGRPCTransport(
        AgentStubControlPlaneService(
            codec,
            cast(AgentStubFileRequestHandler, cast(object, FakeHandler())),
        )
    )

    async def scenario() -> None:
        response = await transport.create_file_upload_request(
            request=agent_stub_pb2.FileUploadRequest(filename="report.pdf", mimetype="application/pdf"),
            metadata=(("authorization", f"Bearer {token}"),),
        )
        assert response.upload_url == "https://files.example.com/upload"

    import asyncio

    asyncio.run(scenario())


def test_agent_stub_grpc_transport_delegates_file_download_requests() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context())

    class FakeHandler:
        async def create_download_request(self, *, principal, request):
            assert principal.execution_context.user_id == "user-1"
            assert request.file.reference == _reference("tool-file-1")
            assert request.for_external is False
            return type(
                "Response",
                (),
                {
                    "filename": "report.pdf",
                    "mime_type": "application/pdf",
                    "size": 123,
                    "download_url": "https://files.example.com/download",
                },
            )()

        async def create_upload_request(self, *, principal, request):
            del principal, request
            raise AssertionError("unexpected upload request")

    transport = AgentStubGRPCTransport(
        AgentStubControlPlaneService(
            codec,
            cast(AgentStubFileRequestHandler, cast(object, FakeHandler())),
        )
    )

    async def scenario() -> None:
        response = await transport.create_file_download_request(
            request=agent_stub_pb2.FileDownloadRequest(
                file=agent_stub_pb2.FileMapping(
                    transfer_method="tool_file",
                    reference=_reference("tool-file-1"),
                ),
                for_external=False,
            ),
            metadata=(("authorization", f"Bearer {token}"),),
        )
        assert response.download_url == "https://files.example.com/download"

    import asyncio

    asyncio.run(scenario())


def test_agent_stub_grpc_transport_stringifies_structured_file_error_details() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context())

    class FakeHandler:
        async def create_upload_request(self, *, principal, request):
            del principal, request
            raise AgentStubFileRequestError(400, {"detail": "bad request", "code": "inner_api_error"})

        async def create_download_request(self, *, principal, request):
            del principal, request
            raise AssertionError("unexpected download request")

    transport = AgentStubGRPCTransport(
        AgentStubControlPlaneService(
            codec,
            cast(AgentStubFileRequestHandler, cast(object, FakeHandler())),
        )
    )

    async def scenario() -> None:
        with pytest.raises(GRPCError) as exc_info:
            await transport.create_file_upload_request(
                request=agent_stub_pb2.FileUploadRequest(filename="report.pdf", mimetype="application/pdf"),
                metadata=(("authorization", f"Bearer {token}"),),
            )
        assert exc_info.value.status == Status.FAILED_PRECONDITION
        assert isinstance(exc_info.value.message, str)
        assert "bad request" in exc_info.value.message
        assert "inner_api_error" in exc_info.value.message

    import asyncio

    asyncio.run(scenario())


def test_agent_stub_grpc_transport_maps_missing_token_codec_to_unavailable() -> None:
    transport = AgentStubGRPCTransport(AgentStubControlPlaneService(None))

    async def scenario() -> None:
        with pytest.raises(GRPCError) as exc_info:
            await transport.connect(
                request=agent_stub_pb2.ConnectRequest(protocol_version=1, argv=["connect"], metadata_json="{}"),
                metadata=(("authorization", "Bearer token"),),
            )
        assert exc_info.value.status == Status.UNAVAILABLE

    import asyncio

    asyncio.run(scenario())


def test_agent_stub_grpc_transport_maps_missing_file_handler_to_unavailable() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context())
    transport = AgentStubGRPCTransport(AgentStubControlPlaneService(codec, None))

    async def scenario() -> None:
        with pytest.raises(GRPCError) as exc_info:
            await transport.create_file_upload_request(
                request=agent_stub_pb2.FileUploadRequest(filename="report.pdf", mimetype="application/pdf"),
                metadata=(("authorization", f"Bearer {token}"),),
            )
        assert exc_info.value.status == Status.UNAVAILABLE

    import asyncio

    asyncio.run(scenario())


def test_agent_stub_grpc_transport_maps_invalid_upload_request_to_invalid_argument() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context())
    transport = AgentStubGRPCTransport(AgentStubControlPlaneService(codec))

    async def scenario() -> None:
        with pytest.raises(GRPCError) as exc_info:
            await transport.create_file_upload_request(
                request=SimpleNamespace(filename=None, mimetype="application/pdf"),
                metadata=(("authorization", f"Bearer {token}"),),
            )
        assert exc_info.value.status == Status.INVALID_ARGUMENT

    import asyncio

    asyncio.run(scenario())


def test_agent_stub_grpc_transport_maps_invalid_download_request_to_invalid_argument() -> None:
    codec = _token_codec()
    token = codec.encode_connection_token(_execution_context())
    transport = AgentStubGRPCTransport(AgentStubControlPlaneService(codec))

    async def scenario() -> None:
        with pytest.raises(GRPCError) as exc_info:
            await transport.create_file_download_request(
                request=agent_stub_pb2.FileDownloadRequest(
                    file=agent_stub_pb2.FileMapping(transfer_method="tool_file")
                ),
                metadata=(("authorization", f"Bearer {token}"),),
            )
        assert exc_info.value.status == Status.INVALID_ARGUMENT

    import asyncio

    asyncio.run(scenario())
