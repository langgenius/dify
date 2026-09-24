import hashlib
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime

import httpx
import pytest
from sqlalchemy import Connection, Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from core.file import remote_fetcher
from extensions.ext_storage import storage
from graphon.file import helpers as file_helpers
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.file_service import FileService, FileUploadActor, FileUploadResult
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
    database_events: list[str]


@pytest.fixture
def upload_harness(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[_UploadHarness]:
    harness = _UploadHarness(
        files=FileService(session_factory=sqlite_session_factory),
        stored={},
        active_transactions=set(),
        io_events=[],
        database_events=[],
    )

    def begin(connection: Connection) -> None:
        harness.active_transactions.add(connection)
        harness.database_events.append("begin")

    def end(connection: Connection) -> None:
        harness.active_transactions.remove(connection)
        harness.database_events.append("end")

    def save(key: str, content: bytes) -> None:
        assert not harness.active_transactions
        harness.io_events.append("storage")
        harness.stored[key] = content

    def signed_url(upload_file_id: str) -> str:
        assert not harness.active_transactions
        harness.io_events.append("sign")
        return f"https://files.example.com/{upload_file_id}?sign=test"

    event.listen(sqlite_engine, "begin", begin)
    event.listen(sqlite_engine, "commit", end)
    event.listen(sqlite_engine, "rollback", end)
    monkeypatch.setattr(storage, "save", save)
    monkeypatch.setattr(file_helpers, "get_signed_file_url", signed_url)
    try:
        yield harness
    finally:
        event.remove(sqlite_engine, "begin", begin)
        event.remove(sqlite_engine, "commit", end)
        event.remove(sqlite_engine, "rollback", end)


@pytest.mark.parametrize("role", [CreatorUserRole.ACCOUNT, CreatorUserRole.END_USER])
@pytest.mark.parametrize("source_url", ["", _REMOTE_URL])
def test_actor_upload_preserves_owner_creator_and_source_url_without_extra_queries(
    upload_harness: _UploadHarness,
    sqlite_session_factory: sessionmaker[Session],
    role: CreatorUserRole,
    source_url: str,
) -> None:
    actor = FileUploadActor(id=_ACTOR_ID, creator_role=role)
    content = "文件内容".encode()

    result = upload_harness.files.upload_file_for_actor(
        actor=actor,
        resource_tenant_id=_TENANT_ID,
        filename="report.TXT",
        content=content,
        mimetype="text/plain",
        source_url=source_url,
    )

    assert isinstance(result, FileUploadResult)
    assert result.name == "report.TXT"
    assert result.size == len(content)
    assert result.extension == "txt"
    assert result.mime_type == "text/plain"
    assert result.created_by == actor.id
    assert isinstance(result.created_at, datetime)
    assert result.tenant_id == _TENANT_ID
    assert result.source_url == (source_url or f"https://files.example.com/{result.id}?sign=test")
    assert upload_harness.database_events == ["begin", "end"]
    assert not upload_harness.active_transactions
    assert upload_harness.io_events == (["storage"] if source_url else ["storage", "sign"])

    with sqlite_session_factory() as session:
        persisted = session.get(UploadFile, result.id)
        assert persisted is not None
        assert persisted.created_by_role == role
        assert persisted.created_by == actor.id
        assert persisted.tenant_id == _TENANT_ID
        assert persisted.source_url == source_url
        assert persisted.hash == hashlib.sha3_256(content).hexdigest()
        assert persisted.key.startswith(f"upload_files/{_TENANT_ID}/")
        assert upload_harness.stored == {persisted.key: content}


@pytest.mark.parametrize("head_status", [httpx.codes.OK, httpx.codes.METHOD_NOT_ALLOWED])
def test_remote_actor_upload_fetches_before_transaction_and_retains_original_url(
    upload_harness: _UploadHarness,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    head_status: int,
) -> None:
    actor = FileUploadActor(id=_ACTOR_ID, creator_role=CreatorUserRole.ACCOUNT)
    content = b"remote file content"
    requests: list[tuple[str, dict[str, object]]] = []

    def make_request(method: str, *, url: str, **kwargs: object) -> httpx.Response:
        assert not upload_harness.active_transactions
        assert url == _REMOTE_URL
        requests.append((method, kwargs))
        upload_harness.io_events.append(method)
        return httpx.Response(
            head_status if method == "HEAD" else httpx.codes.OK,
            content=content if method == "GET" else b"",
            headers={"Content-Type": "text/plain", "Content-Length": str(len(content))},
            request=httpx.Request(method, url),
        )

    monkeypatch.setattr(remote_fetcher, "make_request", make_request)

    result = RemoteFileService(files=upload_harness.files).upload_from_url(
        url=_REMOTE_URL, user=actor, tenant_id=_TENANT_ID
    )

    assert result.name == "report.txt"
    assert result.size == len(content)
    assert result.extension == "txt"
    assert result.mime_type == "text/plain"
    assert result.created_by == actor.id
    assert result.url == f"https://files.example.com/{result.id}?sign=test"
    assert requests == [
        ("HEAD", {}),
        ("GET", {} if head_status == httpx.codes.OK else {"timeout": 3, "follow_redirects": True}),
    ]
    assert upload_harness.io_events == ["HEAD", "GET", "storage", "sign"]
    assert upload_harness.database_events == ["begin", "end"]
    assert not upload_harness.active_transactions

    with sqlite_session_factory() as session:
        persisted = session.scalars(select(UploadFile)).one()
        assert persisted.id == result.id
        assert persisted.created_by == actor.id
        assert persisted.created_by_role == CreatorUserRole.ACCOUNT
        assert persisted.tenant_id == _TENANT_ID
        assert persisted.source_url == _REMOTE_URL
        assert persisted.key.startswith(f"upload_files/{_TENANT_ID}/")
        assert upload_harness.stored == {persisted.key: content}


def test_same_actor_can_upload_to_separately_admitted_tenants(
    upload_harness: _UploadHarness,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    actor = FileUploadActor(id=_ACTOR_ID, creator_role=CreatorUserRole.ACCOUNT)
    tenant_ids = (_TENANT_ID, "33333333-3333-3333-3333-333333333333")

    results = [
        upload_harness.files.upload_file_for_actor(
            actor=actor,
            resource_tenant_id=tenant_id,
            filename="report.txt",
            content=tenant_id.encode(),
            mimetype="text/plain",
        )
        for tenant_id in tenant_ids
    ]

    assert [result.tenant_id for result in results] == list(tenant_ids)
    assert len({result.id for result in results}) == 2
    with sqlite_session_factory() as session:
        for result, tenant_id in zip(results, tenant_ids, strict=True):
            persisted = session.get(UploadFile, result.id)
            assert persisted is not None
            assert persisted.tenant_id == tenant_id
            assert persisted.created_by == actor.id
            assert persisted.created_by_role == actor.creator_role
            assert persisted.key.startswith(f"upload_files/{tenant_id}/")
            assert upload_harness.stored[persisted.key] == tenant_id.encode()


@pytest.mark.parametrize("remote", [False, True], ids=["local", "remote"])
def test_actor_upload_without_target_tenant_fails_before_external_io(
    upload_harness: _UploadHarness,
    monkeypatch: pytest.MonkeyPatch,
    remote: bool,
) -> None:
    actor = FileUploadActor(id=_ACTOR_ID, creator_role=CreatorUserRole.ACCOUNT)

    def unexpected_request(*_args: object, **_kwargs: object) -> httpx.Response:
        pytest.fail("Missing target tenant must be rejected before fetching the remote file")

    monkeypatch.setattr(remote_fetcher, "make_request", unexpected_request)

    if remote:
        with pytest.raises(TypeError, match="tenant_id"):
            RemoteFileService(files=upload_harness.files).upload_from_url(url=_REMOTE_URL, user=actor)
    else:
        with pytest.raises(TypeError, match="tenant_id"):
            upload_harness.files.upload_file(
                filename="report.txt", content=b"file content", mimetype="text/plain", user=actor
            )

    assert upload_harness.io_events == []
    assert upload_harness.database_events == []
    assert upload_harness.stored == {}
