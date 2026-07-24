"""Workspace file access through an operation-scoped RuntimeLease.

Paths are passed directly to the backend FileSystem. Dify Agent does not rebase
them to ``layout.workspace_dir`` or impose another containment boundary.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import mimetypes
from pathlib import PurePosixPath
from typing import ClassVar, Protocol

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError

from dify_agent.agent_stub.protocol import (
    AgentStubFileDownloadRequest,
    AgentStubFileMapping,
    AgentStubFileUploadRequest,
)
from dify_agent.agent_stub.server.agent_stub_files import AgentStubFileRequestError, AgentStubFileRequestHandler
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubPrincipal
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol import (
    WorkspaceListRequest,
    WorkspaceListResponse,
    WorkspaceReadRequest,
    WorkspaceReadResponse,
    WorkspaceUploadRequest,
    WorkspaceUploadResponse,
    WorkspaceUploadedFile,
)
from dify_agent.runtime_backend import (
    BindingAcquireError,
    BindingLostError,
    ExecutionBindingBackend,
    WorkspaceFileTooLargeError,
    WorkspacePathError,
    WorkspaceUnavailableError,
)
from dify_agent.runtime_backend.leases import open_runtime_lease

_LIST_MAX_ENTRIES = 1000
_UPLOAD_TIMEOUT_SECONDS = 30.0


class _SignedUploadResponse(BaseModel):
    reference: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class WorkspaceFileError(Exception):
    code: str
    message: str
    status_code: int

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class WorkspaceFileUploader(Protocol):
    async def upload(
        self,
        *,
        execution_context: DifyExecutionContextLayerConfig,
        filename: str,
        mimetype: str,
        content: bytes,
    ) -> WorkspaceUploadedFile: ...


@dataclass(slots=True)
class AgentStubWorkspaceFileUploader:
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
    ) -> WorkspaceUploadedFile:
        principal = AgentStubPrincipal(
            execution_context=execution_context,
            session_id=None,
            scope=[],
            token_id="workspace-file-upload",
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
            _ = response.raise_for_status()
            payload = _SignedUploadResponse.model_validate(response.json())
            mapping = AgentStubFileMapping(transfer_method="tool_file", reference=payload.reference)
            download_request = await self.file_request_handler.create_download_request(
                principal=principal,
                request=AgentStubFileDownloadRequest(file=mapping, for_external=False),
            )
            return WorkspaceUploadedFile(
                reference=payload.reference,
                download_url=download_request.download_url,
            )
        except AgentStubFileRequestError as exc:
            raise WorkspaceFileError("agent_stub_upload_failed", str(exc.detail), status_code=exc.status_code) from exc
        except httpx.TimeoutException as exc:
            raise WorkspaceFileError(
                "agent_stub_upload_failed", "signed file upload timed out", status_code=504
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise WorkspaceFileError(
                "agent_stub_upload_failed",
                f"signed file upload failed with status {exc.response.status_code}",
                status_code=exc.response.status_code,
            ) from exc
        except httpx.RequestError as exc:
            raise WorkspaceFileError(
                "agent_stub_upload_failed", f"signed file upload failed: {exc}", status_code=502
            ) from exc
        except (ValidationError, ValueError) as exc:
            raise WorkspaceFileError(
                "agent_stub_upload_failed", "signed file upload returned invalid data", status_code=502
            ) from exc


@dataclass(slots=True)
class WorkspaceFileService:
    execution_bindings: ExecutionBindingBackend
    upload_max_bytes: int
    file_uploader: WorkspaceFileUploader | None = None

    async def list_files(self, request: WorkspaceListRequest) -> WorkspaceListResponse:
        try:
            async with open_runtime_lease(self.execution_bindings, request.backend_binding_ref) as lease:
                result = await lease.files.list_directory(path=request.path, limit=_LIST_MAX_ENTRIES)
            return WorkspaceListResponse.model_validate(
                {
                    "path": result.path,
                    "entries": [asdict(entry) for entry in result.entries],
                    "truncated": result.truncated,
                }
            )
        except Exception as exc:
            raise _normalize_file_error(exc) from exc

    async def read_file(self, request: WorkspaceReadRequest) -> WorkspaceReadResponse:
        try:
            async with open_runtime_lease(self.execution_bindings, request.backend_binding_ref) as lease:
                result = await lease.files.read_file(path=request.path, max_bytes=request.max_bytes)
            return WorkspaceReadResponse(
                path=result.path,
                size=result.size,
                truncated=result.truncated,
                binary=result.binary,
                text=result.text,
            )
        except Exception as exc:
            raise _normalize_file_error(exc) from exc

    async def upload_file(self, request: WorkspaceUploadRequest) -> WorkspaceUploadResponse:
        uploader = self.file_uploader
        if uploader is None:
            raise WorkspaceFileError(
                "agent_stub_upload_unavailable", "Agent Stub file upload is not configured", status_code=503
            )
        try:
            async with open_runtime_lease(self.execution_bindings, request.backend_binding_ref) as lease:
                result = await lease.files.read_bytes(path=request.path, max_bytes=self.upload_max_bytes)
            filename = PurePosixPath(result.path).name or "file"
            mimetype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            uploaded_file = await uploader.upload(
                execution_context=request.execution_context,
                filename=filename,
                mimetype=mimetype,
                content=result.content,
            )
            return WorkspaceUploadResponse(path=result.path, file=uploaded_file)
        except WorkspaceFileError:
            raise
        except Exception as exc:
            raise _normalize_file_error(exc) from exc


def _normalize_file_error(exc: Exception) -> WorkspaceFileError:
    if isinstance(exc, WorkspaceFileError):
        return exc
    if isinstance(exc, WorkspacePathError):
        return WorkspaceFileError("invalid_workspace_path", str(exc), status_code=400)
    if isinstance(exc, WorkspaceFileTooLargeError):
        return WorkspaceFileError("file_too_large", str(exc), status_code=413)
    if isinstance(exc, BindingLostError):
        return WorkspaceFileError("binding_not_found", str(exc), status_code=404)
    if isinstance(exc, (WorkspaceUnavailableError, BindingAcquireError)):
        return WorkspaceFileError("workspace_unavailable", str(exc), status_code=502)
    return WorkspaceFileError("workspace_file_failed", str(exc), status_code=502)


__all__ = [
    "AgentStubWorkspaceFileUploader",
    "WorkspaceFileError",
    "WorkspaceFileService",
    "WorkspaceFileUploader",
]
