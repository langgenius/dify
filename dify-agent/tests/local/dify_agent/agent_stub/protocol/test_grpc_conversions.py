from __future__ import annotations

import base64
import json

import pytest

pytest.importorskip("google.protobuf")

from dify_agent.agent_stub.grpc._generated import agent_stub_pb2
from dify_agent.agent_stub.grpc.conversions import (
    connect_request_from_proto,
    connect_response_from_proto,
    file_download_request_from_proto,
    proto_connect_request,
    proto_file_download_request,
    proto_file_download_response,
)
from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubConnectResponse,
    AgentStubFileDownloadResponse,
    AgentStubFileMapping,
)


def _reference(record_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"record_id": record_id}, separators=(",", ":")).encode()).decode()
    return f"dify-file-ref:{payload}"


def test_connect_request_from_proto_round_trips_metadata_json() -> None:
    message = proto_connect_request(
        agent_stub_pb2,
        argv=["connect", "--", "echo", "hello"],
        metadata={"source": "cli"},
    )

    request = connect_request_from_proto(message)

    assert request.argv == ["connect", "--", "echo", "hello"]
    assert request.metadata == {"source": "cli"}


def test_file_download_request_from_proto_respects_optional_reference() -> None:
    message = agent_stub_pb2.FileDownloadRequest(
        file=agent_stub_pb2.FileMapping(
            transfer_method="tool_file",
            reference=_reference("tool-file-1"),
        )
    )

    request = file_download_request_from_proto(message)

    assert request.file.reference == _reference("tool-file-1")
    assert request.file.url is None
    assert request.for_external is True


def test_file_download_request_from_proto_preserves_explicit_internal_audience() -> None:
    message = agent_stub_pb2.FileDownloadRequest(
        file=agent_stub_pb2.FileMapping(
            transfer_method="tool_file",
            reference=_reference("tool-file-1"),
        ),
        for_external=False,
    )

    request = file_download_request_from_proto(message)

    assert request.for_external is False


def test_proto_file_download_request_preserves_selected_audience() -> None:
    message = proto_file_download_request(
        agent_stub_pb2,
        file=AgentStubFileMapping(transfer_method="tool_file", reference=_reference("tool-file-1")),
        for_external=False,
    )

    assert message.HasField("for_external") is True
    assert message.for_external is False


def test_connect_request_from_proto_rejects_invalid_metadata_json() -> None:
    with pytest.raises(json.JSONDecodeError):
        _ = connect_request_from_proto(
            agent_stub_pb2.ConnectRequest(protocol_version=1, argv=["connect"], metadata_json="not-json")
        )


def test_proto_responses_preserve_optional_fields() -> None:
    message = proto_file_download_response(
        AgentStubFileDownloadResponse(
            filename="report.pdf",
            mime_type="application/pdf",
            size=123,
            download_url="https://files.example.com/download",
        )
    )

    assert message.HasField("mime_type") is True
    assert (
        connect_response_from_proto(
            agent_stub_pb2.ConnectResponse(
                **AgentStubConnectResponse(connection_id="conn-1", status="connected").model_dump()
            )
        ).connection_id
        == "conn-1"
    )
