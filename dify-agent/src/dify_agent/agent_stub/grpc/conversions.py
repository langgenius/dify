"""Conversions between Agent Stub protobuf messages and public DTOs."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import TYPE_CHECKING

from pydantic import JsonValue

from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubConnectRequest,
    AgentStubConnectResponse,
    AgentStubFileDownloadRequest,
    AgentStubFileDownloadResponse,
    AgentStubFileMapping,
    AgentStubFileUploadRequest,
    AgentStubFileUploadResponse,
)

if TYPE_CHECKING:
    from dify_agent.agent_stub.grpc._generated import agent_stub_pb2


def connect_request_from_proto(message: agent_stub_pb2.ConnectRequest) -> AgentStubConnectRequest:
    """Validate one protobuf connect request into the public DTO."""
    metadata: object = {}
    if message.metadata_json:
        metadata = json.loads(message.metadata_json)
    return AgentStubConnectRequest.model_validate(
        {
            "protocol_version": message.protocol_version,
            "argv": list(message.argv),
            "metadata": metadata,
        }
    )


def proto_connect_request(
    pb2_module,
    *,
    argv: list[str],
    metadata: Mapping[str, JsonValue] | None,
) -> agent_stub_pb2.ConnectRequest:
    """Build one protobuf connect request from public client inputs."""
    request = AgentStubConnectRequest(argv=argv, metadata=dict(metadata or {}))
    return pb2_module.ConnectRequest(
        protocol_version=request.protocol_version,
        argv=request.argv,
        metadata_json=json.dumps(request.metadata, separators=(",", ":")),
    )


def connect_response_from_proto(message: agent_stub_pb2.ConnectResponse) -> AgentStubConnectResponse:
    """Validate one protobuf connect response into the public DTO."""
    return AgentStubConnectResponse.model_validate(
        {
            "connection_id": message.connection_id,
            "status": message.status,
        }
    )


def proto_connect_response(response: AgentStubConnectResponse, *, pb2_module=None) -> agent_stub_pb2.ConnectResponse:
    """Build one protobuf connect response from the public DTO."""
    resolved_pb2 = pb2_module or _require_pb2_module()
    return resolved_pb2.ConnectResponse(connection_id=response.connection_id, status=response.status)


def file_upload_request_from_proto(message: agent_stub_pb2.FileUploadRequest) -> AgentStubFileUploadRequest:
    """Validate one protobuf file-upload request into the public DTO."""
    return AgentStubFileUploadRequest.model_validate({"filename": message.filename, "mimetype": message.mimetype})


def proto_file_upload_request(pb2_module, *, filename: str, mimetype: str) -> agent_stub_pb2.FileUploadRequest:
    """Build one protobuf file-upload request from public client inputs."""
    request = AgentStubFileUploadRequest(filename=filename, mimetype=mimetype)
    return pb2_module.FileUploadRequest(filename=request.filename, mimetype=request.mimetype)


def file_upload_response_from_proto(message: agent_stub_pb2.FileUploadResponse) -> AgentStubFileUploadResponse:
    """Validate one protobuf file-upload response into the public DTO."""
    return AgentStubFileUploadResponse.model_validate({"upload_url": message.upload_url})


def proto_file_upload_response(
    response: AgentStubFileUploadResponse, *, pb2_module=None
) -> agent_stub_pb2.FileUploadResponse:
    """Build one protobuf file-upload response from the public DTO."""
    resolved_pb2 = pb2_module or _require_pb2_module()
    return resolved_pb2.FileUploadResponse(upload_url=response.upload_url)


def file_download_request_from_proto(message: agent_stub_pb2.FileDownloadRequest) -> AgentStubFileDownloadRequest:
    """Validate one protobuf file-download request into the public DTO."""
    file_mapping_kwargs = {
        "transfer_method": message.file.transfer_method,
        "reference": message.file.reference if message.file.HasField("reference") else None,
        "url": message.file.url if message.file.HasField("url") else None,
    }
    return AgentStubFileDownloadRequest.model_validate(
        {
            "file": file_mapping_kwargs,
            "for_external": message.for_external if message.HasField("for_external") else True,
        }
    )


def proto_file_download_request(
    pb2_module,
    *,
    file: AgentStubFileMapping,
    for_external: bool = True,
) -> agent_stub_pb2.FileDownloadRequest:
    """Build one protobuf file-download request from the public DTO."""
    mapping = pb2_module.FileMapping(transfer_method=file.transfer_method)
    if file.reference is not None:
        mapping.reference = file.reference
    if file.url is not None:
        mapping.url = file.url
    request = pb2_module.FileDownloadRequest(file=mapping)
    request.for_external = for_external
    return request


def file_download_response_from_proto(message: agent_stub_pb2.FileDownloadResponse) -> AgentStubFileDownloadResponse:
    """Validate one protobuf file-download response into the public DTO."""
    return AgentStubFileDownloadResponse.model_validate(
        {
            "filename": message.filename,
            "mime_type": message.mime_type if message.HasField("mime_type") else None,
            "size": message.size,
            "download_url": message.download_url,
        }
    )


def proto_file_download_response(
    response: AgentStubFileDownloadResponse,
    *,
    pb2_module=None,
) -> agent_stub_pb2.FileDownloadResponse:
    """Build one protobuf file-download response from the public DTO."""
    resolved_pb2 = pb2_module or _require_pb2_module()
    message = resolved_pb2.FileDownloadResponse(
        filename=response.filename,
        size=response.size,
        download_url=response.download_url,
    )
    if response.mime_type is not None:
        message.mime_type = response.mime_type
    return message


def _require_pb2_module():
    from dify_agent.agent_stub.grpc._generated import agent_stub_pb2

    return agent_stub_pb2


__all__ = [
    "connect_request_from_proto",
    "connect_response_from_proto",
    "file_download_request_from_proto",
    "file_download_response_from_proto",
    "file_upload_request_from_proto",
    "file_upload_response_from_proto",
    "proto_connect_request",
    "proto_connect_response",
    "proto_file_download_request",
    "proto_file_download_response",
    "proto_file_upload_request",
    "proto_file_upload_response",
]
