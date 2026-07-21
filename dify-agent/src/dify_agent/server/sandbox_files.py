"""Workspace-scoped file access through a resumed Sandbox lease.

Browsing stays on the lease's backend-neutral ``FileSystem``. Uploads first
finish a secure whole-file read there, then send only bytes plus basename and
MIME type through the server-side Agent Stub control plane. No upload staging
path is created inside the sandbox and the runtime Shell is not involved.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
import mimetypes
from pathlib import PurePosixPath
from typing import Protocol, TypeVar, cast

import httpx
from pydantic import ValidationError

from dify_agent.agent_stub.protocol import (
    AgentStubFileDownloadRequest,
    AgentStubFileMapping,
    AgentStubFileUploadRequest,
)
from dify_agent.agent_stub.server.agent_stub_files import AgentStubFileRequestError, AgentStubFileRequestHandler
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubPrincipal
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.sandbox.layer import DifySandboxLayer
from dify_agent.protocol import (
    SandboxListRequest,
    SandboxListResponse,
    SandboxLocator,
    SandboxReadRequest,
    SandboxReadResponse,
    SandboxUploadRequest,
    SandboxUploadResponse,
    SandboxUploadedFile,
    normalize_composition,
)
from dify_agent.runtime.compositor_factory import DifyAgentLayerProvider, build_pydantic_ai_compositor
from dify_agent.runtime_backend.errors import (
    SandboxLostError,
    WorkspaceFileTooLargeError,
    WorkspacePathError,
    WorkspaceUnavailableError,
)

_LIST_MAX_ENTRIES = 1000
_UPLOAD_TIMEOUT_SECONDS = 30.0
ResultT = TypeVar("ResultT")


class SandboxFileError(Exception):
    """Sandbox file failure mapped to HTTP by the FastAPI route layer."""

    code: str
    message: str
    status_code: int

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class SandboxFileUploader(Protocol):
    """Upload already-captured Workspace bytes without accepting a sandbox path."""

    async def upload(
        self,
        *,
        execution_context: DifyExecutionContextLayerConfig,
        filename: str,
        mimetype: str,
        content: bytes,
    ) -> SandboxUploadedFile: ...


@dataclass(slots=True)
class AgentStubSandboxFileUploader:
    """Use the existing Agent Stub handler to allocate and resolve a ToolFile upload."""

    file_request_handler: AgentStubFileRequestHandler
    timeout: httpx.Timeout | float = _UPLOAD_TIMEOUT_SECONDS
    transport: httpx.AsyncBaseTransport | None = None

    async def upload(
        self,
        *,
        execution_context: DifyExecutionContextLayerConfig,
        filename: str,
        mimetype: str,
        content: bytes,
    ) -> SandboxUploadedFile:
        """Upload bytes to a signed URL and resolve the canonical internal download URL."""
        principal = AgentStubPrincipal(
            execution_context=execution_context,
            session_id=None,
            scope=[],
            token_id="sandbox-file-upload",
        )
        try:
            upload_request = await self.file_request_handler.create_upload_request(
                principal=principal,
                request=AgentStubFileUploadRequest(filename=filename, mimetype=mimetype),
            )
            async with httpx.AsyncClient(
                timeout=self.timeout,
                follow_redirects=True,
                trust_env=False,
                transport=self.transport,
            ) as client:
                response = await client.post(
                    upload_request.upload_url,
                    files={"file": (filename, content, mimetype)},
                )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise ValueError("signed upload returned a non-object payload")
            mapping = AgentStubFileMapping(
                transfer_method="tool_file",
                reference=payload.get("reference"),
            )
            download_request = await self.file_request_handler.create_download_request(
                principal=principal,
                request=AgentStubFileDownloadRequest(file=mapping, for_external=False),
            )
            return SandboxUploadedFile(
                reference=cast(str, mapping.reference),
                download_url=download_request.download_url,
            )
        except AgentStubFileRequestError as exc:
            raise SandboxFileError("agent_stub_upload_failed", str(exc.detail), status_code=exc.status_code) from exc
        except httpx.TimeoutException as exc:
            raise SandboxFileError("agent_stub_upload_failed", "signed file upload timed out", status_code=504) from exc
        except httpx.HTTPStatusError as exc:
            raise SandboxFileError(
                "agent_stub_upload_failed",
                f"signed file upload failed with status {exc.response.status_code}",
                status_code=exc.response.status_code,
            ) from exc
        except httpx.RequestError as exc:
            raise SandboxFileError("agent_stub_upload_failed", f"signed file upload failed: {exc}", status_code=502) from exc
        except (ValidationError, ValueError) as exc:
            raise SandboxFileError("agent_stub_upload_failed", "signed file upload returned invalid data", status_code=502) from exc


@dataclass(slots=True)
class SandboxFileService:
    """Resume the latest runtime sandbox and expose only its Workspace tree.

    Upload captures bytes through ``SandboxLease.files`` before crossing into
    the server-side file control plane. ``SandboxLease.commands`` and the
    sandbox handle are deliberately outside this service's upload boundary.
    """

    layer_providers: tuple[DifyAgentLayerProvider, ...]
    upload_max_bytes: int
    file_uploader: SandboxFileUploader | None = None

    async def list_files(self, request: SandboxListRequest) -> SandboxListResponse:
        path = normalize_workspace_path(request.path, allow_current_directory=True)

        async def operation(sandbox: DifySandboxLayer) -> SandboxListResponse:
            result = await sandbox.lease.files.list_directory(
                workspace_dir=sandbox.lease.layout.workspace_dir,
                path=path,
                limit=_LIST_MAX_ENTRIES,
            )
            return SandboxListResponse.model_validate(
                {
                    "path": result.path,
                    "entries": [
                        {"name": entry.name, "type": entry.type, "size": entry.size, "mtime": entry.mtime}
                        for entry in result.entries
                    ],
                    "truncated": result.truncated,
                }
            )

        return await self._with_sandbox(request.locator, operation)

    async def read_file(self, request: SandboxReadRequest) -> SandboxReadResponse:
        path = normalize_workspace_path(request.path, allow_current_directory=False)

        async def operation(sandbox: DifySandboxLayer) -> SandboxReadResponse:
            result = await sandbox.lease.files.read_file(
                workspace_dir=sandbox.lease.layout.workspace_dir,
                path=path,
                max_bytes=request.max_bytes,
            )
            return SandboxReadResponse(
                path=result.path,
                size=result.size,
                truncated=result.truncated,
                binary=result.binary,
                text=result.text,
            )

        return await self._with_sandbox(request.locator, operation)

    async def upload_file(self, request: SandboxUploadRequest) -> SandboxUploadResponse:
        path = normalize_workspace_path(request.path, allow_current_directory=False)
        uploader = self.file_uploader
        if uploader is None:
            raise SandboxFileError("agent_stub_not_configured", "sandbox file upload is not configured", status_code=503)

        async def operation(sandbox: DifySandboxLayer) -> SandboxUploadResponse:
            result = await sandbox.lease.files.read_bytes(
                workspace_dir=sandbox.lease.layout.workspace_dir,
                path=path,
                max_bytes=self.upload_max_bytes,
            )
            filename = PurePosixPath(result.path).name
            mimetype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            uploaded_file = await uploader.upload(
                execution_context=sandbox.deps.execution_context.config,
                filename=filename,
                mimetype=mimetype,
                content=result.content,
            )
            return SandboxUploadResponse(path=result.path, file=uploaded_file)

        return await self._with_sandbox(request.locator, operation)

    async def _with_sandbox(
        self,
        locator: SandboxLocator,
        operation: Callable[[DifySandboxLayer], Awaitable[ResultT]],
    ) -> ResultT:
        try:
            graph_config, layer_configs = normalize_composition(locator.composition)
            compositor = build_pydantic_ai_compositor(graph_config, providers=self.layer_providers)
            async with compositor.enter(configs=layer_configs, session_snapshot=locator.session_snapshot) as run:
                run.suspend_on_exit()
                sandbox = run.get_layer("sandbox", DifySandboxLayer)
                return await operation(sandbox)
        except SandboxFileError:
            raise
        except (KeyError, TypeError, ValueError) as exc:
            raise SandboxFileError("invalid_sandbox_locator", str(exc), status_code=400) from exc
        except WorkspacePathError as exc:
            raise SandboxFileError("invalid_workspace_path", str(exc), status_code=400) from exc
        except WorkspaceFileTooLargeError as exc:
            raise SandboxFileError("file_too_large", str(exc), status_code=413) from exc
        except (WorkspaceUnavailableError, SandboxLostError) as exc:
            raise SandboxFileError("sandbox_not_found", str(exc), status_code=404) from exc
        except RuntimeError as exc:
            raise SandboxFileError("sandbox_command_failed", str(exc), status_code=502) from exc


def normalize_workspace_path(path: str, *, allow_current_directory: bool) -> str:
    """Normalize a path that must remain relative to the current Workspace."""

    normalized = (path or "").strip()
    if normalized in {"", ".", "./"}:
        if allow_current_directory:
            return "."
        raise SandboxFileError("invalid_workspace_path", "workspace path must not be blank", status_code=400)
    if "\x00" in normalized or any(ord(character) < 0x20 for character in normalized):
        raise SandboxFileError("invalid_workspace_path", "workspace path contains control characters", status_code=400)
    candidate = PurePosixPath(normalized)
    if candidate.is_absolute() or ".." in candidate.parts or any(part.startswith("~") for part in candidate.parts):
        raise SandboxFileError(
            "invalid_workspace_path", "workspace path must not escape the workspace root", status_code=400
        )
    return str(candidate)


__all__ = [
    "AgentStubSandboxFileUploader",
    "SandboxFileError",
    "SandboxFileService",
    "SandboxFileUploader",
    "normalize_workspace_path",
]
