"""Client-safe HTTP helpers for Agent Stub control-plane endpoints.

The main ``Client`` class stays focused on run APIs. Sandbox-visible CLI
commands only need a narrow synchronous subset of the stub server contract and
must stay safe to import in default installations, so these helpers live under
``dify_agent.agent_stub.client`` rather than the standard run client package.
"""

from __future__ import annotations

import json
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
    AgentStubConfigEnvUpdateRequest,
    AgentStubConfigManifestResponse,
    AgentStubConfigNoteUpdateRequest,
    AgentStubConfigPushRequest,
    AgentStubConfigPushResponse,
    AgentStubDriveCommitRequest,
    AgentStubDriveCommitResponse,
    AgentStubDriveManifestResponse,
    AgentStubFileDownloadRequest,
    AgentStubFileDownloadResponse,
    AgentStubFileMapping,
    AgentStubFileUploadRequest,
    AgentStubFileUploadResponse,
    agent_stub_config_env_url,
    agent_stub_config_file_pull_url,
    agent_stub_config_manifest_url,
    agent_stub_config_note_url,
    agent_stub_config_push_url,
    agent_stub_config_skill_inspect_url,
    agent_stub_config_skill_pull_url,
    agent_stub_connections_url,
    agent_stub_drive_commit_url,
    agent_stub_drive_manifest_url,
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
    for_external: bool = True,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
) -> AgentStubFileDownloadResponse:
    """Request one signed download URL from the HTTP Agent Stub endpoint."""

    try:
        request_model = AgentStubFileDownloadRequest(file=file, for_external=for_external)
    except ValidationError as exc:
        raise AgentStubValidationError("invalid Agent Stub file download request") from exc
    response = _post_agent_stub_json(
        base_url=base_url,
        auth_jwe=auth_jwe,
        endpoint_name="file download request",
        endpoint_url_factory=agent_stub_file_download_request_url,
        request_body=request_model.model_dump_json(exclude_none=True, exclude_defaults=True),
        timeout=timeout,
        sync_http_client=sync_http_client,
    )
    return _parse_success_response(
        response=response,
        response_model=AgentStubFileDownloadResponse,
        label="file download",
    )


def request_agent_stub_drive_manifest_http_sync(
    *,
    base_url: str,
    auth_jwe: str,
    prefix: str,
    include_download_url: bool,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
) -> AgentStubDriveManifestResponse:
    """Request one drive manifest from the HTTP Agent Stub endpoint."""

    response = _get_agent_stub_json(
        base_url=base_url,
        auth_jwe=auth_jwe,
        endpoint_name="drive manifest request",
        endpoint_url_factory=agent_stub_drive_manifest_url,
        params={
            "prefix": prefix,
            "include_download_url": str(include_download_url).lower(),
        },
        timeout=timeout,
        sync_http_client=sync_http_client,
    )
    return _parse_success_response(
        response=response, response_model=AgentStubDriveManifestResponse, label="drive manifest"
    )


def request_agent_stub_drive_commit_http_sync(
    *,
    base_url: str,
    auth_jwe: str,
    request: AgentStubDriveCommitRequest,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
) -> AgentStubDriveCommitResponse:
    """Commit one drive batch through the HTTP Agent Stub endpoint."""

    response = _post_agent_stub_json(
        base_url=base_url,
        auth_jwe=auth_jwe,
        endpoint_name="drive commit request",
        endpoint_url_factory=agent_stub_drive_commit_url,
        request_body=_dump_drive_commit_request(request),
        timeout=timeout,
        sync_http_client=sync_http_client,
    )
    return _parse_success_response(response=response, response_model=AgentStubDriveCommitResponse, label="drive commit")


def request_agent_stub_config_manifest_http_sync(
    *,
    base_url: str,
    auth_jwe: str,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
) -> AgentStubConfigManifestResponse:
    """Fetch the current config manifest from the HTTP Agent Stub endpoint."""
    response = _get_agent_stub_json(
        base_url=base_url,
        auth_jwe=auth_jwe,
        endpoint_name="config manifest request",
        endpoint_url_factory=agent_stub_config_manifest_url,
        params={},
        timeout=timeout,
        sync_http_client=sync_http_client,
    )
    return _parse_success_response(
        response=response,
        response_model=AgentStubConfigManifestResponse,
        label="config manifest",
    )


def request_agent_stub_config_skill_pull_http_sync(
    *,
    base_url: str,
    auth_jwe: str,
    name: str,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
) -> bytes:
    """Download one config skill archive from the HTTP Agent Stub endpoint."""
    response = _get_agent_stub_json(
        base_url=base_url,
        auth_jwe=auth_jwe,
        endpoint_name="config skill pull request",
        endpoint_url_factory=lambda resolved_base_url: agent_stub_config_skill_pull_url(resolved_base_url, name),
        params={},
        timeout=timeout,
        sync_http_client=sync_http_client,
    )
    if response.is_error:
        payload = _parse_json_payload(
            response, invalid_json_message="Agent Stub returned invalid JSON for config skill pull"
        )
        detail = payload.get("detail", payload) if isinstance(payload, dict) else payload
        raise AgentStubHTTPError(response.status_code, detail)
    return response.content


def request_agent_stub_config_skill_inspect_http_sync(
    *,
    base_url: str,
    auth_jwe: str,
    name: str,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
) -> dict[str, object]:
    """Fetch the JSON inspect view for one config skill."""
    response = _get_agent_stub_json(
        base_url=base_url,
        auth_jwe=auth_jwe,
        endpoint_name="config skill inspect request",
        endpoint_url_factory=lambda resolved_base_url: agent_stub_config_skill_inspect_url(resolved_base_url, name),
        params={},
        timeout=timeout,
        sync_http_client=sync_http_client,
    )
    payload = _parse_json_payload(
        response, invalid_json_message="Agent Stub returned invalid JSON for config skill inspect"
    )
    if response.is_error:
        detail = payload.get("detail", payload) if isinstance(payload, dict) else payload
        raise AgentStubHTTPError(response.status_code, detail)
    if not isinstance(payload, dict):
        raise AgentStubValidationError("invalid Agent Stub config skill inspect response")
    return cast(dict[str, object], payload)


def request_agent_stub_config_file_pull_http_sync(
    *,
    base_url: str,
    auth_jwe: str,
    name: str,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
) -> bytes:
    """Download one config file payload from the HTTP Agent Stub endpoint."""
    response = _get_agent_stub_json(
        base_url=base_url,
        auth_jwe=auth_jwe,
        endpoint_name="config file pull request",
        endpoint_url_factory=lambda resolved_base_url: agent_stub_config_file_pull_url(resolved_base_url, name),
        params={},
        timeout=timeout,
        sync_http_client=sync_http_client,
    )
    if response.is_error:
        payload = _parse_json_payload(
            response, invalid_json_message="Agent Stub returned invalid JSON for config file pull"
        )
        detail = payload.get("detail", payload) if isinstance(payload, dict) else payload
        raise AgentStubHTTPError(response.status_code, detail)
    return response.content


def request_agent_stub_config_push_http_sync(
    *,
    base_url: str,
    auth_jwe: str,
    request: AgentStubConfigPushRequest,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
) -> AgentStubConfigPushResponse:
    """Push config file/skill/env/note mutations to the HTTP Agent Stub endpoint."""
    response = _post_agent_stub_json(
        base_url=base_url,
        auth_jwe=auth_jwe,
        endpoint_name="config push request",
        endpoint_url_factory=agent_stub_config_push_url,
        request_body=request.model_dump_json(exclude_none=True, exclude_defaults=True),
        timeout=timeout,
        sync_http_client=sync_http_client,
    )
    return _parse_success_response(response=response, response_model=AgentStubConfigPushResponse, label="config push")


def _dump_drive_commit_request(request: AgentStubDriveCommitRequest) -> str:
    payload = cast(dict[str, object], request.model_dump(mode="json", exclude_none=True))
    items = payload.get("items")
    if isinstance(items, list):
        for item in items:
            if isinstance(item, dict) and item.get("is_skill") is False:
                item.pop("is_skill")
    return json.dumps(payload, separators=(",", ":"))


def request_agent_stub_config_env_update_http_sync(
    *,
    base_url: str,
    auth_jwe: str,
    env_text: str,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
) -> dict[str, object]:
    """Set or delete config env entries through the HTTP Agent Stub endpoint."""
    request_model = AgentStubConfigEnvUpdateRequest(env_text=env_text)
    response = _send_agent_stub_json(
        method="PATCH",
        base_url=base_url,
        auth_jwe=auth_jwe,
        endpoint_name="config env update request",
        endpoint_url_factory=agent_stub_config_env_url,
        request_body=request_model.model_dump_json(),
        timeout=timeout,
        sync_http_client=sync_http_client,
    )
    payload = _parse_json_payload(
        response, invalid_json_message="Agent Stub returned invalid JSON for config env update"
    )
    if response.is_error:
        detail = payload.get("detail", payload) if isinstance(payload, dict) else payload
        raise AgentStubHTTPError(response.status_code, detail)
    if not isinstance(payload, dict):
        raise AgentStubValidationError("invalid Agent Stub config env update response")
    return cast(dict[str, object], payload)


def request_agent_stub_config_note_update_http_sync(
    *,
    base_url: str,
    auth_jwe: str,
    note: str,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
) -> dict[str, object]:
    """Update the config note text through the HTTP Agent Stub endpoint."""
    request_model = AgentStubConfigNoteUpdateRequest(note=note)
    response = _send_agent_stub_json(
        method="PUT",
        base_url=base_url,
        auth_jwe=auth_jwe,
        endpoint_name="config note update request",
        endpoint_url_factory=agent_stub_config_note_url,
        request_body=request_model.model_dump_json(),
        timeout=timeout,
        sync_http_client=sync_http_client,
    )
    payload = _parse_json_payload(
        response, invalid_json_message="Agent Stub returned invalid JSON for config note update"
    )
    if response.is_error:
        detail = payload.get("detail", payload) if isinstance(payload, dict) else payload
        raise AgentStubHTTPError(response.status_code, detail)
    if not isinstance(payload, dict):
        raise AgentStubValidationError("invalid Agent Stub config note update response")
    return cast(dict[str, object], payload)


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
    return _send_agent_stub_json(
        method="POST",
        base_url=base_url,
        auth_jwe=auth_jwe,
        endpoint_name=endpoint_name,
        endpoint_url_factory=endpoint_url_factory,
        request_body=request_body,
        timeout=timeout,
        sync_http_client=sync_http_client,
    )


def _send_agent_stub_json(
    *,
    method: str,
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
        return client.request(
            method,
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


def _get_agent_stub_json(
    *,
    base_url: str,
    auth_jwe: str,
    endpoint_name: str,
    endpoint_url_factory: Callable[[str], str],
    params: dict[str, str],
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
        return client.get(
            endpoint_url,
            params=params,
            headers={"Authorization": f"Bearer {auth_jwe}"},
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
    "request_agent_stub_config_env_update_http_sync",
    "request_agent_stub_config_file_pull_http_sync",
    "request_agent_stub_config_manifest_http_sync",
    "request_agent_stub_config_note_update_http_sync",
    "request_agent_stub_config_push_http_sync",
    "request_agent_stub_config_skill_inspect_http_sync",
    "request_agent_stub_config_skill_pull_http_sync",
    "request_agent_stub_drive_commit_http_sync",
    "request_agent_stub_drive_manifest_http_sync",
    "request_agent_stub_file_download_http_sync",
    "request_agent_stub_file_upload_http_sync",
    "upload_file_to_signed_url_sync",
]
