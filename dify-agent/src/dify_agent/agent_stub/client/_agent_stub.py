"""Transport-dispatch facade for Agent Stub control-plane calls."""

from __future__ import annotations

import httpx
from pydantic import JsonValue

from dify_agent.agent_stub.client._agent_stub_http import (
    connect_agent_stub_http_sync,
    download_file_bytes_from_signed_url_sync,
    request_agent_stub_file_download_http_sync,
    request_agent_stub_file_upload_http_sync,
    upload_file_to_signed_url_sync,
)
from dify_agent.agent_stub.client._errors import AgentStubValidationError
from dify_agent.agent_stub.protocol.agent_stub import AgentStubFileMapping, parse_agent_stub_endpoint


def connect_agent_stub_sync(
    *,
    url: str,
    auth_jwe: str,
    argv: list[str],
    metadata: dict[str, JsonValue] | None = None,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
):
    """Connect through HTTP or gRPC based on the configured Agent Stub URL."""
    endpoint = _parse_endpoint(url)
    if endpoint.is_grpc:
        from dify_agent.agent_stub.client._agent_stub_grpc import connect_agent_stub_grpc_sync

        return connect_agent_stub_grpc_sync(
            url=endpoint.url,
            auth_jwe=auth_jwe,
            argv=argv,
            metadata=metadata,
            timeout=timeout,
        )
    return connect_agent_stub_http_sync(
        base_url=endpoint.url,
        auth_jwe=auth_jwe,
        argv=argv,
        metadata=metadata,
        timeout=timeout,
        sync_http_client=sync_http_client,
    )


def request_agent_stub_file_upload_sync(
    *,
    url: str,
    auth_jwe: str,
    filename: str,
    mimetype: str,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
):
    """Request a signed upload URL through the selected Agent Stub transport."""
    endpoint = _parse_endpoint(url)
    if endpoint.is_grpc:
        from dify_agent.agent_stub.client._agent_stub_grpc import request_agent_stub_file_upload_grpc_sync

        return request_agent_stub_file_upload_grpc_sync(
            url=endpoint.url,
            auth_jwe=auth_jwe,
            filename=filename,
            mimetype=mimetype,
            timeout=timeout,
        )
    return request_agent_stub_file_upload_http_sync(
        base_url=endpoint.url,
        auth_jwe=auth_jwe,
        filename=filename,
        mimetype=mimetype,
        timeout=timeout,
        sync_http_client=sync_http_client,
    )


def request_agent_stub_file_download_sync(
    *,
    url: str,
    auth_jwe: str,
    file: AgentStubFileMapping,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
):
    """Request a signed download URL through the selected Agent Stub transport."""
    endpoint = _parse_endpoint(url)
    if endpoint.is_grpc:
        from dify_agent.agent_stub.client._agent_stub_grpc import request_agent_stub_file_download_grpc_sync

        return request_agent_stub_file_download_grpc_sync(
            url=endpoint.url,
            auth_jwe=auth_jwe,
            file=file,
            timeout=timeout,
        )
    return request_agent_stub_file_download_http_sync(
        base_url=endpoint.url,
        auth_jwe=auth_jwe,
        file=file,
        timeout=timeout,
        sync_http_client=sync_http_client,
    )


def _parse_endpoint(url: str):
    try:
        return parse_agent_stub_endpoint(url)
    except ValueError as exc:
        raise AgentStubValidationError("invalid Agent Stub base URL") from exc


__all__ = [
    "connect_agent_stub_sync",
    "download_file_bytes_from_signed_url_sync",
    "request_agent_stub_file_download_sync",
    "request_agent_stub_file_upload_sync",
    "upload_file_to_signed_url_sync",
]
