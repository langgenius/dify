"""Resolve a download request for a workflow file ref to a signed URL (Agent Files §3.1.1/§4.5).

The dify-agent server calls this on behalf of a sandbox that needs to pull a
``File`` / ``Array[File]`` workflow input. It binds the flattened file-access
context as a ``FileAccessScope``, rebuilds the graphon ``File`` from the mapping
(reusing tenant/user access checks), and returns an internal signed download URL
plus metadata — never the file bytes. The dify-agent server / sandbox then GETs
the URL directly from Dify API.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access.controller import DatabaseFileAccessController
from core.app.file_access.scope import FileAccessScope, bind_file_access_scope
from core.app.workflow.file_runtime import DifyWorkflowFileRuntime
from factories import file_factory


class FileDownloadRequestError(Exception):
    """A download-request failure mapped to an HTTP status by the controller."""

    code: str
    message: str
    status_code: int

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class AgentFileDownloadRequestService:
    """Resolve a workflow file ref to a sandbox-accessible internal signed download URL."""

    @classmethod
    def resolve(
        cls,
        *,
        tenant_id: str,
        user_id: str,
        user_from: str,
        invoke_from: str,
        file_mapping: Mapping[str, Any],
    ) -> dict[str, Any]:
        try:
            scope_user_from = UserFrom(user_from)
            scope_invoke_from = InvokeFrom(invoke_from)
        except ValueError as exc:
            raise FileDownloadRequestError("invalid_access_context", str(exc), status_code=400) from exc

        if not isinstance(file_mapping, Mapping) or not file_mapping.get("transfer_method"):
            raise FileDownloadRequestError("invalid_file_mapping", "file.transfer_method is required", status_code=400)

        scope = FileAccessScope(
            tenant_id=tenant_id,
            user_id=user_id,
            user_from=scope_user_from,
            invoke_from=scope_invoke_from,
        )
        controller = DatabaseFileAccessController()
        runtime = DifyWorkflowFileRuntime(file_access_controller=controller)
        try:
            with bind_file_access_scope(scope):
                file = file_factory.build_from_mapping(
                    mapping=file_mapping,
                    tenant_id=tenant_id,
                    access_controller=controller,
                )
                # Internal URL (for_external=False): the consumer is the agent backend /
                # sandbox, not a browser. Resolves against INTERNAL_FILES_URL, falling
                # back to FILES_URL when not configured.
                download_url = runtime.resolve_file_url(file=file, for_external=False)
        except ValueError as exc:
            raise FileDownloadRequestError("file_not_accessible", str(exc), status_code=404) from exc

        if not download_url:
            raise FileDownloadRequestError(
                "download_url_unavailable", "could not resolve a download URL for the file", status_code=502
            )
        return {
            "filename": file.filename,
            "mime_type": file.mime_type,
            "size": file.size,
            "download_url": download_url,
        }


__all__ = ["AgentFileDownloadRequestService", "FileDownloadRequestError"]
