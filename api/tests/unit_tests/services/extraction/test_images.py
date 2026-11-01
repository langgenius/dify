import hashlib
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from enums.creator import CreatorUserRole
from extensions.ext_storage import storage
from extensions.storage.opendal_storage import OpenDALStorage
from models.model import UploadFile
from repositories.file.upload_file_repository import UploadFileRepository
from services.entities.upload_file import CreatedUploadArtifact, FileUploadActor
from services.extraction.contracts import ExtractedImage
from services.extraction.images import ExtractionImageWriter
from services.file_adapters import build_file_service

TENANT_ID = "tenant-1"
SOURCE_FILE_ID = "source-file-1"
IMAGE = ExtractedImage(content=b"image-content", extension=".PNG", mime_type="image/png", stable_identity="p0_2")


@pytest.fixture
def blobs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> OpenDALStorage:
    backend = OpenDALStorage("fs", root=str(tmp_path))
    monkeypatch.setattr(storage, "storage_runner", backend, raising=False)
    return backend


def _writer(
    session: Session,
    files: UploadFileRepository,
    save_blob: Callable[[str, bytes], None],
    *,
    source_file_id: str | None,
    tenant_id: str = TENANT_ID,
    on_artifact_created: Callable[[CreatedUploadArtifact], None] | None = None,
) -> ExtractionImageWriter:
    return ExtractionImageWriter(
        session=session,
        files=files,
        tenant_id=tenant_id,
        user_id="user-1",
        source_file_id=source_file_id,
        storage_type="opendal",
        files_url="https://files.example.test/",
        save_blob=save_blob,
        on_artifact_created=on_artifact_created,
        clock=lambda: datetime(2026, 1, 2, tzinfo=UTC),
    )


def test_writer_registers_compensation_evidence_before_publishing(
    sqlite_session_factory: sessionmaker[Session], blobs: OpenDALStorage
) -> None:
    files = UploadFileRepository(session_factory=sqlite_session_factory)
    artifacts: list[CreatedUploadArtifact] = []

    def save(key: str, content: bytes) -> None:
        assert artifacts == list(writer.created_upload_artifacts)
        assert len(artifacts) == 1
        assert not blobs.exists(key)
        blobs.save(key, content)

    with sqlite_session_factory() as session:
        writer = _writer(session, files, save, source_file_id=None, on_artifact_created=artifacts.append)
        reference = writer.write(IMAGE)
        session.commit()

    record = files.get_file(tenant_id=TENANT_ID, file_id=artifacts[0].id)
    assert record is not None
    assert reference.preview_url == f"https://files.example.test/files/{record.id}/file-preview"
    assert record.key == artifacts[0].key
    assert record.extension == "png"
    assert record.mime_type == "image/png"
    assert record.size == len(IMAGE.content)
    assert record.created_by == "user-1"
    assert record.used is True
    assert blobs.load_once(record.key) == IMAGE.content


def test_writer_keeps_artifact_when_blob_result_is_unknown(
    sqlite_session_factory: sessionmaker[Session], blobs: OpenDALStorage
) -> None:
    files = UploadFileRepository(session_factory=sqlite_session_factory)

    def save_then_fail(key: str, content: bytes) -> None:
        blobs.save(key, content)
        raise RuntimeError("storage response lost")

    with sqlite_session_factory() as session:
        writer = _writer(session, files, save_then_fail, source_file_id=SOURCE_FILE_ID)
        with pytest.raises(RuntimeError, match="storage response lost"):
            writer.write(IMAGE)
        session.rollback()

    (artifact,) = writer.created_upload_artifacts
    assert files.get_file(tenant_id=TENANT_ID, file_id=artifact.id) is None
    assert blobs.load_once(artifact.key) == IMAGE.content
    build_file_service(session_factory=sqlite_session_factory).delete_uncommitted_artifact(artifact=artifact)
    assert not blobs.exists(artifact.key)


@pytest.mark.parametrize("legacy_key", [False, True])
def test_writer_reuses_source_scoped_image_identity(
    sqlite_session_factory: sessionmaker[Session], blobs: OpenDALStorage, legacy_key: bool
) -> None:
    files = UploadFileRepository(session_factory=sqlite_session_factory)
    with sqlite_session_factory() as session:
        writer = _writer(session, files, blobs.save, source_file_id=SOURCE_FILE_ID)
        reference = writer.write(IMAGE)
        assert writer.write(IMAGE) == reference
        assert len(writer.created_upload_artifacts) == 1
        session.commit()
        (artifact,) = writer.created_upload_artifacts
        row = session.get(UploadFile, artifact.id)
        assert row is not None
        if legacy_key:
            # Before this fix, both name and key contained the stable identity.
            blobs.save(row.name, blobs.load_once(row.key))
            blobs.delete(row.key)
            row.key = row.name
            session.commit()
        key = row.key

    with sqlite_session_factory() as session:
        repeated = _writer(session, files, blobs.save, source_file_id=SOURCE_FILE_ID)
        assert repeated.write(IMAGE) == reference
        assert repeated.created_upload_artifacts == ()
        assert len(session.scalars(select(UploadFile)).all()) == 1
    assert blobs.load_once(key) == IMAGE.content


def test_image_identity_does_not_reuse_an_ordinary_upload_with_the_same_name(
    sqlite_session_factory: sessionmaker[Session], blobs: OpenDALStorage
) -> None:
    files = UploadFileRepository(session_factory=sqlite_session_factory)
    service = build_file_service(session_factory=sqlite_session_factory)
    name = f"image_files/{TENANT_ID}/{SOURCE_FILE_ID}/p0_2_{hashlib.sha256(IMAGE.content).hexdigest()}.png"
    ordinary_file = service.upload_text(
        actor=FileUploadActor(id="user-1", creator_role=CreatorUserRole.ACCOUNT),
        tenant_id=TENANT_ID,
        text="unrelated generated text",
        text_name=name,
    )
    with sqlite_session_factory() as session:
        writer = _writer(session, files, blobs.save, source_file_id=SOURCE_FILE_ID)
        reference = writer.write(IMAGE)
        assert reference.preview_url != f"https://files.example.test/files/{ordinary_file.id}/file-preview"
        (artifact,) = writer.created_upload_artifacts
        assert blobs.load_once(artifact.key) == IMAGE.content
        assert writer.write(IMAGE) == reference
        session.commit()


@pytest.mark.parametrize("commit_before_cleanup", [False, True])
def test_concurrent_extraction_cleanup_preserves_other_committed_image(
    sqlite_session_factory: sessionmaker[Session], blobs: OpenDALStorage, commit_before_cleanup: bool
) -> None:
    files = UploadFileRepository(session_factory=sqlite_session_factory)
    service = build_file_service(session_factory=sqlite_session_factory)
    with sqlite_session_factory() as first_session, sqlite_session_factory() as second_session:
        second = _writer(second_session, files, blobs.save, source_file_id=SOURCE_FILE_ID)

        def save_after_competing_commit(key: str, content: bytes) -> None:
            # Both lookups miss: B publishes after A's lookup but before A stages
            # its upload. This interleaving needs no timing-dependent threads.
            second.write(IMAGE)
            second_session.commit()
            blobs.save(key, content)

        first = _writer(first_session, files, save_after_competing_commit, source_file_id=SOURCE_FILE_ID)
        first.write(IMAGE)
        (first_artifact,) = first.created_upload_artifacts
        (second_artifact,) = second.created_upload_artifacts
        if commit_before_cleanup:
            first_session.commit()
            service.delete_file(tenant_id=TENANT_ID, file_id=first_artifact.id)
        else:
            first_session.rollback()
            service.delete_uncommitted_artifact(artifact=first_artifact)

    assert files.get_file(tenant_id=TENANT_ID, file_id=first_artifact.id) is None
    surviving = files.get_file(tenant_id=TENANT_ID, file_id=second_artifact.id)
    assert surviving is not None
    assert blobs.load_once(surviving.key) == IMAGE.content
    assert first_artifact.key != surviving.key
    assert not blobs.exists(first_artifact.key)


def test_image_reuse_keeps_tenants_sources_and_content_separate(
    sqlite_session_factory: sessionmaker[Session], blobs: OpenDALStorage
) -> None:
    files = UploadFileRepository(session_factory=sqlite_session_factory)
    variants = (
        (TENANT_ID, SOURCE_FILE_ID, IMAGE),
        ("other-tenant", SOURCE_FILE_ID, IMAGE),
        (TENANT_ID, "other-source", IMAGE),
        (
            TENANT_ID,
            SOURCE_FILE_ID,
            ExtractedImage(content=b"changed", extension="png", mime_type="image/png", stable_identity="p0_2"),
        ),
    )
    references = set()
    with sqlite_session_factory() as session:
        for tenant_id, source_file_id, image in variants:
            writer = _writer(session, files, blobs.save, source_file_id=source_file_id, tenant_id=tenant_id)
            references.add(writer.write(image).preview_url)
        session.commit()
        assert len(session.scalars(select(UploadFile)).all()) == len(variants)
    assert len(references) == len(variants)
