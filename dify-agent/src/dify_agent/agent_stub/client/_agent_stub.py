"""Transport-dispatch facade for Agent Stub control-plane calls."""

from __future__ import annotations

import httpx
from pydantic import JsonValue

from dify_agent.agent_stub.client._agent_stub_http import (
    connect_agent_stub_http_sync,
    download_file_bytes_from_signed_url_sync,
    request_agent_stub_config_env_update_http_sync,
    request_agent_stub_config_file_pull_http_sync,
    request_agent_stub_config_manifest_http_sync,
    request_agent_stub_config_note_update_http_sync,
    request_agent_stub_config_push_http_sync,
    request_agent_stub_config_skill_inspect_http_sync,
    request_agent_stub_config_skill_pull_http_sync,
    request_agent_stub_drive_commit_http_sync,
    request_agent_stub_drive_manifest_http_sync,
    request_agent_stub_file_download_http_sync,
    request_agent_stub_file_upload_http_sync,
    upload_file_to_signed_url_sync,
)
from dify_agent.agent_stub.client._errors import AgentStubValidationError
from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubConfigPushRequest,
    AgentStubDriveCommitRequest,
    parse_agent_stub_endpoint,
    AgentStubFileMapping,
)


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


def request_agent_stub_drive_manifest_sync(
    *,
    url: str,
    auth_jwe: str,
    prefix: str,
    include_download_url: bool,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
):
    """Request one drive manifest through the HTTP Agent Stub transport.

    Drive operations are intentionally HTTP-only in this stage. Callers must
    provide an ``http://`` or ``https://`` Agent Stub URL; ``grpc://`` endpoints
    raise ``AgentStubValidationError`` instead of attempting transport fallback.
    """
    endpoint = _parse_endpoint(url)
    if endpoint.is_grpc:
        raise AgentStubValidationError("Agent Stub drive operations require an HTTP Agent Stub URL")
    return request_agent_stub_drive_manifest_http_sync(
        base_url=endpoint.url,
        auth_jwe=auth_jwe,
        prefix=prefix,
        include_download_url=include_download_url,
        timeout=timeout,
        sync_http_client=sync_http_client,
    )


def request_agent_stub_drive_commit_sync(
    *,
    url: str,
    auth_jwe: str,
    request: AgentStubDriveCommitRequest,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
):
    """Commit one drive batch through the HTTP Agent Stub transport.

    Drive operations are intentionally HTTP-only in this stage. Callers must
    provide an ``http://`` or ``https://`` Agent Stub URL; ``grpc://`` endpoints
    raise ``AgentStubValidationError`` instead of attempting transport fallback.
    """
    endpoint = _parse_endpoint(url)
    if endpoint.is_grpc:
        raise AgentStubValidationError("Agent Stub drive operations require an HTTP Agent Stub URL")
    return request_agent_stub_drive_commit_http_sync(
        base_url=endpoint.url,
        auth_jwe=auth_jwe,
        request=request,
        timeout=timeout,
        sync_http_client=sync_http_client,
    )


def request_agent_stub_config_manifest_sync(
    *,
    url: str,
    auth_jwe: str,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
):
    """Fetch the current config manifest through the HTTP Agent Stub transport.

    Config operations are HTTP-only in this stage. ``grpc://`` endpoints raise
    ``AgentStubValidationError`` instead of attempting transport fallback.
    """
    endpoint = _parse_endpoint(url)
    if endpoint.is_grpc:
        raise AgentStubValidationError("Agent Stub config operations require an HTTP Agent Stub URL")
    return request_agent_stub_config_manifest_http_sync(
        base_url=endpoint.url,
        auth_jwe=auth_jwe,
        timeout=timeout,
        sync_http_client=sync_http_client,
    )


def request_agent_stub_config_skill_pull_sync(
    *,
    url: str,
    auth_jwe: str,
    name: str,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
):
    """Download one config skill archive through the HTTP Agent Stub transport."""
    endpoint = _parse_endpoint(url)
    if endpoint.is_grpc:
        raise AgentStubValidationError("Agent Stub config operations require an HTTP Agent Stub URL")
    return request_agent_stub_config_skill_pull_http_sync(
        base_url=endpoint.url,
        auth_jwe=auth_jwe,
        name=name,
        timeout=timeout,
        sync_http_client=sync_http_client,
    )


def request_agent_stub_config_skill_inspect_sync(
    *,
    url: str,
    auth_jwe: str,
    name: str,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
):
    """Fetch one config skill inspect view through the HTTP Agent Stub transport."""
    endpoint = _parse_endpoint(url)
    if endpoint.is_grpc:
        raise AgentStubValidationError("Agent Stub config operations require an HTTP Agent Stub URL")
    return request_agent_stub_config_skill_inspect_http_sync(
        base_url=endpoint.url,
        auth_jwe=auth_jwe,
        name=name,
        timeout=timeout,
        sync_http_client=sync_http_client,
    )


def request_agent_stub_config_file_pull_sync(
    *,
    url: str,
    auth_jwe: str,
    name: str,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
):
    """Download one config file payload through the HTTP Agent Stub transport."""
    endpoint = _parse_endpoint(url)
    if endpoint.is_grpc:
        raise AgentStubValidationError("Agent Stub config operations require an HTTP Agent Stub URL")
    return request_agent_stub_config_file_pull_http_sync(
        base_url=endpoint.url,
        auth_jwe=auth_jwe,
        name=name,
        timeout=timeout,
        sync_http_client=sync_http_client,
    )


def request_agent_stub_config_push_sync(
    *,
    url: str,
    auth_jwe: str,
    request: AgentStubConfigPushRequest,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
):
    """Push config file/skill/env/note mutations through the HTTP transport."""
    endpoint = _parse_endpoint(url)
    if endpoint.is_grpc:
        raise AgentStubValidationError("Agent Stub config operations require an HTTP Agent Stub URL")
    return request_agent_stub_config_push_http_sync(
        base_url=endpoint.url,
        auth_jwe=auth_jwe,
        request=request,
        timeout=timeout,
        sync_http_client=sync_http_client,
    )


def request_agent_stub_config_env_update_sync(
    *,
    url: str,
    auth_jwe: str,
    env_text: str,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
):
    """Set or delete config env entries through the HTTP transport."""
    endpoint = _parse_endpoint(url)
    if endpoint.is_grpc:
        raise AgentStubValidationError("Agent Stub config operations require an HTTP Agent Stub URL")
    return request_agent_stub_config_env_update_http_sync(
        base_url=endpoint.url,
        auth_jwe=auth_jwe,
        env_text=env_text,
        timeout=timeout,
        sync_http_client=sync_http_client,
    )


def request_agent_stub_config_note_update_sync(
    *,
    url: str,
    auth_jwe: str,
    note: str,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
):
    """Update the config note text through the HTTP Agent Stub transport."""
    endpoint = _parse_endpoint(url)
    if endpoint.is_grpc:
        raise AgentStubValidationError("Agent Stub config operations require an HTTP Agent Stub URL")
    return request_agent_stub_config_note_update_http_sync(
        base_url=endpoint.url,
        auth_jwe=auth_jwe,
        note=note,
        timeout=timeout,
        sync_http_client=sync_http_client,
    )


def _parse_endpoint(url: str):
    """Normalize one Agent Stub base URL and map parse failures to client errors."""
    try:
        return parse_agent_stub_endpoint(url)
    except ValueError as exc:
        raise AgentStubValidationError("invalid Agent Stub base URL") from exc


__all__ = [
    "connect_agent_stub_sync",
    "download_file_bytes_from_signed_url_sync",
    "request_agent_stub_config_env_update_sync",
    "request_agent_stub_config_file_pull_sync",
    "request_agent_stub_config_manifest_sync",
    "request_agent_stub_config_note_update_sync",
    "request_agent_stub_config_push_sync",
    "request_agent_stub_config_skill_inspect_sync",
    "request_agent_stub_config_skill_pull_sync",
    "request_agent_stub_drive_commit_sync",
    "request_agent_stub_drive_manifest_sync",
    "request_agent_stub_file_download_sync",
    "request_agent_stub_file_upload_sync",
    "upload_file_to_signed_url_sync",
]
