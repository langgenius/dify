"""Allocate signed file URIs for the Dify Agent CLI control plane.

The Agent endpoints authorize and sign file access but deliberately do not
choose the Sandbox network origin. Dify-owned transfer requests return
``/files/...`` URIs; dify-agent binds those URIs to the deployment-specific
Sandbox file base URL before responding to the CLI.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import DatabaseFileAccessController, FileAccessScope, bind_file_access_scope
from core.app.workflow.file_runtime import DifyWorkflowFileRuntime
from core.tools.signature import get_signed_file_uri_for_plugin
from factories.file_factory.builders import build_from_mapping
from graphon.file import File


class AgentFileRequestError(Exception):
    """An Agent file request failure suitable for controller translation."""

    code: str
    message: str
    status_code: int

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True, slots=True)
class AgentFileDownloadRequestResult:
    """Metadata and URI allocated for one Agent CLI download request."""

    filename: str
    mime_type: str | None
    size: int
    download_uri: str


class AgentFileRequestService:
    """Authorize Agent CLI file requests and allocate signed URIs."""

    _access_controller: DatabaseFileAccessController
    _runtime: DifyWorkflowFileRuntime

    def __init__(self, access_controller: DatabaseFileAccessController | None = None) -> None:
        self._access_controller = access_controller or DatabaseFileAccessController()
        self._runtime = DifyWorkflowFileRuntime(file_access_controller=self._access_controller)

    def request_upload_uri(
        self,
        *,
        filename: str,
        mimetype: str,
        tenant_id: str,
        user_id: str,
        conversation_id: str | None = None,
    ) -> str:
        """Allocate an origin-free signed URI for one ToolFile upload."""

        return get_signed_file_uri_for_plugin(
            filename=filename,
            mimetype=mimetype,
            tenant_id=tenant_id,
            user_id=user_id,
            conversation_id=conversation_id,
        )

    def request_download_uri(
        self,
        *,
        tenant_id: str,
        user_id: str,
        user_from: UserFrom | str,
        invoke_from: InvokeFrom | str,
        file_mapping: Mapping[str, Any],
        for_external: bool,
    ) -> AgentFileDownloadRequestResult:
        """Allocate a Sandbox transfer URI or frontend presentation URL.

        ``for_external=False`` returns an origin-free URI for Dify-owned files.
        ``for_external=True`` preserves the established frontend URL behavior,
        including a relative URI when ``FILES_URL`` is empty. Explicit remote
        URLs remain absolute for either audience.
        """

        try:
            scope = FileAccessScope(
                tenant_id=tenant_id,
                user_id=user_id,
                user_from=user_from if isinstance(user_from, UserFrom) else UserFrom(user_from),
                invoke_from=invoke_from if isinstance(invoke_from, InvokeFrom) else InvokeFrom(invoke_from),
            )
        except ValueError as exc:
            raise AgentFileRequestError("invalid_access_context", str(exc), status_code=400) from exc

        try:
            with bind_file_access_scope(scope):
                file = self._build_file(mapping=file_mapping, tenant_id=tenant_id)
                if for_external:
                    download_uri = self._runtime.resolve_file_url(file=file, for_external=True)
                else:
                    download_uri = self._runtime.resolve_file_uri(file=file)
        except ValueError as exc:
            raise AgentFileRequestError("file_not_accessible", str(exc), status_code=404) from exc

        if not download_uri:
            raise AgentFileRequestError(
                "download_uri_unavailable",
                "could not resolve a download URI for the file",
                status_code=502,
            )
        return AgentFileDownloadRequestResult(
            filename=file.filename or "download.bin",
            mime_type=file.mime_type,
            size=file.size,
            download_uri=download_uri,
        )

    def _build_file(self, *, mapping: Mapping[str, Any], tenant_id: str) -> File:
        return build_from_mapping(
            mapping=mapping,
            tenant_id=tenant_id,
            access_controller=self._access_controller,
        )


__all__ = [
    "AgentFileDownloadRequestResult",
    "AgentFileRequestError",
    "AgentFileRequestService",
]
