from collections.abc import Iterator

import pytest

from services.workflow_run_file_download_service import (
    WorkflowRunFileDownloadService,
    WorkflowRunFileNotRetainedError,
    WorkflowRunFileRecord,
)


class _Files:
    def __init__(self, file: WorkflowRunFileRecord) -> None:
        self.file = file
        self.calls: list[dict[str, str]] = []

    def get_for_run(self, **kwargs: str) -> WorkflowRunFileRecord:
        self.calls.append(kwargs)
        return self.file


class _Storage:
    def __init__(self, *, retained: bool = True) -> None:
        self.retained = retained
        self.checked: list[str] = []
        self.streamed: list[str] = []

    def exists(self, filename: str) -> bool:
        self.checked.append(filename)
        return self.retained

    def load_stream(self, filename: str) -> Iterator[bytes]:
        self.streamed.append(filename)
        return iter([b"content"])


def _record() -> WorkflowRunFileRecord:
    return WorkflowRunFileRecord(
        key="upload_files/tenant/file.pdf",
        name="file.pdf",
        size=7,
        extension="pdf",
        mime_type="application/pdf",
    )


def test_get_file_checks_reference_query_before_opening_the_storage_stream() -> None:
    files = _Files(_record())
    storage = _Storage()
    service = WorkflowRunFileDownloadService(files=files, storage=storage)

    download = service.get_file(file_id="file-id", run_id="run-id", app_id="app-id", tenant_id="tenant-id")

    assert files.calls == [{"file_id": "file-id", "run_id": "run-id", "app_id": "app-id", "tenant_id": "tenant-id"}]
    assert storage.streamed == [_record().key]
    assert b"".join(download.content) == b"content"


def test_get_file_reports_bytes_removed_without_extending_retention() -> None:
    files = _Files(_record())
    storage = _Storage(retained=False)
    service = WorkflowRunFileDownloadService(files=files, storage=storage)

    with pytest.raises(WorkflowRunFileNotRetainedError):
        service.get_file(file_id="file-id", run_id="run-id", app_id="app-id", tenant_id="tenant-id")

    assert storage.streamed == []
