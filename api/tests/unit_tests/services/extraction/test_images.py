from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from services.entities.upload_file import CreatedUploadArtifact, UploadFileRecord
from services.extraction.contracts import ExtractedImage
from services.extraction.images import ExtractionImageWriter


@dataclass
class _ImageFileStore:
    calls: list[tuple[Session, UploadFileRecord]] = field(default_factory=list)

    def save_created_upload_file_in_session(self, session: Session, *, file: UploadFileRecord) -> None:
        self.calls.append((session, file))


@dataclass
class _BlobStore:
    error: Exception | None = None
    before_save: Callable[[], None] | None = None
    calls: list[tuple[str, bytes]] = field(default_factory=list)

    def save(self, key: str, content: bytes) -> None:
        if self.before_save is not None:
            self.before_save()
        self.calls.append((key, content))
        if self.error is not None:
            raise self.error


def _writer(
    *,
    session: Session,
    files: _ImageFileStore,
    save_blob: _BlobStore,
    artifacts: list[CreatedUploadArtifact],
) -> ExtractionImageWriter:
    return ExtractionImageWriter(
        session=session,
        files=files,
        tenant_id="tenant-1",
        user_id="user-1",
        storage_type="local",
        files_url="https://files.example.test/",
        save_blob=save_blob.save,
        on_artifact_created=artifacts.append,
        clock=lambda: datetime(2026, 1, 2, tzinfo=UTC),
    )


def test_writer_registers_compensation_evidence_before_publishing(sqlite_session: Session) -> None:
    files = _ImageFileStore()
    save_blob = _BlobStore()
    artifacts: list[CreatedUploadArtifact] = []
    writer = _writer(session=sqlite_session, files=files, save_blob=save_blob, artifacts=artifacts)

    def assert_artifact_registered() -> None:
        assert artifacts == list(writer.created_upload_artifacts)
        assert len(artifacts) == 1

    save_blob.before_save = assert_artifact_registered
    reference = writer.write(ExtractedImage(content=b"image-content", extension=".PNG", mime_type="image/png"))

    assert reference.preview_url == f"https://files.example.test/files/{artifacts[0].id}/file-preview"
    assert save_blob.calls == [(artifacts[0].key, b"image-content")]
    [(saved_session, record)] = files.calls
    assert saved_session is sqlite_session
    assert isinstance(record, UploadFileRecord)
    assert record.id == artifacts[0].id
    assert record.key == artifacts[0].key
    assert record.tenant_id == "tenant-1"
    assert record.created_by == "user-1"
    assert record.extension == "png"
    assert record.mime_type == "image/png"
    assert record.size == len(b"image-content")
    assert record.used is True


def test_writer_keeps_artifact_when_blob_result_is_unknown(sqlite_session: Session) -> None:
    files = _ImageFileStore()
    save_blob = _BlobStore(error=RuntimeError("storage response lost"))
    artifacts: list[CreatedUploadArtifact] = []
    writer = _writer(session=sqlite_session, files=files, save_blob=save_blob, artifacts=artifacts)

    with pytest.raises(RuntimeError, match="storage response lost"):
        writer.write(ExtractedImage(content=b"image-content", extension="png", mime_type="image/png"))

    assert tuple(artifacts) == writer.created_upload_artifacts
    assert len(artifacts) == 1
    assert files.calls == []
