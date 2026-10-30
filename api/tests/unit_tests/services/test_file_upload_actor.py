import hashlib
from collections.abc import Iterator
from dataclasses import dataclass

import httpx
import pytest
from sqlalchemy import Connection, Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from core.file import remote_fetcher
from enums.creator import CreatorUserRole
from extensions.ext_storage import storage
from graphon.file import helpers as file_helpers
from models.model import UploadFile
from services.entities.upload_file import FileUploadActor, UploadFileRecord
from services.file_adapters import build_file_service
from services.file_service import FileService
from services.remote_file_service import RemoteFileService

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
