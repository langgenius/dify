"""Read files that were explicitly persisted as part of one workflow run."""

from collections.abc import Iterator
from typing import NamedTuple, Protocol


class WorkflowRunFileNotFoundError(LookupError):
    """The workflow run does not exist in the authenticated app."""


class WorkflowRunFileNotReferencedError(LookupError):
    """The workflow run does not reference the requested file."""


class WorkflowRunFileAccessDeniedError(PermissionError):
    """The referenced file does not belong to the authenticated app/run owner."""


class WorkflowRunFileNotRetainedError(LookupError):
    """The run references the file, but its database row or stored bytes are gone."""


class WorkflowRunFileRecord(NamedTuple):
    key: str
    name: str
    size: int
    extension: str
    mime_type: str | None


class WorkflowRunFileQuery(Protocol):
    def get_for_run(
        self,
        *,
        file_id: str,
        run_id: str,
        app_id: str,
        tenant_id: str,
    ) -> WorkflowRunFileRecord: ...


class WorkflowRunFileStorage(Protocol):
    def exists(self, filename: str) -> bool: ...

    def load_stream(self, filename: str) -> Iterator[bytes]: ...


class WorkflowRunFileDownload(NamedTuple):
    content: Iterator[bytes]
    file: WorkflowRunFileRecord


class WorkflowRunFileDownloadService:
    """Authorize a file by its persisted reference from a tenant/app-scoped run."""

    def __init__(self, *, files: WorkflowRunFileQuery, storage: WorkflowRunFileStorage) -> None:
        self._files = files
        self._storage = storage

    def get_file(
        self,
        *,
        file_id: str,
        run_id: str,
        app_id: str,
        tenant_id: str,
    ) -> WorkflowRunFileDownload:
        file = self._files.get_for_run(
            file_id=file_id,
            run_id=run_id,
            app_id=app_id,
            tenant_id=tenant_id,
        )
        if not self._storage.exists(file.key):
            raise WorkflowRunFileNotRetainedError(file_id)
        return WorkflowRunFileDownload(content=self._storage.load_stream(file.key), file=file)
