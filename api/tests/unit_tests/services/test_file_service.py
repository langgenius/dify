from __future__ import annotations

import hashlib
import os
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from zipfile import ZipFile

import httpx
import pytest
from sqlalchemy import Connection, Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from core.file import remote_fetcher
from enums.creator import CreatorUserRole
from extensions.ext_storage import storage
from graphon.file import helpers as file_helpers
from models.model import UploadFile
from services.entities.upload_file import CreatedUploadArtifact, FileUploadActor, UploadFileRecord
from services.errors.file import FileNotExistsError, UnsupportedFileTypeError
from services.file_adapters import build_file_service
from services.file_service import FileService, _dedupe_zip_entry_name, _sanitize_zip_entry_name
from services.file_upload_policy import FileUploadPolicy
from services.remote_file_service import RemoteFileService

NOW = datetime(2025, 1, 2, 3, 4, tzinfo=UTC)
TENANT_ID = "tenant-1"


@dataclass
class _FileStore:
    file: UploadFileRecord | None = None
    save_error: Exception | None = None
    saved: list[UploadFileRecord] = field(default_factory=list)
    reads: list[tuple[str, str]] = field(default_factory=list)

    def save_created_upload_file(self, *, file: UploadFileRecord) -> None:
        if self.save_error is not None:
            raise self.save_error
        self.saved.append(file)

    def get_file(self, *, tenant_id: str, file_id: str) -> UploadFileRecord | None:
        self.reads.append((tenant_id, file_id))
        return self.file

    def get_files(self, *, tenant_id: str, file_ids: Sequence[str]) -> dict[str, UploadFileRecord]:
        del tenant_id
        if self.file is None or self.file.id not in file_ids:
            return {}
        return {self.file.id: self.file}


@dataclass
class _Reclaimer:
    calls: list[tuple[str, tuple[str, ...], Callable[[str], None]]] = field(default_factory=list)

    def delete_unreferenced_files(
        self,
        *,
        tenant_id: str,
        file_ids: Sequence[str],
        delete_blob: Callable[[str], None],
    ) -> tuple[str, ...]:
        self.calls.append((tenant_id, tuple(file_ids), delete_blob))
        return tuple(file_ids)


@dataclass
class _Storage:
    save_error: Exception | None = None
    saved: list[tuple[str, bytes]] = field(default_factory=list)
    content: bytes = b"contents"
    streams: list[list[bytes]] = field(default_factory=list)
    presigned_url: str = "direct-url"
    presigned_calls: list[tuple[str, int, str | None]] = field(default_factory=list)

    def save(self, filename: str, data: bytes) -> None:
        if self.save_error is not None:
            raise self.save_error
        self.saved.append((filename, data))

    def load_once(self, filename: str) -> bytes:
        del filename
        return self.content

    def load_stream(self, filename: str) -> Iterator[bytes]:
        del filename
        return iter(self.streams.pop(0))

    def generate_presigned_url(self, filename: str, *, expires_in: int, content_type: str | None = None) -> str:
        self.presigned_calls.append((filename, expires_in, content_type))
        return self.presigned_url


@dataclass
class _Signer:
    value: str = "signed-url"
    calls: list[str] = field(default_factory=list)

    def __call__(self, *, upload_file_id: str) -> str:
        self.calls.append(upload_file_id)
        return self.value


@dataclass
class _TextExtractor:
    value: str = "preview"
    calls: list[UploadFileRecord] = field(default_factory=list)

    def __call__(self, file: UploadFileRecord) -> str:
        self.calls.append(file)
        return self.value


@dataclass
class _BlobDeleter:
    calls: list[str] = field(default_factory=list)

    def __call__(self, key: str) -> None:
        self.calls.append(key)


@dataclass
class _Dependencies:
    files: _FileStore = field(default_factory=_FileStore)
    reclaimer: _Reclaimer = field(default_factory=_Reclaimer)
    storage: _Storage = field(default_factory=_Storage)
    sign_file: _Signer = field(default_factory=_Signer)
    extract_text: _TextExtractor = field(default_factory=_TextExtractor)
    delete_blob: _BlobDeleter = field(default_factory=_BlobDeleter)


def _actor() -> FileUploadActor:
    return FileUploadActor(id="account-1", creator_role=CreatorUserRole.ACCOUNT)


def _record(
    *,
    file_id: str = "file-1",
    tenant_id: str = TENANT_ID,
    name: str = "file.txt",
    extension: str = "txt",
    source_url: str = "",
) -> UploadFileRecord:
    return UploadFileRecord(
        id=file_id,
        tenant_id=tenant_id,
        storage_type="local",
        key=f"upload_files/{tenant_id}/{file_id}.{extension}",
        name=name,
        size=4,
        extension=extension,
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=NOW,
        hash="hash",
        source_url=source_url,
    )


@pytest.fixture
def dependencies() -> _Dependencies:
    return _Dependencies()


@pytest.fixture
def file_service(dependencies: _Dependencies) -> FileService:
    return FileService(
        files=dependencies.files,
        reclaimer=dependencies.reclaimer,
        storage=dependencies.storage,
        upload_policy=FileUploadPolicy(
            file_size_limit_mib=1,
            image_size_limit_mib=1,
            video_size_limit_mib=1,
            audio_size_limit_mib=1,
            blocked_extensions=frozenset({"exe"}),
        ),
        storage_type="local",
        sign_file=dependencies.sign_file,
        extract_text=dependencies.extract_text,
        delete_blob=dependencies.delete_blob,
        direct_icon_urls=False,
        access_timeout=300,
        clock=lambda: NOW,
    )


def test_upload_file_publishes_detached_metadata_after_blob_write(
    file_service: FileService,
    dependencies: _Dependencies,
) -> None:
    result = file_service.upload_file(
        actor=_actor(),
        tenant_id=TENANT_ID,
        filename="notes.TXT",
        content=b"text",
        mimetype="text/plain",
    )

    assert result.tenant_id == TENANT_ID
    assert result.extension == "txt"
    assert result.hash == hashlib.sha3_256(b"text").hexdigest()
    assert result.source_url == "signed-url"
    assert dependencies.storage.saved == [(result.key, b"text")]
    assert len(dependencies.files.saved) == 1
    assert dependencies.files.saved[0].source_url == ""
    assert dependencies.sign_file.calls == [result.id]


def test_upload_file_preserves_explicit_source_url(
    file_service: FileService,
    dependencies: _Dependencies,
) -> None:
    result = file_service.upload_file(
        actor=_actor(),
        tenant_id=TENANT_ID,
        filename="notes.txt",
        content=b"text",
        mimetype="text/plain",
        source_url="https://source.example/file",
    )

    assert result.source_url == "https://source.example/file"
    assert dependencies.sign_file.calls == []


@pytest.mark.parametrize(("tenant_id", "actor_id"), [("", "account-1"), (TENANT_ID, "")])
def test_upload_file_requires_explicit_tenant_and_creator_identity(
    file_service: FileService,
    dependencies: _Dependencies,
    tenant_id: str,
    actor_id: str,
) -> None:
    with pytest.raises(ValueError, match="tenant and creator identity"):
        file_service.upload_file(
            actor=FileUploadActor(id=actor_id, creator_role=CreatorUserRole.ACCOUNT),
            tenant_id=tenant_id,
            filename="notes.txt",
            content=b"text",
            mimetype="text/plain",
        )

    assert dependencies.storage.saved == []
    assert dependencies.files.saved == []


def test_upload_file_compensates_blob_when_storage_reports_failure(
    file_service: FileService,
    dependencies: _Dependencies,
) -> None:
    dependencies.storage.save_error = OSError("response lost")

    with pytest.raises(OSError, match="response lost"):
        file_service.upload_file(
            actor=_actor(),
            tenant_id=TENANT_ID,
            filename="notes.txt",
            content=b"text",
            mimetype="text/plain",
        )

    [candidate] = dependencies.delete_blob.calls
    assert candidate.startswith(f"upload_files/{TENANT_ID}/")
    assert dependencies.files.saved == []


def test_upload_file_retains_blob_when_metadata_commit_outcome_is_unknown(
    file_service: FileService,
    dependencies: _Dependencies,
) -> None:
    dependencies.files.save_error = RuntimeError("commit outcome unknown")

    with pytest.raises(RuntimeError, match="commit outcome unknown"):
        file_service.upload_file(
            actor=_actor(),
            tenant_id=TENANT_ID,
            filename="notes.txt",
            content=b"text",
            mimetype="text/plain",
        )

    assert len(dependencies.storage.saved) == 1
    assert dependencies.delete_blob.calls == []


def test_upload_text_uses_utf8_bytes_and_marks_record_used(
    file_service: FileService,
    dependencies: _Dependencies,
) -> None:
    result = file_service.upload_text(
        actor=_actor(),
        tenant_id=TENANT_ID,
        text="文档 🚀",
        text_name="generated.txt",
    )

    content = "文档 🚀".encode()
    assert result.size == len(content)
    assert result.used is True
    assert result.used_by == "account-1"
    assert result.used_at == NOW
    assert result.hash is None
    assert dependencies.storage.saved == [(result.key, content)]


def test_get_file_and_content_scope_every_read_to_tenant(
    file_service: FileService,
    dependencies: _Dependencies,
) -> None:
    dependencies.files.file = _record()
    dependencies.storage.content = b"contents"

    assert file_service.get_file_content(tenant_id=TENANT_ID, file_id="file-1") == "contents"
    assert dependencies.files.reads == [(TENANT_ID, "file-1")]


def test_get_file_maps_missing_record_to_service_error(
    file_service: FileService,
    dependencies: _Dependencies,
) -> None:
    dependencies.files.file = None

    with pytest.raises(FileNotExistsError, match="File not found"):
        file_service.get_file(tenant_id=TENANT_ID, file_id="missing")


def test_get_file_preview_validates_extension_and_caps_text(
    file_service: FileService,
    dependencies: _Dependencies,
) -> None:
    record = _record(name="manual.pdf", extension="pdf")
    dependencies.files.file = record
    dependencies.extract_text.value = "x" * 4000

    assert file_service.get_file_preview("file-1", TENANT_ID) == "x" * 3000
    assert dependencies.extract_text.calls == [record]


def test_get_file_preview_rejects_non_document(
    file_service: FileService,
    dependencies: _Dependencies,
) -> None:
    dependencies.files.file = _record(name="program.exe", extension="exe")

    with pytest.raises(UnsupportedFileTypeError):
        file_service.get_file_preview("file-1", TENANT_ID)

    assert dependencies.extract_text.calls == []


def test_get_file_presigned_url_uses_file_metadata(
    file_service: FileService,
    dependencies: _Dependencies,
) -> None:
    record = _record()
    dependencies.files.file = record
    dependencies.storage.presigned_url = "direct-url"

    assert file_service.get_file_presigned_url(file_id=record.id, tenant_id=TENANT_ID) == "direct-url"
    assert dependencies.storage.presigned_calls == [(record.key, 300, record.mime_type)]


def test_get_icon_url_checks_tenant_owned_record_before_signing(
    file_service: FileService,
    dependencies: _Dependencies,
) -> None:
    dependencies.files.file = _record()

    assert file_service.get_icon_url("file-1", TENANT_ID) == "signed-url"
    assert dependencies.files.reads == [(TENANT_ID, "file-1")]
    assert dependencies.sign_file.calls == ["file-1"]


def test_delete_file_delegates_tenant_scoped_liveness_check(
    file_service: FileService,
    dependencies: _Dependencies,
) -> None:
    file_service.delete_file(tenant_id=TENANT_ID, file_id="file-1")

    assert dependencies.reclaimer.calls == [(TENANT_ID, ("file-1",), dependencies.delete_blob)]


def test_delete_uncommitted_artifact_removes_known_blob(
    file_service: FileService,
    dependencies: _Dependencies,
) -> None:
    file_service.delete_uncommitted_artifact(artifact=CreatedUploadArtifact(id="file-1", key="temporary/key"))

    assert dependencies.delete_blob.calls == ["temporary/key"]


def test_zip_archive_sanitizes_and_deduplicates_names(
    file_service: FileService,
    dependencies: _Dependencies,
) -> None:
    dependencies.storage.streams = [[b"first"], [b"second"]]
    files = [
        _record(file_id="file-1", name="../report.txt"),
        _record(file_id="file-2", name="report.txt"),
    ]

    with file_service.build_upload_files_zip_tempfile(upload_files=files) as tmp_path:
        assert os.path.exists(tmp_path)
        with ZipFile(tmp_path) as archive:
            assert archive.namelist() == ["report.txt", "report (1).txt"]
            assert archive.read("report.txt") == b"first"
            assert archive.read("report (1).txt") == b"second"

    assert not os.path.exists(tmp_path)


def test_zip_name_helpers_cover_empty_and_repeated_names() -> None:
    assert _sanitize_zip_entry_name("   ") == "file"
    assert _sanitize_zip_entry_name("a\\b.txt") == "a_b.txt"
    assert _dedupe_zip_entry_name("a.txt", {"a.txt", "a (1).txt"}) == "a (2).txt"


_TENANT_ID = "11111111-1111-1111-1111-111111111111"
_ACTOR_ID = "22222222-2222-2222-2222-222222222222"
_REMOTE_URL = "https://example.com/report.txt"


@dataclass
class _UploadHarness:
    files: FileService
    stored: dict[str, bytes]
    active_transactions: set[Connection]
    io_events: list[str]


@pytest.fixture
def upload_harness(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[_UploadHarness]:
    stored: dict[str, bytes] = {}
    active_transactions: set[Connection] = set()
    io_events: list[str] = []
    harness: _UploadHarness

    def begin(connection: Connection) -> None:
        harness.active_transactions.add(connection)

    def end(connection: Connection) -> None:
        harness.active_transactions.remove(connection)

    def save(key: str, content: bytes) -> None:
        assert not harness.active_transactions
        harness.io_events.append("storage")
        harness.stored[key] = content

    def signed_url(*, upload_file_id: str) -> str:
        assert not harness.active_transactions
        harness.io_events.append("sign")
        return f"https://files.example.com/{upload_file_id}?sign=test"

    event.listen(sqlite_engine, "begin", begin)
    event.listen(sqlite_engine, "commit", end)
    event.listen(sqlite_engine, "rollback", end)
    monkeypatch.setattr(storage, "save", save)
    monkeypatch.setattr(file_helpers, "get_signed_file_url", signed_url)
    monkeypatch.setattr("services.file_adapters.file_helpers.get_signed_file_url", signed_url)
    harness = _UploadHarness(
        files=build_file_service(session_factory=sqlite_session_factory),
        stored=stored,
        active_transactions=active_transactions,
        io_events=io_events,
    )
    try:
        yield harness
    finally:
        event.remove(sqlite_engine, "begin", begin)
        event.remove(sqlite_engine, "commit", end)
        event.remove(sqlite_engine, "rollback", end)


@pytest.mark.parametrize("role", [CreatorUserRole.ACCOUNT, CreatorUserRole.END_USER])
@pytest.mark.parametrize("source_url", ["", _REMOTE_URL])
def test_actor_upload_preserves_explicit_tenant_creator_and_source(
    upload_harness: _UploadHarness,
    sqlite_session_factory: sessionmaker[Session],
    role: CreatorUserRole,
    source_url: str,
) -> None:
    actor = FileUploadActor(id=_ACTOR_ID, creator_role=role)
    content = "文件内容".encode()

    result = upload_harness.files.upload_file(
        actor=actor,
        tenant_id=_TENANT_ID,
        filename="report.TXT",
        content=content,
        mimetype="text/plain",
        source_url=source_url,
    )

    assert isinstance(result, UploadFileRecord)
    assert (result.tenant_id, result.created_by, result.extension) == (_TENANT_ID, _ACTOR_ID, "txt")
    assert result.source_url == (source_url or f"https://files.example.com/{result.id}?sign=test")
    assert not upload_harness.active_transactions
    assert upload_harness.io_events == (["storage"] if source_url else ["storage", "sign"])
    with sqlite_session_factory() as session:
        persisted = session.get(UploadFile, result.id)
        assert persisted is not None
        assert persisted.created_by_role == role
        assert persisted.hash == hashlib.sha3_256(content).hexdigest()
        assert upload_harness.stored == {persisted.key: content}


@pytest.mark.parametrize("head_status", [httpx.codes.OK, httpx.codes.METHOD_NOT_ALLOWED])
def test_remote_actor_upload_fetches_before_persistence(
    upload_harness: _UploadHarness,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    head_status: int,
) -> None:
    content = b"remote file content"
    requests: list[str] = []

    def make_request(method: str, *, url: str, **_kwargs: object) -> httpx.Response:
        assert not upload_harness.active_transactions
        assert url == _REMOTE_URL
        requests.append(method)
        upload_harness.io_events.append(method)
        return httpx.Response(
            head_status if method == "HEAD" else httpx.codes.OK,
            content=content if method == "GET" else b"",
            headers={"Content-Type": "text/plain", "Content-Length": str(len(content))},
            request=httpx.Request(method, url),
        )

    monkeypatch.setattr(remote_fetcher, "make_request", make_request)
    result = RemoteFileService(files=upload_harness.files).upload_from_url(
        url=_REMOTE_URL,
        actor=FileUploadActor(id=_ACTOR_ID, creator_role=CreatorUserRole.ACCOUNT),
        tenant_id=_TENANT_ID,
    )

    assert requests == ["HEAD", "GET"]
    assert result.created_by == _ACTOR_ID
    with sqlite_session_factory() as session:
        persisted = session.scalars(select(UploadFile)).one()
        assert persisted.tenant_id == _TENANT_ID
        assert persisted.source_url == _REMOTE_URL
        assert upload_harness.stored[persisted.key] == content


def test_upload_rejects_missing_explicit_identity_before_storage(upload_harness: _UploadHarness) -> None:
    with pytest.raises(ValueError, match="tenant and creator identity"):
        upload_harness.files.upload_file(
            actor=FileUploadActor(id=_ACTOR_ID, creator_role=CreatorUserRole.ACCOUNT),
            tenant_id="",
            filename="report.txt",
            content=b"content",
            mimetype="text/plain",
        )

    assert upload_harness.io_events == []
    assert upload_harness.stored == {}
