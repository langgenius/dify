"""Service helpers for trusted file request control-plane endpoints.

These helpers are used by inner APIs that allocate file access for trusted
external runtimes. They rebuild access-scoped ``graphon.file.File`` values and
return origin-free signed URIs so each transport adapter can select its own
network origin without signing the file twice.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import DatabaseFileAccessController, FileAccessScope, bind_file_access_scope
from core.app.workflow.file_runtime import DifyWorkflowFileRuntime
from factories.file_factory.builders import build_from_mapping
from graphon.file import File


@dataclass(frozen=True, slots=True)
class DownloadFileRequestResult:
    """Resolved metadata and signed URI returned to trusted download callers."""

    filename: str
    mime_type: str | None
    size: int
    download_uri: str


class FileRequestService:
    """Resolve signed download URIs for trusted external file consumers."""

    _access_controller: DatabaseFileAccessController
    _runtime: DifyWorkflowFileRuntime

    def __init__(self, access_controller: DatabaseFileAccessController | None = None) -> None:
        self._access_controller = access_controller or DatabaseFileAccessController()
        self._runtime = DifyWorkflowFileRuntime(file_access_controller=self._access_controller)

    def request_download(
        self,
        *,
        tenant_id: str,
        user_id: str,
        user_from: UserFrom | str,
        invoke_from: InvokeFrom | str,
        file_mapping: Mapping[str, Any],
    ) -> DownloadFileRequestResult:
        """Resolve one file mapping into signed download metadata.

        The request is evaluated under a request-local :class:`FileAccessScope`
        so file-factory reconstruction and URL resolution enforce the same
        tenant/user authorization rules used by workflow runtime execution.
        """

        scope = FileAccessScope(
            tenant_id=tenant_id,
            user_id=user_id,
            user_from=user_from if isinstance(user_from, UserFrom) else UserFrom(user_from),
            invoke_from=invoke_from if isinstance(invoke_from, InvokeFrom) else InvokeFrom(invoke_from),
        )
        with bind_file_access_scope(scope):
            file = self._build_file(mapping=file_mapping, tenant_id=tenant_id)
            download_uri = self._runtime.resolve_file_uri(file=file)

        if not download_uri:
            raise ValueError("file does not support signed download")
        return DownloadFileRequestResult(
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
