"""API-side client for the agent backend's read-only workspace file endpoints.

The agent backend exposes ``/workspaces/{session_id}/files{,/preview,/download}``
to inspect a shell-layer sandbox workspace. This thin synchronous client proxies
those reads for the console FS inspector and normalizes transport/HTTP failures
into the API backend's ``AgentBackendError`` boundary, preserving the backend's
status code and ``{code, message}`` detail so the controller can relay them.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from typing import Literal

import httpx
from pydantic import BaseModel

from clients.agent_backend.errors import AgentBackendHTTPError, AgentBackendTransportError

_DEFAULT_TIMEOUT_SECONDS = 30.0


class WorkspaceFileEntry(BaseModel):
    """One entry in a workspace directory listing."""

    name: str
    type: Literal["file", "dir", "symlink"]
    size: int
    mtime: int


class WorkspaceListResult(BaseModel):
    """Directory listing of a workspace path."""

    path: str
    entries: list[WorkspaceFileEntry]
    truncated: bool


class WorkspacePreviewResult(BaseModel):
    """Inline preview of a workspace file."""

    path: str
    size: int
    truncated: bool
    binary: bool
    text: str | None = None


@dataclass(frozen=True, slots=True)
class WorkspaceDownloadResult:
    """Decoded bytes of a workspace file for download."""

    path: str
    size: int
    truncated: bool
    content: bytes


class WorkspaceFilesBackendClient:
    """Synchronous proxy to the agent backend workspace file endpoints."""

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = _DEFAULT_TIMEOUT_SECONDS,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._transport = transport

    def list_files(self, session_id: str, path: str) -> WorkspaceListResult:
        data = self._get(f"/workspaces/{session_id}/files", params={"path": path})
        return WorkspaceListResult.model_validate(data)

    def preview(self, session_id: str, path: str) -> WorkspacePreviewResult:
        data = self._get(f"/workspaces/{session_id}/files/preview", params={"path": path})
        return WorkspacePreviewResult.model_validate(data)

    def download(self, session_id: str, path: str) -> WorkspaceDownloadResult:
        data = self._get(f"/workspaces/{session_id}/files/download", params={"path": path})
        encoded = data.get("content_base64")
        if not isinstance(encoded, str):
            raise AgentBackendHTTPError("agent backend download response missing content", status_code=502, detail=data)
        try:
            content = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise AgentBackendHTTPError(
                "agent backend returned undecodable download content", status_code=502, detail=str(exc)
            ) from exc
        size = data.get("size")
        return WorkspaceDownloadResult(
            path=str(data.get("path", path)),
            size=int(size) if isinstance(size, (int, float)) else len(content),
            truncated=bool(data.get("truncated")),
            content=content,
        )

    def _get(self, route: str, *, params: dict[str, str]) -> dict[str, object]:
        url = f"{self._base_url}{route}"
        try:
            with httpx.Client(timeout=self._timeout, transport=self._transport, trust_env=False) as client:
                response = client.get(url, params=params)
        except httpx.HTTPError as exc:
            raise AgentBackendTransportError(f"failed to reach agent backend workspace endpoint: {exc}") from exc
        if response.status_code >= 400:
            detail: object
            try:
                detail = response.json().get("detail", response.text)
            except ValueError:
                detail = response.text
            raise AgentBackendHTTPError(
                f"agent backend workspace request failed ({response.status_code})",
                status_code=response.status_code,
                detail=detail,
            )
        body = response.json()
        if not isinstance(body, dict):
            raise AgentBackendHTTPError(
                "agent backend workspace response was not an object", status_code=502, detail=body
            )
        return body


__all__ = [
    "WorkspaceDownloadResult",
    "WorkspaceFileEntry",
    "WorkspaceFilesBackendClient",
    "WorkspaceListResult",
    "WorkspacePreviewResult",
]
