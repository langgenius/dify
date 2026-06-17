"""Client-safe HTTP helpers for Agent Stub control-plane endpoints.

The main ``Client`` class stays focused on run APIs. Sandbox-visible CLI
commands only need a narrow synchronous subset of the stub server contract and
must stay safe to import in default installations, so these helpers live under
``dify_agent.agent_stub.client`` rather than the standard run client package.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import BinaryIO
from typing import cast

import httpx
from pydantic import BaseModel, JsonValue, ValidationError

from dify_agent.agent_stub.client._errors import (
    AgentStubClientError,
    AgentStubHTTPError,
    AgentStubTransferError,
    AgentStubValidationError,
)
from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubConnectRequest,
    AgentStubConnectResponse,
    AgentStubFileDownloadRequest,
    AgentStubFileDownloadResponse,
    AgentStubFileMapping,
    AgentStubFileUploadRequest,
    AgentStubFileUploadResponse,
    agent_stub_connections_url,
    agent_stub_file_download_request_url,
    agent_stub_file_upload_request_url,
)


def connect_agent_stub_http_sync(
    *,
    base_url: str,
    auth_jwe: str,
    argv: list[str],
    metadata: dict[str, JsonValue] | None = None,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
) -> AgentStubConnectResponse:
    """Create one HTTP Agent Stub connection using the provided bearer JWE.

    Raises:
        AgentStubValidationError: if the base URL is invalid, the request DTO is
            invalid, or the success response body does not match the public
            Agent Stub response schema.
        AgentStubHTTPError: if the server returns a non-2xx HTTP response.
        AgentStubClientError: if the request times out, the transport fails, or
            the response body cannot be parsed as JSON.
    """
    request_model = _validate_request(argv=argv, metadata=metadata)
    response = _post_agent_stub_json(
        base_url=base_url,
        auth_jwe=auth_jwe,
        endpoint_name="connect",
        endpoint_url_factory=agent_stub_connections_url,
        request_body=request_model.model_dump_json(),
        timeout=timeout,
        sync_http_client=sync_http_client,
    )
    return _parse_success_response(response=response, response_model=AgentStubConnectResponse, label="connection")


def request_agent_stub_file_upload_http_sync(
    *,
    base_url: str,
    auth_jwe: str,
    filename: str,
    mimetype: str,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
) -> AgentStubFileUploadResponse:
    """Request one signed upload URL from the HTTP Agent Stub endpoint."""

    try:
        request_model = AgentStubFileUploadRequest(filename=filename, mimetype=mimetype)
    except ValidationError as exc:
        raise AgentStubValidationError("invalid Agent Stub file upload request") from exc
    response = _post_agent_stub_json(
        base_url=base_url,
        auth_jwe=auth_jwe,
        endpoint_name="file upload request",
        endpoint_url_factory=agent_stub_file_upload_request_url,
        request_body=request_model.model_dump_json(),
        timeout=timeout,
        sync_http_client=sync_http_client,
    )
    return _parse_success_response(response=response, response_model=AgentStubFileUploadResponse, label="file upload")


def request_agent_stub_file_download_http_sync(
    *,
    base_url: str,
    auth_jwe: str,
    file: AgentStubFileMapping,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
) -> AgentStubFileDownloadResponse:
    """Request one signed download URL from the HTTP Agent Stub endpoint."""

    try:
        request_model = AgentStubFileDownloadRequest(file=file)
    except ValidationError as exc:
        raise AgentStubValidationError("invalid Agent Stub file download request") from exc
    response = _post_agent_stub_json(
        base_url=base_url,
        auth_jwe=auth_jwe,
        endpoint_name="file download request",
        endpoint_url_factory=agent_stub_file_download_request_url,
        request_body=request_model.model_dump_json(exclude_none=True),
        timeout=timeout,
        sync_http_client=sync_http_client,
    )
    return _parse_success_response(
        response=response,
        response_model=AgentStubFileDownloadResponse,
        label="file download",
    )


def upload_file_to_signed_url_sync(
    *,
    upload_url: str,
    filename: str,
    file_obj: BinaryIO,
    mimetype: str,
    timeout: float | httpx.Timeout = 120.0,
    sync_http_client: httpx.Client | None = None,
) -> dict[str, object]:
    """Upload one local file directly to a signed Dify API data-plane URL."""

    owns_client = sync_http_client is None
    client = sync_http_client or httpx.Client(timeout=timeout, follow_redirects=True)
    try:
        response = client.post(
            upload_url,
            files={"file": (filename, file_obj, mimetype)},
            timeout=timeout,
        )
    except httpx.TimeoutException as exc:
        raise AgentStubTransferError("signed file upload timed out") from exc
    except httpx.RequestError as exc:
        raise AgentStubTransferError(f"signed file upload failed: {exc}") from exc
    finally:
        if owns_client:
            client.close()

    payload = _parse_json_payload(response, invalid_json_message="signed file upload returned invalid JSON")
    if response.is_error:
        detail = payload.get("detail", payload) if isinstance(payload, dict) else payload
        raise AgentStubHTTPError(response.status_code, detail)
    if not isinstance(payload, dict):
        raise AgentStubValidationError("invalid signed file upload response")
    return cast(dict[str, object], payload)


def download_file_bytes_from_signed_url_sync(
    *,
    download_url: str,
    timeout: float | httpx.Timeout = 120.0,
    sync_http_client: httpx.Client | None = None,
) -> bytes:
    """Download one file directly from a signed Dify API data-plane URL."""

    owns_client = sync_http_client is None
    client = sync_http_client or httpx.Client(timeout=timeout, follow_redirects=True)
    try:
        response = client.get(download_url, timeout=timeout)
    except httpx.TimeoutException as exc:
        raise AgentStubTransferError("signed file download timed out") from exc
    except httpx.RequestError as exc:
        raise AgentStubTransferError(f"signed file download failed: {exc}") from exc
    finally:
        if owns_client:
            client.close()

    if response.is_error:
        payload = _parse_json_payload(response, invalid_json_message="signed file download returned invalid JSON")
        detail = payload.get("detail", payload) if isinstance(payload, dict) else payload
        raise AgentStubHTTPError(response.status_code, detail)
    return response.content


def _validate_request(*, argv: list[str], metadata: dict[str, JsonValue] | None) -> AgentStubConnectRequest:
    try:
        return AgentStubConnectRequest(argv=argv, metadata=cast(dict[str, JsonValue], metadata or {}))
    except ValidationError as exc:
        raise AgentStubValidationError("invalid Agent Stub connection request") from exc


def _post_agent_stub_json(
    *,
    base_url: str,
    auth_jwe: str,
    endpoint_name: str,
    endpoint_url_factory: Callable[[str], str],
    request_body: str,
    timeout: float | httpx.Timeout,
    sync_http_client: httpx.Client | None,
) -> httpx.Response:
    try:
        endpoint_url = endpoint_url_factory(base_url)
    except ValueError as exc:
        raise AgentStubValidationError("invalid Agent Stub base URL") from exc
    owns_client = sync_http_client is None
    client = sync_http_client or httpx.Client(timeout=timeout, follow_redirects=True)
    try:
        return client.post(
            endpoint_url,
            content=request_body,
            headers={
                "Authorization": f"Bearer {auth_jwe}",
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )
    except httpx.TimeoutException as exc:
        raise AgentStubClientError(f"Agent Stub {endpoint_name} timed out") from exc
    except httpx.RequestError as exc:
        raise AgentStubClientError(f"Agent Stub {endpoint_name} request failed: {exc}") from exc
    finally:
        if owns_client:
            client.close()


def _parse_success_response[T: BaseModel](
    *,
    response: httpx.Response,
    response_model: type[T],
    label: str,
) -> T:
    payload = _parse_json_payload(response, invalid_json_message=f"Agent Stub returned invalid JSON for {label}")

    if response.is_error:
        detail = payload.get("detail", payload) if isinstance(payload, dict) else payload
        raise AgentStubHTTPError(response.status_code, detail)

    try:
        return response_model.model_validate(payload)
    except ValidationError as exc:
        raise AgentStubValidationError(f"invalid Agent Stub {label} response") from exc


def _parse_json_payload(response: httpx.Response, *, invalid_json_message: str) -> object:
    try:
        return response.json()
    except ValueError as exc:
        raise AgentStubClientError(invalid_json_message) from exc


__all__ = [
    "connect_agent_stub_http_sync",
    "download_file_bytes_from_signed_url_sync",
    "request_agent_stub_file_download_http_sync",
    "request_agent_stub_file_upload_http_sync",
    "upload_file_to_signed_url_sync",
]
