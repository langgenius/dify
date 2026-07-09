"""CLI helpers for sandbox-visible Agent Stub file commands."""

from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar, Literal, Protocol, cast

from pydantic import BaseModel, ConfigDict, ValidationError

from dify_agent.agent_stub.cli._env import read_agent_stub_environment
from dify_agent.agent_stub.client import (
    AgentStubTransferError,
    AgentStubValidationError,
    download_file_bytes_from_signed_url_sync,
    request_agent_stub_file_download_sync,
    request_agent_stub_file_upload_sync,
    upload_file_to_signed_url_sync,
)
from dify_agent.agent_stub.protocol.agent_stub import AgentStubFileMapping, is_canonical_dify_file_reference


class _AgentStubFileDownloadResponse(Protocol):
    download_url: str


class UploadedToolFileMapping(BaseModel):
    """Canonical Agent output mapping returned by ``dify-agent file upload``."""

    transfer_method: Literal["tool_file"] = "tool_file"
    reference: str
    download_url: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


@dataclass(frozen=True, slots=True)
class DownloadedFileResult:
    """Local filesystem result for one CLI download command."""

    path: Path


@dataclass(frozen=True, slots=True)
class UploadedToolFileResource:
    """Lower-level upload result carrying the internal mapping and ToolFile id."""

    mapping: AgentStubFileMapping
    tool_file_id: str


def upload_file_from_environment(*, path: str) -> UploadedToolFileMapping:
    """Upload one sandbox-local file through the Agent Stub control plane.

    The signed upload data-plane response must carry the Dify-generated
    ``reference`` for the new ``ToolFile``. The helper then resolves the same
    mapping through the signed download-request control plane so the public CLI
    output includes a ready-to-share external ``download_url``.
    """

    resource = upload_tool_file_resource_from_environment(path=path)
    reference = resource.mapping.reference
    if not isinstance(reference, str) or not reference:
        raise AgentStubTransferError("signed file upload response is missing reference")
    environment = read_agent_stub_environment()
    download_url = _request_uploaded_tool_file_download_url(
        url=environment.url,
        auth_jwe=environment.auth_jwe,
        reference=reference,
    )
    return UploadedToolFileMapping(reference=reference, download_url=download_url)


def upload_tool_file_resource_from_environment(*, path: str) -> UploadedToolFileResource:
    """Upload one sandbox-local file and preserve both reference and ToolFile id.

    This lower-level helper backs ``drive push``. The signed upload data-plane
    response must include both the canonical Dify ``reference`` used by public
    CLI output and the raw ToolFile ``id`` required by drive commit payloads.
    It intentionally stops after the upload allocation so internal flows that
    only need the ToolFile identity do not pay for signed download enrichment.

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
    upload_request: object = request_agent_stub_file_upload_sync(
        url=environment.url,
        auth_jwe=environment.auth_jwe,
        filename=filename,
        mimetype=mime_type,
    )
    if not hasattr(upload_request, "upload_url") or not isinstance(upload_request.upload_url, str):
        raise AgentStubTransferError("signed file upload response is missing upload_url")
    with source_path.open("rb") as file_obj:
        payload = upload_file_to_signed_url_sync(
            upload_url=upload_request.upload_url,
            filename=filename,
            file_obj=file_obj,
            mimetype=mime_type,
        )
    reference, tool_file_id = _normalize_uploaded_tool_file_payload(payload)
    return UploadedToolFileResource(
        mapping=AgentStubFileMapping(transfer_method="tool_file", reference=reference),
        tool_file_id=tool_file_id,
    )


def download_file_from_environment(
    *,
    transfer_method: str | None = None,
    reference_or_url: str | None = None,
    mapping: str | None = None,
    local_dir: str | None = None,
) -> DownloadedFileResult:
    """Download one workflow file mapping into the sandbox filesystem.

    Callers may provide either the public positional pair
    ``TRANSFER_METHOD REFERENCE_OR_URL`` or one JSON ``--mapping`` payload.
    The helper normalizes both forms into ``AgentStubFileMapping`` before
    requesting a signed download URL from the Agent Stub.
    """

    file_mapping = _build_download_mapping(
        transfer_method=transfer_method,
        reference_or_url=reference_or_url,
        mapping=mapping,
    )
    environment = read_agent_stub_environment()

    download_request: object = request_agent_stub_file_download_sync(
        url=environment.url,
        auth_jwe=environment.auth_jwe,
        file=file_mapping,
    )
    if not hasattr(download_request, "filename") or not isinstance(download_request.filename, str):
        raise AgentStubTransferError("signed file download response is missing filename")
    if not hasattr(download_request, "download_url") or not isinstance(download_request.download_url, str):
        raise AgentStubTransferError("signed file download response is missing download_url")
    target_dir = Path(local_dir).expanduser().resolve() if local_dir else Path.cwd()
    target_dir.mkdir(parents=True, exist_ok=True)
    destination = _deduplicate_destination_path(target_dir / _sanitize_download_filename(download_request.filename))
    _ = destination.write_bytes(download_file_bytes_from_signed_url_sync(download_url=download_request.download_url))
    return DownloadedFileResult(path=destination)


def _build_download_mapping(
    *,
    transfer_method: str | None,
    reference_or_url: str | None,
    mapping: str | None,
) -> AgentStubFileMapping:
    if mapping is not None:
        if transfer_method is not None or reference_or_url is not None:
            raise AgentStubValidationError("--mapping cannot be combined with TRANSFER_METHOD or REFERENCE_OR_URL")
        try:
            return AgentStubFileMapping.model_validate_json(mapping)
        except ValidationError as exc:
            raise AgentStubValidationError("invalid file download mapping") from exc

    if transfer_method is None or reference_or_url is None:
        raise AgentStubValidationError("file download requires either --mapping or TRANSFER_METHOD REFERENCE_OR_URL")

    normalized_transfer_method = cast(
        Literal["local_file", "tool_file", "datasource_file", "remote_url"],
        transfer_method,
    )
    try:
        return AgentStubFileMapping(
            transfer_method=normalized_transfer_method,
            url=reference_or_url if normalized_transfer_method == "remote_url" else None,
            reference=reference_or_url if normalized_transfer_method != "remote_url" else None,
        )
    except ValidationError as exc:
        raise AgentStubValidationError("invalid file download arguments") from exc


def _normalize_uploaded_tool_file_payload(payload: dict[str, object]) -> tuple[str, str]:
    reference = payload.get("reference")
    if not isinstance(reference, str) or not reference:
        raise AgentStubTransferError("signed file upload response is missing reference")
    if not is_canonical_dify_file_reference(reference):
        raise AgentStubTransferError("signed file upload response has invalid canonical reference")
    tool_file_id = payload.get("id")
    if not isinstance(tool_file_id, str) or not tool_file_id:
        raise AgentStubTransferError("signed file upload response is missing id")
    return reference, tool_file_id


def _request_uploaded_tool_file_download_url(*, url: str, auth_jwe: str, reference: str) -> str:
    download_request = cast(
        _AgentStubFileDownloadResponse,
        request_agent_stub_file_download_sync(
            url=url,
            auth_jwe=auth_jwe,
            file=AgentStubFileMapping(transfer_method="tool_file", reference=reference),
        ),
    )
    download_url = download_request.download_url
    if not isinstance(download_url, str) or not download_url:
        raise AgentStubTransferError("signed file download response is missing download_url")
    return download_url


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
