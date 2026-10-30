"""Integration coverage for FileService persistence and compensation boundaries."""

from __future__ import annotations

import hashlib
from collections.abc import Iterator
from dataclasses import dataclass, field
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from enums.creator import CreatorUserRole
from models.model import UploadFile
from services import file_adapters
from services.entities.upload_file import FileUploadActor, UploadFileRecord
from services.errors.file import FileNotExistsError, FileTooLargeError, UnsupportedFileTypeError
from services.file_service import FileService


@dataclass
class _Storage:
    blobs: dict[str, bytes] = field(default_factory=dict)
    saved: list[tuple[str, bytes]] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    fail_after_save: bool = False

    def save(self, filename: str, data: bytes) -> None:
        self.blobs[filename] = data
        self.saved.append((filename, data))
        if self.fail_after_save:
            raise OSError("storage response lost")

    def load_once(self, filename: str) -> bytes:
        return self.blobs[filename]

    def load_stream(self, filename: str) -> Iterator[bytes]:
        return iter((self.blobs[filename],))

    def generate_presigned_url(self, filename: str, *, expires_in: int, content_type: str | None = None) -> str:
        del expires_in, content_type
        return f"https://storage.example/{filename}"

    def delete(self, filename: str) -> None:
        self.deleted.append(filename)
        self.blobs.pop(filename, None)


@dataclass
class _Signer:
    calls: list[str] = field(default_factory=list)

    def __call__(self, *, upload_file_id: str) -> str:
        self.calls.append(upload_file_id)
        return f"https://files.example/{upload_file_id}"


@dataclass
class _Extractor:
    content: str = "extracted text"
    calls: list[UploadFileRecord] = field(default_factory=list)

    def __call__(self, file: UploadFileRecord) -> str:
        self.calls.append(file)
        return self.content


@dataclass(frozen=True)
class _Harness:
    service: FileService
    storage: _Storage
    signer: _Signer
    extractor: _Extractor
    sessions: sessionmaker[Session]


class _CommitOutcomeUnknownSession(Session):
    pass


def _build_harness(
    monkeypatch: pytest.MonkeyPatch,
    sessions: sessionmaker[Session],
    *,
    storage: _Storage | None = None,
) -> _Harness:
    storage = storage or _Storage()
    signer = _Signer()
    extractor = _Extractor()
    monkeypatch.setattr(file_adapters, "storage", storage)
    monkeypatch.setattr(file_adapters.file_helpers, "get_signed_file_url", signer)
    monkeypatch.setattr(file_adapters, "_extract_text", extractor)
    return _Harness(
        service=file_adapters.build_file_service(session_factory=sessions),
        storage=storage,
        signer=signer,
        extractor=extractor,
        sessions=sessions,
    )


@pytest.fixture
def file_service_harness(
    monkeypatch: pytest.MonkeyPatch,
    db_session_with_containers: Session,
) -> _Harness:
    return _build_harness(
        monkeypatch,
        sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False),
    )


@pytest.mark.parametrize("creator_role", [CreatorUserRole.ACCOUNT, CreatorUserRole.END_USER])
def test_upload_persists_explicit_tenant_and_creator_owner(
    file_service_harness: _Harness,
    creator_role: CreatorUserRole,
) -> None:
    tenant_id = str(uuid4())
    actor = FileUploadActor(id=str(uuid4()), creator_role=creator_role)
    content = b"file contents"

    result = file_service_harness.service.upload_file(
        actor=actor,
        tenant_id=tenant_id,
        filename="Guide.PDF",
        content=content,
        mimetype="application/pdf",
    )

    with file_service_harness.sessions() as verification:
        persisted = verification.get(UploadFile, result.id)
        assert persisted is not None
        assert persisted.tenant_id == tenant_id
        assert persisted.created_by == actor.id
        assert persisted.created_by_role == creator_role
        assert persisted.name == "Guide.PDF"
        assert persisted.extension == "pdf"
        assert persisted.hash == hashlib.sha3_256(content).hexdigest()
    assert file_service_harness.storage.blobs[result.key] == content
    assert result.source_url == f"https://files.example/{result.id}"
    assert file_service_harness.signer.calls == [result.id]


def test_upload_text_persists_used_owner_metadata(file_service_harness: _Harness) -> None:
    tenant_id = str(uuid4())
    actor = FileUploadActor(id=str(uuid4()), creator_role=CreatorUserRole.ACCOUNT)

    result = file_service_harness.service.upload_text(
        actor=actor,
        tenant_id=tenant_id,
        text="文档 🚀",
        text_name="generated.txt",
    )

    with file_service_harness.sessions() as verification:
        persisted = verification.get(UploadFile, result.id)
        assert persisted is not None
        assert persisted.used is True
        assert persisted.used_by == actor.id
        assert persisted.used_at is not None
        assert persisted.hash is None
    assert file_service_harness.storage.blobs[result.key] == "文档 🚀".encode()


@pytest.mark.parametrize(("tenant_id", "actor_id"), [("", "actor-id"), ("tenant-id", "")])
def test_upload_rejects_missing_owner_before_side_effects(
    file_service_harness: _Harness,
    tenant_id: str,
    actor_id: str,
) -> None:
    with pytest.raises(ValueError, match="tenant and creator identity"):
        file_service_harness.service.upload_file(
            actor=FileUploadActor(id=actor_id, creator_role=CreatorUserRole.ACCOUNT),
            tenant_id=tenant_id,
            filename="guide.txt",
            content=b"contents",
            mimetype="text/plain",
        )

    assert file_service_harness.storage.saved == []
    with file_service_harness.sessions() as verification:
        assert verification.scalar(select(func.count()).select_from(UploadFile)) == 0


def test_storage_failure_compensates_blob_without_publishing_metadata(
    file_service_harness: _Harness,
) -> None:
    file_service_harness.storage.fail_after_save = True

    with pytest.raises(OSError, match="storage response lost"):
        file_service_harness.service.upload_file(
            actor=FileUploadActor(id=str(uuid4()), creator_role=CreatorUserRole.ACCOUNT),
            tenant_id=str(uuid4()),
            filename="guide.txt",
            content=b"contents",
            mimetype="text/plain",
        )

    [(key, _)] = file_service_harness.storage.saved
    assert file_service_harness.storage.deleted == [key]
    assert key not in file_service_harness.storage.blobs
    with file_service_harness.sessions() as verification:
        assert verification.scalar(select(func.count()).select_from(UploadFile)) == 0


def test_committed_metadata_is_preserved_when_commit_outcome_is_reported_unknown(
    monkeypatch: pytest.MonkeyPatch,
    db_session_with_containers: Session,
) -> None:
    engine = db_session_with_containers.get_bind()
    unknown_sessions: sessionmaker[Session] = sessionmaker(
        bind=engine,
        class_=_CommitOutcomeUnknownSession,
        expire_on_commit=False,
    )
    harness = _build_harness(monkeypatch, unknown_sessions)

    def report_unknown_outcome(_session: Session) -> None:
        raise RuntimeError("commit outcome unknown")

    event.listen(_CommitOutcomeUnknownSession, "after_commit", report_unknown_outcome)
    try:
        with pytest.raises(RuntimeError, match="commit outcome unknown"):
            harness.service.upload_file(
                actor=FileUploadActor(id=str(uuid4()), creator_role=CreatorUserRole.ACCOUNT),
                tenant_id=str(uuid4()),
                filename="guide.txt",
                content=b"contents",
                mimetype="text/plain",
            )
    finally:
        event.remove(_CommitOutcomeUnknownSession, "after_commit", report_unknown_outcome)

    [(key, _)] = harness.storage.saved
    assert harness.storage.deleted == []
    assert harness.storage.blobs[key] == b"contents"
    with Session(bind=engine) as verification:
        persisted = verification.scalar(select(UploadFile).where(UploadFile.key == key))
        assert persisted is not None


def test_file_reads_are_tenant_scoped_and_preview_uses_persisted_record(
    file_service_harness: _Harness,
) -> None:
    tenant_id = str(uuid4())
    result = file_service_harness.service.upload_file(
        actor=FileUploadActor(id=str(uuid4()), creator_role=CreatorUserRole.ACCOUNT),
        tenant_id=tenant_id,
        filename="manual.pdf",
        content=b"pdf",
        mimetype="application/pdf",
    )
    file_service_harness.extractor.content = "x" * 4000

    assert file_service_harness.service.get_file_preview(result.id, tenant_id) == "x" * 3000
    [extracted] = file_service_harness.extractor.calls
    assert extracted.id == result.id
    assert extracted.tenant_id == tenant_id
    with pytest.raises(FileNotExistsError, match="File not found"):
        file_service_harness.service.get_file(tenant_id=str(uuid4()), file_id=result.id)


def test_upload_policy_rejects_invalid_source_before_persistence(file_service_harness: _Harness) -> None:
    actor = FileUploadActor(id=str(uuid4()), creator_role=CreatorUserRole.ACCOUNT)
    tenant_id = str(uuid4())

    with pytest.raises(ValueError, match="invalid characters"):
        file_service_harness.service.upload_file(
            actor=actor,
            tenant_id=tenant_id,
            filename="directory/guide.txt",
            content=b"contents",
            mimetype="text/plain",
        )
    with pytest.raises(UnsupportedFileTypeError):
        file_service_harness.service.upload_file(
            actor=actor,
            tenant_id=tenant_id,
            filename="guide.jpg",
            content=b"contents",
            mimetype="image/jpeg",
            allowed_extensions=frozenset({"pdf"}),
        )
    with pytest.raises(FileTooLargeError):
        file_service_harness.service.upload_file(
            actor=actor,
            tenant_id=tenant_id,
            filename="guide.txt",
            content=b"x",
            mimetype="text/plain",
            default_file_size_limit=0,
        )

    assert file_service_harness.storage.saved == []
