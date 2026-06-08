"""CLI helpers for sandbox-visible file upload/download commands."""

from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, cast

from pydantic import BaseModel, ConfigDict, ValidationError

from dify_agent.agent_stub.cli._env import read_back_proxy_environment
from dify_agent.agent_stub.client._back_proxy import (
    BackProxyTransferError,
    BackProxyValidationError,
    download_file_bytes_from_signed_url_sync,
    request_back_proxy_file_download_sync,
    request_back_proxy_file_upload_sync,
    upload_file_to_signed_url_sync,
)
from dify_agent.agent_stub.protocol.back_proxy import BackProxyFileMapping, is_canonical_dify_file_reference


class UploadedToolFileMapping(BaseModel):
    """Canonical Agent output mapping returned by ``dify-agent file upload``."""

    transfer_method: Literal["tool_file"] = "tool_file"
    reference: str

    model_config = ConfigDict(extra="forbid")


@dataclass(frozen=True, slots=True)
class DownloadedFileResult:
    """Local filesystem result for one CLI download command."""

    path: Path


def upload_file_from_environment(*, path: str) -> UploadedToolFileMapping:
    """Upload one sandbox-local file through the back proxy control plane.

    The signed upload data-plane response must carry the Dify-generated
    ``reference`` for the new ``ToolFile`` so the sandbox can return the
    canonical Agent output file mapping without synthesizing reference format.
    """

    source_path = Path(path).expanduser().resolve()
    if not source_path.is_file():
        raise BackProxyValidationError(f"local file not found: {source_path}")

    environment = read_back_proxy_environment()
    filename = source_path.name
    mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    upload_request = request_back_proxy_file_upload_sync(
        base_url=environment.base_url,
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
    return _normalize_uploaded_tool_file(payload)


def download_file_from_environment(
    *,
    transfer_method: str,
    reference_or_url: str,
    directory: str | None = None,
) -> DownloadedFileResult:
    """Download one workflow file mapping into the sandbox filesystem."""

    environment = read_back_proxy_environment()
    normalized_transfer_method = cast(
        Literal["local_file", "tool_file", "datasource_file", "remote_url"],
        transfer_method,
    )
    try:
        file_mapping = BackProxyFileMapping(
            transfer_method=normalized_transfer_method,
            url=reference_or_url if normalized_transfer_method == "remote_url" else None,
            reference=reference_or_url if normalized_transfer_method != "remote_url" else None,
        )
    except ValidationError as exc:
        raise BackProxyValidationError("invalid file download arguments") from exc

    download_request = request_back_proxy_file_download_sync(
        base_url=environment.base_url,
        auth_jwe=environment.auth_jwe,
        file=file_mapping,
    )
    target_dir = Path(directory).expanduser().resolve() if directory else Path.cwd()
    target_dir.mkdir(parents=True, exist_ok=True)
    destination = _deduplicate_destination_path(target_dir / _sanitize_download_filename(download_request.filename))
    destination.write_bytes(download_file_bytes_from_signed_url_sync(download_url=download_request.download_url))
    return DownloadedFileResult(path=destination)


def _normalize_uploaded_tool_file(payload: dict[str, object]) -> UploadedToolFileMapping:
    reference = payload.get("reference")
    if not isinstance(reference, str) or not reference:
        raise BackProxyTransferError("signed file upload response is missing reference")
    if not is_canonical_dify_file_reference(reference):
        raise BackProxyTransferError("signed file upload response has invalid canonical reference")
    return UploadedToolFileMapping(reference=reference)


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
        raise BackProxyTransferError("signed file download response has invalid filename")
    return sanitized


__all__ = [
    "DownloadedFileResult",
    "UploadedToolFileMapping",
    "download_file_from_environment",
    "upload_file_from_environment",
]
