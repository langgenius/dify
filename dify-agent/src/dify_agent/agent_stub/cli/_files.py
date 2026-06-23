"""CLI helpers for sandbox-visible Agent Stub file commands."""

from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, cast

from pydantic import BaseModel, ConfigDict, ValidationError

from dify_agent.agent_stub.cli._env import read_agent_stub_environment
from dify_agent.agent_stub.client._agent_stub import (
    download_file_bytes_from_signed_url_sync,
    request_agent_stub_file_download_sync,
    request_agent_stub_file_upload_sync,
    upload_file_to_signed_url_sync,
)
from dify_agent.agent_stub.client._errors import AgentStubTransferError, AgentStubValidationError
from dify_agent.agent_stub.protocol.agent_stub import AgentStubFileMapping, is_canonical_dify_file_reference


class UploadedToolFileMapping(BaseModel):
    """Canonical Agent output mapping returned by ``dify-agent file upload``."""

    transfer_method: Literal["tool_file"] = "tool_file"
    reference: str

    model_config = ConfigDict(extra="forbid")


@dataclass(frozen=True, slots=True)
class DownloadedFileResult:
    """Local filesystem result for one CLI download command."""

    path: Path


@dataclass(frozen=True, slots=True)
class UploadedToolFileResource:
    """Lower-level upload result carrying both public mapping and ToolFile id."""

    mapping: UploadedToolFileMapping
    tool_file_id: str


def upload_file_from_environment(*, path: str) -> UploadedToolFileMapping:
    """Upload one sandbox-local file through the Agent Stub control plane.

    The signed upload data-plane response must carry the Dify-generated
    ``reference`` for the new ``ToolFile`` so the sandbox can return the
    canonical Agent output file mapping without synthesizing reference format.
    """

    return upload_tool_file_resource_from_environment(path=path).mapping


def upload_tool_file_resource_from_environment(*, path: str) -> UploadedToolFileResource:
    """Upload one sandbox-local file and preserve both reference and ToolFile id.

    This lower-level helper backs ``drive push``. The signed upload data-plane
    response must include both the canonical Dify ``reference`` used by public
    CLI output and the raw ToolFile ``id`` required by drive commit payloads.

    Raises:
        AgentStubValidationError: if ``path`` does not resolve to a local file.
        AgentStubTransferError: if the signed upload response omits either the
            canonical ``reference`` or the raw ToolFile ``id``, or if the
            canonical reference is malformed.
    """

    source_path = Path(path).expanduser().resolve()
    if not source_path.is_file():
        raise AgentStubValidationError(f"local file not found: {source_path}")

    environment = read_agent_stub_environment()
    filename = source_path.name
    mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    upload_request = request_agent_stub_file_upload_sync(
        url=environment.url,
        auth_jwe=environment.auth_jwe,
        filename=filename,
        mimetype=mime_type,
    )
    with source_path.open("rb") as file_obj:
        payload = upload_file_to_signed_url_sync(
            upload_url=upload_request.upload_url,
            filename=filename,
            file_obj=file_obj,
            mimetype=mime_type,
        )
    return _normalize_uploaded_tool_file_resource(payload)


def download_file_from_environment(
    *,
    transfer_method: str,
    reference_or_url: str,
    directory: str | None = None,
) -> DownloadedFileResult:
    """Download one workflow file mapping into the sandbox filesystem."""

    environment = read_agent_stub_environment()
    normalized_transfer_method = cast(
        Literal["local_file", "tool_file", "datasource_file", "remote_url"],
        transfer_method,
    )
    try:
        file_mapping = AgentStubFileMapping(
            transfer_method=normalized_transfer_method,
            url=reference_or_url if normalized_transfer_method == "remote_url" else None,
            reference=reference_or_url if normalized_transfer_method != "remote_url" else None,
        )
    except ValidationError as exc:
        raise AgentStubValidationError("invalid file download arguments") from exc

    download_request = request_agent_stub_file_download_sync(
        url=environment.url,
        auth_jwe=environment.auth_jwe,
        file=file_mapping,
    )
    target_dir = Path(directory).expanduser().resolve() if directory else Path.cwd()
    target_dir.mkdir(parents=True, exist_ok=True)
    destination = _deduplicate_destination_path(target_dir / _sanitize_download_filename(download_request.filename))
    destination.write_bytes(download_file_bytes_from_signed_url_sync(download_url=download_request.download_url))
    return DownloadedFileResult(path=destination)


def _normalize_uploaded_tool_file_resource(payload: dict[str, object]) -> UploadedToolFileResource:
    reference = payload.get("reference")
    if not isinstance(reference, str) or not reference:
        raise AgentStubTransferError("signed file upload response is missing reference")
    if not is_canonical_dify_file_reference(reference):
        raise AgentStubTransferError("signed file upload response has invalid canonical reference")
    tool_file_id = payload.get("id")
    if not isinstance(tool_file_id, str) or not tool_file_id:
        raise AgentStubTransferError("signed file upload response is missing id")
    return UploadedToolFileResource(
        mapping=UploadedToolFileMapping(reference=reference),
        tool_file_id=tool_file_id,
    )


def _deduplicate_destination_path(path: Path) -> Path:
    if not path.exists():
        return path

    suffix = "".join(path.suffixes)
    stem = path.name[: -len(suffix)] if suffix else path.name
    counter = 1
    while True:
        candidate = path.with_name(f"{stem} ({counter}){suffix}")
        if not candidate.exists():
            return candidate
        counter += 1


def _sanitize_download_filename(filename: str) -> str:
    sanitized = Path(filename).name
    if sanitized in {"", ".", ".."}:
        raise AgentStubTransferError("signed file download response has invalid filename")
    return sanitized


__all__ = [
    "DownloadedFileResult",
    "UploadedToolFileMapping",
    "UploadedToolFileResource",
    "download_file_from_environment",
    "upload_file_from_environment",
    "upload_tool_file_resource_from_environment",
]
