import hashlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Literal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Connection, Engine, event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from core.file.uploads import FileUploadActor, FileUploadResult
from models.enums import CreatorUserRole
from models.model import UploadFile
from repositories.file_repository import SQLAlchemyFileRepository
from services.errors.file import BlockedFileExtensionError, FileTooLargeError, UnsupportedFileTypeError
from services.file_upload_service import FileUploadService


@dataclass
class _Storage:
    active_transactions: set[Connection]
    events: list[str]
    saved: dict[str, bytes] = field(default_factory=dict)
    failure: Exception | None = None

    def save(self, filename: str, data: bytes, /) -> None:
        assert not self.active_transactions
        self.events.append("storage")
        if self.failure is not None:
            raise self.failure
        self.saved[filename] = data


@dataclass
class _Harness:
    uploads: FileUploadService
    storage: _Storage
    actor: FileUploadActor
    tenant_id: str
    events: list[str]
    active_transactions: set[Connection]
    signing_failure: Exception | None = None

    def upload(
        self,
        *,
        filename: str = "Report.TXT",
        content: bytes = b"content",
        mimetype: str = "text/plain",
        source: Literal["datasets"] | None = None,
        source_url: str = "",
    ) -> FileUploadResult:
        return self.uploads.upload_file_for_actor(
            actor=self.actor,
            resource_tenant_id=self.tenant_id,
            filename=filename,
            content=content,
            mimetype=mimetype,
            source=source,
            source_url=source_url,
        )


@pytest.fixture
def harness(sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]) -> Iterator[_Harness]:
    events: list[str] = []
    active_transactions: set[Connection] = set()
    storage = _Storage(active_transactions=active_transactions, events=events)

    def sign(*, upload_file_id: str) -> str:
        assert not active_transactions
        events.append("sign")
        if state.signing_failure is not None:
            raise state.signing_failure
        return f"https://files.example.com/{upload_file_id}?sign=test"

    state = _Harness(
        uploads=FileUploadService(
            uploads=SQLAlchemyFileRepository(session_factory=sqlite_session_factory),
            storage=storage,
            storage_type="opendal",
            sign_file_url=sign,
        ),
        storage=storage,
        actor=FileUploadActor(id=str(uuid4()), creator_role=CreatorUserRole.ACCOUNT),
        tenant_id=str(uuid4()),
        events=events,
        active_transactions=active_transactions,
    )

    def begin(connection: Connection) -> None:
        active_transactions.add(connection)
        events.append("begin")

    def commit(connection: Connection) -> None:
        active_transactions.remove(connection)
        events.append("commit")

    def rollback(connection: Connection) -> None:
        active_transactions.remove(connection)
        events.append("rollback")

    event.listen(sqlite_engine, "begin", begin)
    event.listen(sqlite_engine, "commit", commit)
    event.listen(sqlite_engine, "rollback", rollback)
    try:
        yield state
    finally:
        event.remove(sqlite_engine, "begin", begin)
        event.remove(sqlite_engine, "commit", commit)
        event.remove(sqlite_engine, "rollback", rollback)


@pytest.mark.parametrize("role", [CreatorUserRole.ACCOUNT, CreatorUserRole.END_USER])
@pytest.mark.parametrize("source_url", ["", "https://source.example.com/report.txt"])
@pytest.mark.parametrize(("filename", "mimetype"), [("Report.TXT", "text/plain"), ("photo.jpg", "image/jpeg")])
def test_upload_persists_owner_and_creator_before_signing_response_only_url(
    harness: _Harness,
    sqlite_session_factory: sessionmaker[Session],
    role: CreatorUserRole,
    source_url: str,
    filename: str,
    mimetype: str,
) -> None:
    harness.actor = FileUploadActor(id=harness.actor.id, creator_role=role)
    result = harness.upload(filename=filename, mimetype=mimetype, source_url=source_url)

    expected_url = source_url or f"https://files.example.com/{result.id}?sign=test"
    assert result.source_url == expected_url
    assert result.created_by == harness.actor.id
    assert result.created_by_role == role
    assert result.tenant_id == harness.tenant_id
    assert result.hash == hashlib.sha3_256(b"content").hexdigest()
    assert result.storage_type == "opendal"
    assert result.used is False
    assert result.used_by is result.used_at is None
    assert result.name == filename
    assert result.extension == PurePosixPath(filename).suffix.removeprefix(".").lower()
    assert result.mime_type == mimetype
    assert result.size == 7
    assert harness.storage.saved == {result.key: b"content"}
    assert result.key.startswith(f"upload_files/{harness.tenant_id}/")
    assert UUID(PurePosixPath(result.key).stem).version == 4
    assert PurePosixPath(result.key).stem != result.id
    assert harness.events == ["storage", "begin", "commit"] + ([] if source_url else ["sign"])

    with sqlite_session_factory() as session:
        persisted = session.scalars(select(UploadFile)).one()
        assert persisted.id == result.id
        assert persisted.source_url == source_url
        assert persisted.key == result.key
        assert persisted.tenant_id == harness.tenant_id
        assert persisted.created_by == harness.actor.id
        assert persisted.created_by_role == role


@pytest.mark.parametrize(
    ("text", "text_name", "expected_name"),
    [
        ("ASCII text", "test.txt", "test.txt"),
        ("包含多字节 UTF-8 文本 🚀", "test.txt", "test.txt"),
        ("text", "a" * 210, "a" * 200),
    ],
)
def test_text_offload_persists_used_utf8_metadata_without_upload_policy_or_signing(
    harness: _Harness,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    text: str,
    text_name: str,
    expected_name: str,
) -> None:
    config_overrides(UPLOAD_FILE_SIZE_LIMIT=0, inner_UPLOAD_FILE_EXTENSION_BLACKLIST="txt")
    harness.signing_failure = AssertionError("Internal text offloads must not request signed URLs")

    result = harness.uploads.upload_text(
        text=text,
        text_name=text_name,
        user_id=harness.actor.id,
        tenant_id=harness.tenant_id,
    )

    content = text.encode("utf-8")
    assert result.name == expected_name
    assert result.size == len(content)
    assert result.tenant_id == harness.tenant_id
    assert result.created_by == harness.actor.id
    assert result.created_by_role == CreatorUserRole.ACCOUNT
    assert result.used is True
    assert result.used_by == harness.actor.id
    assert result.used_at is not None
    assert result.extension == "txt"
    assert result.mime_type == "text/plain"
    assert result.hash is None
    assert result.source_url == ""
    assert result.key.startswith(f"upload_files/{harness.tenant_id}/")
    assert harness.storage.saved == {result.key: content}
    assert harness.events == ["storage", "begin", "commit"]

    with sqlite_session_factory() as session:
        persisted = session.get(UploadFile, result.id)
        assert persisted is not None
        assert persisted.name == expected_name
        assert persisted.size == len(content)
        assert persisted.tenant_id == harness.tenant_id
        assert persisted.created_by == harness.actor.id
        assert persisted.created_by_role == CreatorUserRole.ACCOUNT
        assert persisted.used is True
        assert persisted.used_by == harness.actor.id
        assert persisted.used_at == result.used_at
        assert persisted.hash is None
        assert persisted.source_url == ""


def test_storage_failure_creates_no_metadata(harness: _Harness, sqlite_session_factory: sessionmaker[Session]) -> None:
    failure = OSError("Storage unavailable")
    harness.storage.failure = failure

    with pytest.raises(OSError) as raised:
        harness.upload()

    assert raised.value is failure
    assert harness.events == ["storage"]
    with sqlite_session_factory() as session:
        assert session.scalar(select(UploadFile)) is None


def test_database_failure_preserves_existing_storage_orphan_behavior(
    harness: _Harness, sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TRIGGER fail_upload BEFORE INSERT ON upload_files "
            "BEGIN SELECT RAISE(FAIL, 'Metadata commit failed'); END;"
        )
    harness.events.clear()
    with pytest.raises(IntegrityError, match="Metadata commit failed"):
        harness.upload()

    assert len(harness.storage.saved) == 1
    assert harness.events == ["storage", "begin", "rollback"]
    assert not harness.active_transactions
    with sqlite_session_factory() as session:
        assert session.scalar(select(UploadFile)) is None


def test_signing_failure_leaves_committed_upload(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session]
) -> None:
    failure = RuntimeError("Signing unavailable")
    harness.signing_failure = failure

    with pytest.raises(RuntimeError) as raised:
        harness.upload()

    assert raised.value is failure
    assert harness.events == ["storage", "begin", "commit", "sign"]
    with sqlite_session_factory() as session:
        persisted = session.scalars(select(UploadFile)).one()
        assert persisted.source_url == ""
        assert harness.storage.saved == {persisted.key: b"content"}


@pytest.mark.parametrize("filename", ["dir/file.exe", "dir\\file.exe"])
def test_filename_validation_precedes_extension_and_size_rules(
    harness: _Harness, config_overrides: Callable[..., None], filename: str
) -> None:
    config_overrides(inner_UPLOAD_FILE_EXTENSION_BLACKLIST="exe", UPLOAD_FILE_SIZE_LIMIT=0)
    with pytest.raises(ValueError, match="Filename contains invalid characters"):
        harness.upload(filename=filename, source="datasets")
    assert harness.events == []


def test_blocked_extension_precedes_dataset_and_size_rules(
    harness: _Harness, config_overrides: Callable[..., None]
) -> None:
    config_overrides(inner_UPLOAD_FILE_EXTENSION_BLACKLIST="exe", UPLOAD_FILE_SIZE_LIMIT=0)
    with pytest.raises(BlockedFileExtensionError, match="File extension '.exe' is not allowed"):
        harness.upload(filename="file.EXE", source="datasets")
    assert harness.events == []


def test_dataset_extension_rejection_precedes_size_check(
    harness: _Harness, config_overrides: Callable[..., None]
) -> None:
    config_overrides(UPLOAD_IMAGE_FILE_SIZE_LIMIT=0)
    with pytest.raises(UnsupportedFileTypeError):
        harness.upload(filename="image.jpg", source="datasets")
    assert harness.events == []


@pytest.mark.parametrize("filename", ["report.txt", "image.jpg", "movie.mp4", "recording.mp3"])
def test_size_failure_precedes_storage(harness: _Harness, config_overrides: Callable[..., None], filename: str) -> None:
    config_overrides(
        UPLOAD_FILE_SIZE_LIMIT=0,
        UPLOAD_IMAGE_FILE_SIZE_LIMIT=0,
        UPLOAD_VIDEO_FILE_SIZE_LIMIT=0,
        UPLOAD_AUDIO_FILE_SIZE_LIMIT=0,
    )
    with pytest.raises(FileTooLargeError):
        harness.upload(filename=filename)
    assert harness.events == []


@pytest.mark.parametrize(
    ("filename", "expected_name", "extension"),
    [("a" * 210 + ".part.TXT", "a" * 200 + ".txt", "txt"), ("without-extension", "without-extension", "")],
)
def test_empty_file_preserves_filename_normalization_and_extension(
    harness: _Harness,
    config_overrides: Callable[..., None],
    filename: str,
    expected_name: str,
    extension: str,
) -> None:
    config_overrides(UPLOAD_FILE_SIZE_LIMIT=0)
    result = harness.upload(filename=filename, content=b"")
    assert result.name == expected_name
    assert result.extension == extension
    assert result.size == 0
    assert result.key.endswith("." + extension)
    assert result.hash == hashlib.sha3_256(b"").hexdigest()


@pytest.mark.parametrize(("extension", "expected_mb"), [("jpg", 2), ("mp4", 3), ("mp3", 4), ("txt", 7)])
def test_context_size_override_preserves_media_limits_and_inclusive_boundary(
    config_overrides: Callable[..., None], extension: str, expected_mb: int
) -> None:
    config_overrides(
        UPLOAD_FILE_SIZE_LIMIT=5,
        UPLOAD_IMAGE_FILE_SIZE_LIMIT=2,
        UPLOAD_VIDEO_FILE_SIZE_LIMIT=3,
        UPLOAD_AUDIO_FILE_SIZE_LIMIT=4,
    )
    limit = expected_mb * 1024 * 1024
    assert FileUploadService.file_size_limit(extension=extension, default_file_size_limit=7) == limit
    assert FileUploadService.is_file_size_within_limit(extension=extension, file_size=limit, default_file_size_limit=7)
    assert not FileUploadService.is_file_size_within_limit(
        extension=extension, file_size=limit + 1, default_file_size_limit=7
    )


def test_is_file_size_within_limit(config_overrides: Callable[..., None]) -> None:
    config_overrides(
        UPLOAD_IMAGE_FILE_SIZE_LIMIT=10,
        UPLOAD_VIDEO_FILE_SIZE_LIMIT=20,
        UPLOAD_AUDIO_FILE_SIZE_LIMIT=30,
        UPLOAD_FILE_SIZE_LIMIT=5,
    )
    # Image
    assert FileUploadService.is_file_size_within_limit(extension="jpg", file_size=10 * 1024 * 1024) is True
    assert FileUploadService.is_file_size_within_limit(extension="png", file_size=11 * 1024 * 1024) is False

    # Video
    assert FileUploadService.is_file_size_within_limit(extension="mp4", file_size=20 * 1024 * 1024) is True
    assert FileUploadService.is_file_size_within_limit(extension="avi", file_size=21 * 1024 * 1024) is False

    # Audio
    assert FileUploadService.is_file_size_within_limit(extension="mp3", file_size=30 * 1024 * 1024) is True
    assert FileUploadService.is_file_size_within_limit(extension="wav", file_size=31 * 1024 * 1024) is False

    # Default
    assert FileUploadService.is_file_size_within_limit(extension="txt", file_size=5 * 1024 * 1024) is True
    assert FileUploadService.is_file_size_within_limit(extension="pdf", file_size=6 * 1024 * 1024) is False
    assert FileUploadService.is_file_size_within_limit(extension="txt", file_size=0, default_file_size_limit=0) is True
    assert FileUploadService.is_file_size_within_limit(extension="txt", file_size=1, default_file_size_limit=0) is False
    assert (
        FileUploadService.is_file_size_within_limit(
            extension="pdf",
            file_size=6 * 1024 * 1024,
            default_file_size_limit=7,
        )
        is True
    )
    assert (
        FileUploadService.is_file_size_within_limit(
            extension="pdf",
            file_size=8 * 1024 * 1024,
            default_file_size_limit=7,
        )
        is False
    )

    # Media-specific limits are not affected by the knowledge document override.
    assert (
        FileUploadService.is_file_size_within_limit(
            extension="jpg",
            file_size=11 * 1024 * 1024,
            default_file_size_limit=100,
        )
        is False
    )


def test_file_size_limit(config_overrides: Callable[..., None]) -> None:
    config_overrides(
        UPLOAD_IMAGE_FILE_SIZE_LIMIT=10,
        UPLOAD_VIDEO_FILE_SIZE_LIMIT=20,
        UPLOAD_AUDIO_FILE_SIZE_LIMIT=30,
        UPLOAD_FILE_SIZE_LIMIT=5,
    )

    assert FileUploadService.file_size_limit(extension="jpg") == 10 * 1024 * 1024
    assert FileUploadService.file_size_limit(extension="mp4") == 20 * 1024 * 1024
    assert FileUploadService.file_size_limit(extension="mp3") == 30 * 1024 * 1024
    assert FileUploadService.file_size_limit(extension="txt") == 5 * 1024 * 1024
    assert FileUploadService.file_size_limit(extension="txt", default_file_size_limit=None) == 5 * 1024 * 1024
    assert FileUploadService.file_size_limit(extension="txt", default_file_size_limit=0) == 0
    assert FileUploadService.file_size_limit(extension="jpg", default_file_size_limit=0) == 10 * 1024 * 1024
    assert FileUploadService.file_size_limit(extension="txt", default_file_size_limit=7) == 7 * 1024 * 1024
