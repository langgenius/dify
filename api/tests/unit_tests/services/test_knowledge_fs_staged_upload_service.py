from __future__ import annotations

from base64 import b64encode
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session, sessionmaker

from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole
from models.knowledge_fs import (
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
    KnowledgeFSStagedUpload,
    KnowledgeFSStagedUploadStatus,
)
from models.model import Account, UploadFile
from services import file_service as file_service_module
from services.errors.file import FileTooLargeError, UnsupportedFileTypeError
from services.knowledge_fs import staged_upload_service as staged_upload_module
from services.knowledge_fs.data_facade import KnowledgeFSDataFacade
from services.knowledge_fs.object_storage import KnowledgeFSObjectStorageService
from services.knowledge_fs.product_dto import (
    KnowledgeFSDocumentStagedUploadPayload,
    KnowledgeFSUploadSessionCreateResponse,
    KnowledgeFSUploadSessionMutationResponse,
    KnowledgeFSUploadSessionResponse,
)
from services.knowledge_fs.staged_upload_service import (
    KnowledgeFSStagedUploadConflictError,
    KnowledgeFSStagedUploadInvalidError,
    KnowledgeFSStagedUploadNotFoundError,
    KnowledgeFSStagedUploadService,
    KnowledgeFSStagedUploadTooLargeError,
)

_TENANT_ID = "00000000-0000-0000-0000-000000000001"
_ACCOUNT_ID = "00000000-0000-0000-0000-000000000002"
_CONTROL_SPACE_ID = "00000000-0000-0000-0000-000000000003"
_OTHER_CONTROL_SPACE_ID = "00000000-0000-0000-0000-000000000004"
_KNOWLEDGE_SPACE_ID = "00000000-0000-0000-0000-000000000005"
_UPLOAD_FILE_ID = "00000000-0000-0000-0000-000000000006"
_STAGED_UPLOAD_ID = "00000000-0000-0000-0000-000000000007"
_UPLOAD_SESSION_ID = "00000000-0000-0000-0000-000000000008"
_DOCUMENT_ASSET_ID = "00000000-0000-0000-0000-000000000009"
_COMPILATION_JOB_ID = "00000000-0000-0000-0000-000000000010"
_BODY = b"staged knowledge document"
_SOURCE_PATH = f"upload_files/{_TENANT_ID}/guide.pdf"


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []

    def save(self, filename: str, data: bytes) -> None:
        self.objects[filename] = bytes(data)

    def load_once(self, filename: str) -> bytes:
        try:
            return self.objects[filename]
        except KeyError as exc:
            raise FileNotFoundError(filename) from exc

    def load_stream(self, filename: str) -> Generator[bytes, None, None]:
        yield self.load_once(filename)

    def exists(self, filename: str) -> bool:
        return filename in self.objects

    def delete(self, filename: str) -> None:
        self.deleted.append(filename)
        self.objects.pop(filename, None)

    def scan(self, path: str, files: bool = True, directories: bool = False) -> list[str]:
        del files, directories
        return sorted(key for key in self.objects if key.startswith(path))


class FakeFacade:
    def __init__(self) -> None:
        self.create_calls: list[dict[str, object]] = []
        self.complete_calls: list[dict[str, object]] = []
        self.mode = "small_fallback"
        self.complete_failures = 0
        self.return_completion_ids = True

    def create_upload_session(self, **kwargs: object) -> KnowledgeFSUploadSessionCreateResponse:
        self.create_calls.append(kwargs)
        return KnowledgeFSUploadSessionCreateResponse(
            session=_upload_session(status="ready", mode=self.mode),  # type: ignore[arg-type]
        )

    def complete_upload_session(self, **kwargs: object) -> KnowledgeFSUploadSessionMutationResponse:
        self.complete_calls.append(kwargs)
        if self.complete_failures:
            self.complete_failures -= 1
            raise RuntimeError("upstream completion timed out")
        return KnowledgeFSUploadSessionMutationResponse(
            session=_upload_session(
                status="completed",
                document_asset_id=_DOCUMENT_ASSET_ID if self.return_completion_ids else None,
                compilation_job_id=_COMPILATION_JOB_ID if self.return_completion_ids else None,
            )
        )


def _upload_session(
    *,
    status: str,
    mode: str = "small_fallback",
    document_asset_id: str | None = None,
    compilation_job_id: str | None = None,
) -> KnowledgeFSUploadSessionResponse:
    return KnowledgeFSUploadSessionResponse.model_validate(
        {
            "id": _UPLOAD_SESSION_ID,
            "mode": mode,
            "status": status,
            "expectedSizeBytes": len(_BODY),
            "expiresAt": 2_000_000_000,
            "documentAssetId": document_asset_id,
            "compilationJobId": compilation_job_id,
        }
    )


def _upload_file(
    *,
    tenant_id: str = _TENANT_ID,
    account_id: str = _ACCOUNT_ID,
    upload_file_id: str = _UPLOAD_FILE_ID,
) -> UploadFile:
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=_SOURCE_PATH,
        name="guide.pdf",
        size=len(_BODY),
        extension="pdf",
        mime_type="application/pdf",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account_id,
        created_at=datetime(2026, 8, 10, tzinfo=UTC),
        used=False,
    )
    upload_file.id = upload_file_id
    return upload_file


def _control_space(
    *,
    control_space_id: str = _CONTROL_SPACE_ID,
    state: KnowledgeFSControlSpaceState = KnowledgeFSControlSpaceState.ACTIVE,
    knowledge_space_id: str | None = _KNOWLEDGE_SPACE_ID,
) -> KnowledgeFSControlSpace:
    control_space = KnowledgeFSControlSpace(
        tenant_id=_TENANT_ID,
        owner_account_id=_ACCOUNT_ID,
        provisioning_key=f"provision-{control_space_id}",
        knowledge_space_id=knowledge_space_id,
        state=state,
    )
    control_space.id = control_space_id
    return control_space


def _staged_upload(
    *,
    status: KnowledgeFSStagedUploadStatus = KnowledgeFSStagedUploadStatus.UPLOADED,
    expires_at: datetime | None = None,
    control_space_id: str | None = None,
    upload_session_id: str | None = None,
    knowledge_space_id: str | None = None,
    claimed: bool = False,
) -> KnowledgeFSStagedUpload:
    staged = KnowledgeFSStagedUpload(
        tenant_id=_TENANT_ID,
        account_id=_ACCOUNT_ID,
        upload_file_id=_UPLOAD_FILE_ID,
        file_name="guide.pdf",
        content_type="application/pdf",
        size_bytes=len(_BODY),
        checksum_sha256_base64=b64encode(sha256(_BODY).digest()).decode(),
        expires_at=expires_at or naive_utc_now() + timedelta(hours=1),
        status=status,
        control_space_id=control_space_id,
        upload_session_id=upload_session_id,
        knowledge_space_id=knowledge_space_id,
        document_asset_id=_DOCUMENT_ASSET_ID if claimed else None,
        compilation_job_id=_COMPILATION_JOB_ID if claimed else None,
        claimed_at=naive_utc_now() if claimed else None,
    )
    staged.id = _STAGED_UPLOAD_ID
    return staged


def _seed(
    session_maker: sessionmaker[Session],
    *,
    staged: KnowledgeFSStagedUpload | None = None,
    upload_file: UploadFile | None = None,
    include_control_space: bool = True,
) -> KnowledgeFSStagedUpload:
    persisted_staged = staged or _staged_upload()
    with session_maker.begin() as session:
        if include_control_space:
            session.add(_control_space())
        if upload_file is not None:
            session.add(upload_file)
        session.add(persisted_staged)
    return persisted_staged


@pytest.fixture
def service_context(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage]:
    backend = FakeStorage()
    backend.save(_SOURCE_PATH, _BODY)
    facade = FakeFacade()
    monkeypatch.setattr(staged_upload_module, "storage", backend)
    service = KnowledgeFSStagedUploadService(
        sqlite_session_factory,
        facade=cast(KnowledgeFSDataFacade, facade),
        object_storage=KnowledgeFSObjectStorageService(backend=backend),
    )
    return service, facade, backend


def test_stage_persists_workspace_owned_upload(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    upload_file = _upload_file()
    with sqlite_session_factory.begin() as session:
        session.add(upload_file)
    file_service = MagicMock()
    file_service.upload_file.return_value = upload_file
    monkeypatch.setattr(staged_upload_module, "FileService", lambda _: file_service)
    service = KnowledgeFSStagedUploadService(
        sqlite_session_factory,
        facade=cast(KnowledgeFSDataFacade, MagicMock()),
    )
    account = cast(Account, SimpleNamespace(id=_ACCOUNT_ID))

    response = service.stage(
        tenant_id=_TENANT_ID,
        account=account,
        file_name="guide.pdf",
        content_type=" ",
        body=_BODY,
        file_size_limit_mb=15,
    )

    assert response.file_name == "guide.pdf"
    assert response.content_type == "application/pdf"
    assert response.size_bytes == len(_BODY)
    assert response.status == "uploaded"
    file_service.upload_file.assert_called_once_with(
        filename="guide.pdf",
        content=_BODY,
        mimetype="application/pdf",
        user=account,
        tenant_id=_TENANT_ID,
        source="knowledge_fs",
        default_file_size_limit=15,
    )
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSStagedUpload, response.id)
        assert persisted is not None
        assert persisted.checksum_sha256_base64 == b64encode(sha256(_BODY).digest()).decode()


@pytest.mark.parametrize(
    ("file_name", "content_type", "expected_content_type"),
    [
        ("report.pdf", "text/plain", "application/pdf"),
        ("formatted.rtf", "text/rtf", "application/rtf"),
        ("message.msg", "application/x-msg", "application/vnd.ms-outlook"),
    ],
)
def test_stage_canonicalizes_content_type_from_the_supported_extension(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    file_name: str,
    content_type: str,
    expected_content_type: str,
) -> None:
    upload_file = _upload_file()
    upload_file.name = file_name
    upload_file.extension = file_name.rsplit(".", 1)[1]
    upload_file.mime_type = expected_content_type
    with sqlite_session_factory.begin() as session:
        session.add(upload_file)
    file_service = MagicMock()
    file_service.upload_file.return_value = upload_file
    monkeypatch.setattr(staged_upload_module, "FileService", lambda _: file_service)
    service = KnowledgeFSStagedUploadService(
        sqlite_session_factory,
        facade=cast(KnowledgeFSDataFacade, MagicMock()),
    )
    account = cast(Account, SimpleNamespace(id=_ACCOUNT_ID))

    response = service.stage(
        tenant_id=_TENANT_ID,
        account=account,
        file_name=file_name,
        content_type=content_type,
        body=_BODY,
        file_size_limit_mb=15,
    )

    assert response.content_type == expected_content_type
    file_service.upload_file.assert_called_once_with(
        filename=file_name,
        content=_BODY,
        mimetype=expected_content_type,
        user=account,
        tenant_id=_TENANT_ID,
        source="knowledge_fs",
        default_file_size_limit=15,
    )


@pytest.mark.parametrize(
    ("file_name", "content_type", "body"),
    [
        ("notes.txt", "text/plain", b"KnowledgeFS notes"),
        ("guide.md", "text/markdown", b"# KnowledgeFS guide"),
        ("README.markdown", "text/markdown", b"# KnowledgeFS guide"),
        ("component.mdx", "text/mdx", b"# KnowledgeFS component"),
        ("captions.vtt", "text/vtt", b"WEBVTT\n\n00:00.000 --> 00:01.000\nKnowledgeFS"),
        ("application.properties", "text/x-java-properties", b"knowledge.fs=enabled"),
        ("feed.xml", "application/xml", b"<knowledge>KnowledgeFS</knowledge>"),
        ("manual.odt", "application/vnd.oasis.opendocument.text", b"odt"),
        ("message.eml", "message/rfc822", b"Subject: KnowledgeFS\n\nBody"),
        ("message.msg", "application/vnd.ms-outlook", b"msg"),
    ],
)
def test_stage_accepts_knowledge_fs_document_formats_with_the_real_file_service(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    file_name: str,
    content_type: str,
    body: bytes,
) -> None:
    backend = FakeStorage()
    monkeypatch.setattr(file_service_module, "storage", backend)
    monkeypatch.setattr(staged_upload_module, "storage", backend)
    monkeypatch.setattr(file_service_module.file_helpers, "get_signed_file_url", lambda **_: "signed")
    account = Account(name="KnowledgeFS tester", email="knowledge-fs@example.com")
    account.id = _ACCOUNT_ID
    service = KnowledgeFSStagedUploadService(
        sqlite_session_factory,
        facade=cast(KnowledgeFSDataFacade, MagicMock()),
    )

    response = service.stage(
        tenant_id=_TENANT_ID,
        account=account,
        file_name=file_name,
        content_type=content_type,
        body=body,
        file_size_limit_mb=15,
    )

    assert response.file_name == file_name
    assert response.content_type == content_type
    assert response.size_bytes == len(body)
    assert response.status == "uploaded"
    assert list(backend.objects.values()) == [body]
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSStagedUpload, response.id)
        assert persisted is not None
        assert persisted.upload_file_id


@pytest.mark.parametrize("file_name", ["malware.exe", "md"])
def test_stage_rejects_an_unsupported_filename_with_the_real_file_service(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, file_name: str
) -> None:
    backend = FakeStorage()
    monkeypatch.setattr(file_service_module, "storage", backend)
    monkeypatch.setattr(staged_upload_module, "storage", backend)
    monkeypatch.setattr(file_service_module.file_helpers, "get_signed_file_url", lambda **_: "signed")
    account = Account(name="KnowledgeFS tester", email="knowledge-fs@example.com")
    account.id = _ACCOUNT_ID
    service = KnowledgeFSStagedUploadService(
        sqlite_session_factory,
        facade=cast(KnowledgeFSDataFacade, MagicMock()),
    )

    with pytest.raises(KnowledgeFSStagedUploadInvalidError, match="invalid"):
        service.stage(
            tenant_id=_TENANT_ID,
            account=account,
            file_name=file_name,
            content_type="application/octet-stream",
            body=b"not executable content",
            file_size_limit_mb=15,
        )

    assert backend.objects == {}


def test_stage_rejects_empty_and_maps_file_service_errors(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    file_service = MagicMock()
    monkeypatch.setattr(staged_upload_module, "FileService", lambda _: file_service)
    service = KnowledgeFSStagedUploadService(
        sqlite_session_factory,
        facade=cast(KnowledgeFSDataFacade, MagicMock()),
    )
    account = cast(Account, SimpleNamespace(id=_ACCOUNT_ID))

    with pytest.raises(KnowledgeFSStagedUploadInvalidError, match="empty"):
        service.stage(
            tenant_id=_TENANT_ID,
            account=account,
            file_name="empty.pdf",
            content_type="application/pdf",
            body=b"",
            file_size_limit_mb=15,
        )

    file_service.upload_file.side_effect = FileTooLargeError("too large")
    with pytest.raises(KnowledgeFSStagedUploadTooLargeError):
        service.stage(
            tenant_id=_TENANT_ID,
            account=account,
            file_name="large.pdf",
            content_type="application/pdf",
            body=_BODY,
            file_size_limit_mb=1,
        )

    file_service.upload_file.side_effect = UnsupportedFileTypeError("unsupported")
    with pytest.raises(KnowledgeFSStagedUploadInvalidError, match="invalid"):
        service.stage(
            tenant_id=_TENANT_ID,
            account=account,
            file_name="guide.exe",
            content_type="application/octet-stream",
            body=_BODY,
            file_size_limit_mb=15,
        )


@pytest.mark.parametrize("persisted_upload_file", [False, True])
def test_stage_removes_file_when_staging_row_cannot_commit(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    persisted_upload_file: bool,
) -> None:
    upload_file = _upload_file()
    if persisted_upload_file:
        with sqlite_session_factory.begin() as session:
            session.add(upload_file)
    file_service = MagicMock()
    file_service.upload_file.return_value = upload_file
    monkeypatch.setattr(staged_upload_module, "FileService", lambda _: file_service)
    backend = FakeStorage()
    backend.save(_SOURCE_PATH, _BODY)
    monkeypatch.setattr(staged_upload_module, "storage", backend)

    failing_session = MagicMock()
    failing_session.__enter__.return_value = failing_session
    failing_session.__exit__.return_value = False
    failing_session.commit.side_effect = RuntimeError("database unavailable")
    calls = 0

    def session_maker_with_failure(**kwargs: object):
        nonlocal calls
        del kwargs
        calls += 1
        return failing_session if calls == 1 else sqlite_session_factory()

    service = KnowledgeFSStagedUploadService(
        cast(sessionmaker[Session], session_maker_with_failure),
        facade=cast(KnowledgeFSDataFacade, MagicMock()),
    )

    with pytest.raises(RuntimeError, match="database unavailable"):
        service.stage(
            tenant_id=_TENANT_ID,
            account=cast(Account, SimpleNamespace(id=_ACCOUNT_ID)),
            file_name="guide.pdf",
            content_type="application/pdf",
            body=_BODY,
            file_size_limit_mb=15,
        )

    assert _SOURCE_PATH not in backend.objects
    with sqlite_session_factory() as session:
        assert session.get(UploadFile, _UPLOAD_FILE_ID) is None


def test_claim_adopts_bytes_completes_once_and_replays_idempotently(
    sqlite_session_factory: sessionmaker[Session],
    service_context: tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage],
) -> None:
    service, facade, backend = service_context
    _seed(sqlite_session_factory, upload_file=_upload_file())

    response = service.claim(
        tenant_id=_TENANT_ID,
        account_id=_ACCOUNT_ID,
        control_space_id=_CONTROL_SPACE_ID,
        payload=KnowledgeFSDocumentStagedUploadPayload(upload_id=_STAGED_UPLOAD_ID),
    )
    replay = service.claim(
        tenant_id=_TENANT_ID,
        account_id=_ACCOUNT_ID,
        control_space_id=_CONTROL_SPACE_ID,
        payload=KnowledgeFSDocumentStagedUploadPayload(upload_id=_STAGED_UPLOAD_ID),
    )

    assert response == replay
    assert response.status == "accepted"
    assert response.document_asset_id == _DOCUMENT_ASSET_ID
    assert response.compilation_job_id == _COMPILATION_JOB_ID
    assert len(facade.create_calls) == 1
    assert len(facade.complete_calls) == 1
    assert facade.create_calls[0]["idempotency_key"] == f"staged-upload:{_STAGED_UPLOAD_ID}"
    logical_key = f"namespaces/{_TENANT_ID}/spaces/{_KNOWLEDGE_SPACE_ID}/uploads/{_UPLOAD_SESSION_ID}/source"
    assert b"".join(service._object_storage.load_stream(key=logical_key) or ()) == _BODY
    assert backend.objects[_SOURCE_PATH] == _BODY
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSStagedUpload, _STAGED_UPLOAD_ID)
        upload_file = session.get(UploadFile, _UPLOAD_FILE_ID)
        assert persisted is not None
        assert persisted.status is KnowledgeFSStagedUploadStatus.CLAIMED
        assert persisted.upload_session_id == _UPLOAD_SESSION_ID
        assert upload_file is not None
        assert upload_file.used is True
        assert upload_file.used_by == _ACCOUNT_ID


def test_failed_completion_reuses_prepared_session_on_retry(
    sqlite_session_factory: sessionmaker[Session],
    service_context: tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage],
) -> None:
    service, facade, _ = service_context
    facade.complete_failures = 1
    _seed(sqlite_session_factory, upload_file=_upload_file())
    payload = KnowledgeFSDocumentStagedUploadPayload(upload_id=_STAGED_UPLOAD_ID)

    with pytest.raises(RuntimeError, match="timed out"):
        service.claim(
            tenant_id=_TENANT_ID,
            account_id=_ACCOUNT_ID,
            control_space_id=_CONTROL_SPACE_ID,
            payload=payload,
        )
    with sqlite_session_factory() as session:
        failed = session.get(KnowledgeFSStagedUpload, _STAGED_UPLOAD_ID)
        assert failed is not None
        assert failed.status is KnowledgeFSStagedUploadStatus.FAILED
        assert failed.upload_session_id == _UPLOAD_SESSION_ID
        assert failed.last_error_code == "RuntimeError"

    response = service.claim(
        tenant_id=_TENANT_ID,
        account_id=_ACCOUNT_ID,
        control_space_id=_CONTROL_SPACE_ID,
        payload=payload,
    )

    assert response.status == "accepted"
    assert len(facade.create_calls) == 1
    assert len(facade.complete_calls) == 2


@pytest.mark.parametrize(
    ("status", "control_space_id", "claimed", "error"),
    [
        (KnowledgeFSStagedUploadStatus.ABORTED, None, False, "expired"),
        (KnowledgeFSStagedUploadStatus.EXPIRED, None, False, "expired"),
        (KnowledgeFSStagedUploadStatus.UPLOADED, _OTHER_CONTROL_SPACE_ID, False, "another Space"),
        (KnowledgeFSStagedUploadStatus.CLAIMED, _OTHER_CONTROL_SPACE_ID, True, "another Space"),
    ],
)
def test_claim_rejects_non_claimable_states(
    sqlite_session_factory: sessionmaker[Session],
    service_context: tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage],
    status: KnowledgeFSStagedUploadStatus,
    control_space_id: str | None,
    claimed: bool,
    error: str,
) -> None:
    service, facade, _ = service_context
    staged = _staged_upload(
        status=status,
        control_space_id=control_space_id,
        upload_session_id=_UPLOAD_SESSION_ID if claimed else None,
        knowledge_space_id=_KNOWLEDGE_SPACE_ID if claimed else None,
        claimed=claimed,
    )
    _seed(sqlite_session_factory, staged=staged, upload_file=_upload_file())

    expected_error = (
        KnowledgeFSStagedUploadNotFoundError
        if status in {KnowledgeFSStagedUploadStatus.ABORTED, KnowledgeFSStagedUploadStatus.EXPIRED}
        else KnowledgeFSStagedUploadConflictError
    )
    with pytest.raises(expected_error, match=error):
        service.claim(
            tenant_id=_TENANT_ID,
            account_id=_ACCOUNT_ID,
            control_space_id=_CONTROL_SPACE_ID,
            payload=KnowledgeFSDocumentStagedUploadPayload(upload_id=_STAGED_UPLOAD_ID),
        )
    assert not facade.create_calls


def test_claim_resumes_same_space_after_process_stops_in_claiming_state(
    sqlite_session_factory: sessionmaker[Session],
    service_context: tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage],
) -> None:
    service, facade, _ = service_context
    staged = _staged_upload(
        status=KnowledgeFSStagedUploadStatus.CLAIMING,
        control_space_id=_CONTROL_SPACE_ID,
    )
    _seed(sqlite_session_factory, staged=staged, upload_file=_upload_file())

    response = service.claim(
        tenant_id=_TENANT_ID,
        account_id=_ACCOUNT_ID,
        control_space_id=_CONTROL_SPACE_ID,
        payload=KnowledgeFSDocumentStagedUploadPayload(upload_id=_STAGED_UPLOAD_ID),
    )

    assert response.status == "accepted"
    assert len(facade.create_calls) == 1
    assert len(facade.complete_calls) == 1


def test_claim_hides_missing_or_mismatched_upload_file(
    sqlite_session_factory: sessionmaker[Session],
    service_context: tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage],
) -> None:
    service, _, _ = service_context
    _seed(sqlite_session_factory, upload_file=None)

    with pytest.raises(KnowledgeFSStagedUploadNotFoundError, match="file was not found"):
        service.claim(
            tenant_id=_TENANT_ID,
            account_id=_ACCOUNT_ID,
            control_space_id=_CONTROL_SPACE_ID,
            payload=KnowledgeFSDocumentStagedUploadPayload(upload_id=_STAGED_UPLOAD_ID),
        )


def test_claim_expires_elapsed_upload_and_hides_wrong_owner_or_file(
    sqlite_session_factory: sessionmaker[Session],
    service_context: tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage],
) -> None:
    service, facade, _ = service_context
    _seed(
        sqlite_session_factory,
        staged=_staged_upload(expires_at=naive_utc_now() - timedelta(seconds=1)),
        upload_file=_upload_file(),
    )
    payload = KnowledgeFSDocumentStagedUploadPayload(upload_id=_STAGED_UPLOAD_ID)

    with pytest.raises(KnowledgeFSStagedUploadNotFoundError, match="expired"):
        service.claim(
            tenant_id=_TENANT_ID,
            account_id=_ACCOUNT_ID,
            control_space_id=_CONTROL_SPACE_ID,
            payload=payload,
        )
    with sqlite_session_factory() as session:
        expired = session.get(KnowledgeFSStagedUpload, _STAGED_UPLOAD_ID)
        assert expired is not None
        assert expired.status is KnowledgeFSStagedUploadStatus.EXPIRED

    with pytest.raises(KnowledgeFSStagedUploadNotFoundError, match="not found"):
        service.claim(
            tenant_id=_TENANT_ID,
            account_id="00000000-0000-0000-0000-000000000099",
            control_space_id=_CONTROL_SPACE_ID,
            payload=payload,
        )
    assert not facade.create_calls


def test_claim_rejects_incomplete_prepared_state_and_ignores_missing_failure_row(
    service_context: tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, facade, _ = service_context
    staged = _staged_upload(
        status=KnowledgeFSStagedUploadStatus.FAILED,
        control_space_id=_CONTROL_SPACE_ID,
        upload_session_id=_UPLOAD_SESSION_ID,
    )
    upload_file = _upload_file()
    monkeypatch.setattr(service, "_begin_claim", lambda **_: (staged, upload_file))

    with pytest.raises(KnowledgeFSStagedUploadConflictError, match="session is incomplete"):
        service.claim(
            tenant_id=_TENANT_ID,
            account_id=_ACCOUNT_ID,
            control_space_id=_CONTROL_SPACE_ID,
            payload=KnowledgeFSDocumentStagedUploadPayload(upload_id=_STAGED_UPLOAD_ID),
        )
    assert not facade.create_calls


def test_claim_marks_failed_for_invalid_remote_session_and_inactive_space(
    sqlite_session_factory: sessionmaker[Session],
    service_context: tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage],
) -> None:
    service, facade, _ = service_context
    facade.mode = "multipart"
    _seed(sqlite_session_factory, upload_file=_upload_file())

    with pytest.raises(KnowledgeFSStagedUploadInvalidError, match="multipart"):
        service.claim(
            tenant_id=_TENANT_ID,
            account_id=_ACCOUNT_ID,
            control_space_id=_CONTROL_SPACE_ID,
            payload=KnowledgeFSDocumentStagedUploadPayload(upload_id=_STAGED_UPLOAD_ID),
        )
    with sqlite_session_factory() as session:
        failed = session.get(KnowledgeFSStagedUpload, _STAGED_UPLOAD_ID)
        assert failed is not None
        assert failed.status is KnowledgeFSStagedUploadStatus.FAILED

    with sqlite_session_factory.begin() as session:
        failed = session.get(KnowledgeFSStagedUpload, _STAGED_UPLOAD_ID)
        assert failed is not None
        failed.status = KnowledgeFSStagedUploadStatus.UPLOADED
        space = session.get(KnowledgeFSControlSpace, _CONTROL_SPACE_ID)
        assert space is not None
        space.state = KnowledgeFSControlSpaceState.ERROR
    facade.mode = "small_fallback"

    with pytest.raises(KnowledgeFSStagedUploadNotFoundError, match="not active"):
        service.claim(
            tenant_id=_TENANT_ID,
            account_id=_ACCOUNT_ID,
            control_space_id=_CONTROL_SPACE_ID,
            payload=KnowledgeFSDocumentStagedUploadPayload(upload_id=_STAGED_UPLOAD_ID),
        )


def test_claim_rejects_incomplete_completion_response(
    sqlite_session_factory: sessionmaker[Session],
    service_context: tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage],
) -> None:
    service, facade, _ = service_context
    facade.return_completion_ids = False
    _seed(sqlite_session_factory, upload_file=_upload_file())

    with pytest.raises(KnowledgeFSStagedUploadConflictError, match="completion is incomplete"):
        service.claim(
            tenant_id=_TENANT_ID,
            account_id=_ACCOUNT_ID,
            control_space_id=_CONTROL_SPACE_ID,
            payload=KnowledgeFSDocumentStagedUploadPayload(upload_id=_STAGED_UPLOAD_ID),
        )


def test_abort_deletes_unclaimed_upload_and_is_idempotent(
    sqlite_session_factory: sessionmaker[Session],
    service_context: tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage],
) -> None:
    service, _, backend = service_context
    _seed(sqlite_session_factory, upload_file=_upload_file())

    service.abort(tenant_id=_TENANT_ID, account_id=_ACCOUNT_ID, upload_id=_STAGED_UPLOAD_ID)
    service.abort(tenant_id=_TENANT_ID, account_id=_ACCOUNT_ID, upload_id=_STAGED_UPLOAD_ID)

    assert _SOURCE_PATH not in backend.objects
    with sqlite_session_factory() as session:
        aborted = session.get(KnowledgeFSStagedUpload, _STAGED_UPLOAD_ID)
        assert aborted is not None
        assert aborted.status is KnowledgeFSStagedUploadStatus.ABORTED


@pytest.mark.parametrize(
    ("staged", "message"),
    [
        (_staged_upload(status=KnowledgeFSStagedUploadStatus.CLAIMING), "being claimed"),
        (
            _staged_upload(
                status=KnowledgeFSStagedUploadStatus.FAILED,
                control_space_id=_CONTROL_SPACE_ID,
                upload_session_id=_UPLOAD_SESSION_ID,
                knowledge_space_id=_KNOWLEDGE_SPACE_ID,
            ),
            "retrying its claim",
        ),
        (
            _staged_upload(
                status=KnowledgeFSStagedUploadStatus.CLAIMED,
                control_space_id=_CONTROL_SPACE_ID,
                upload_session_id=_UPLOAD_SESSION_ID,
                knowledge_space_id=_KNOWLEDGE_SPACE_ID,
                claimed=True,
            ),
            "deleted as documents",
        ),
    ],
)
def test_abort_rejects_active_or_prepared_claims(
    sqlite_session_factory: sessionmaker[Session],
    service_context: tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage],
    staged: KnowledgeFSStagedUpload,
    message: str,
) -> None:
    service, _, _ = service_context
    _seed(sqlite_session_factory, staged=staged, upload_file=_upload_file())

    with pytest.raises(KnowledgeFSStagedUploadConflictError, match=message):
        service.abort(tenant_id=_TENANT_ID, account_id=_ACCOUNT_ID, upload_id=_STAGED_UPLOAD_ID)


def test_abort_missing_upload_is_not_found(
    service_context: tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage],
) -> None:
    service, _, _ = service_context
    with pytest.raises(KnowledgeFSStagedUploadNotFoundError):
        service.abort(tenant_id=_TENANT_ID, account_id=_ACCOUNT_ID, upload_id=_STAGED_UPLOAD_ID)


def test_abort_and_cleanup_tolerate_missing_upload_file(
    sqlite_session_factory: sessionmaker[Session],
    service_context: tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage],
) -> None:
    service, _, _ = service_context
    _seed(sqlite_session_factory, upload_file=None)

    service.abort(tenant_id=_TENANT_ID, account_id=_ACCOUNT_ID, upload_id=_STAGED_UPLOAD_ID)

    with sqlite_session_factory.begin() as session:
        staged = session.get(KnowledgeFSStagedUpload, _STAGED_UPLOAD_ID)
        assert staged is not None
        staged.status = KnowledgeFSStagedUploadStatus.FAILED
        staged.expires_at = naive_utc_now() - timedelta(seconds=1)
    assert service.cleanup_expired() == 1


def test_cleanup_expires_only_bounded_never_prepared_uploads(
    sqlite_session_factory: sessionmaker[Session],
    service_context: tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage],
) -> None:
    service, _, backend = service_context
    expired = _staged_upload(expires_at=naive_utc_now() - timedelta(hours=1))
    prepared = _staged_upload(
        status=KnowledgeFSStagedUploadStatus.FAILED,
        expires_at=naive_utc_now() - timedelta(hours=1),
        control_space_id=_CONTROL_SPACE_ID,
        upload_session_id=_UPLOAD_SESSION_ID,
        knowledge_space_id=_KNOWLEDGE_SPACE_ID,
    )
    prepared.id = "00000000-0000-0000-0000-000000000011"
    prepared.upload_file_id = "00000000-0000-0000-0000-000000000012"
    prepared_file = _upload_file(upload_file_id=prepared.upload_file_id)
    prepared_file.key = f"upload_files/{_TENANT_ID}/prepared.pdf"
    backend.save(prepared_file.key, _BODY)
    with sqlite_session_factory.begin() as session:
        session.add_all([_control_space(), _upload_file(), expired, prepared_file, prepared])

    assert service.cleanup_expired(limit=1) == 1
    assert _SOURCE_PATH not in backend.objects
    assert prepared_file.key in backend.objects
    with sqlite_session_factory() as session:
        assert session.get(KnowledgeFSStagedUpload, _STAGED_UPLOAD_ID).status is KnowledgeFSStagedUploadStatus.EXPIRED  # type: ignore[union-attr]
        assert session.get(KnowledgeFSStagedUpload, prepared.id).status is KnowledgeFSStagedUploadStatus.FAILED  # type: ignore[union-attr]


def test_internal_claim_compare_and_swap_failures_are_explicit(
    sqlite_session_factory: sessionmaker[Session],
    service_context: tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage],
) -> None:
    service, _, _ = service_context
    _seed(sqlite_session_factory, upload_file=_upload_file())

    with pytest.raises(KnowledgeFSStagedUploadConflictError, match="claim changed"):
        service._record_upload_session(
            tenant_id=_TENANT_ID,
            account_id=_ACCOUNT_ID,
            upload_id=_STAGED_UPLOAD_ID,
            control_space_id=_CONTROL_SPACE_ID,
            knowledge_space_id=_KNOWLEDGE_SPACE_ID,
            upload_session_id=_UPLOAD_SESSION_ID,
        )
    with pytest.raises(KnowledgeFSStagedUploadConflictError, match="claim changed"):
        service._finish_claim(
            tenant_id=_TENANT_ID,
            account_id=_ACCOUNT_ID,
            upload_id=_STAGED_UPLOAD_ID,
            document_asset_id=_DOCUMENT_ASSET_ID,
            compilation_job_id=_COMPILATION_JOB_ID,
        )
    with pytest.raises(KnowledgeFSStagedUploadNotFoundError, match="not found"):
        service._finish_claim(
            tenant_id=_TENANT_ID,
            account_id=_ACCOUNT_ID,
            upload_id="00000000-0000-0000-0000-000000000099",
            document_asset_id=_DOCUMENT_ASSET_ID,
            compilation_job_id=_COMPILATION_JOB_ID,
        )


def test_finish_claim_replays_claimed_row_and_handles_missing_upload_file(
    sqlite_session_factory: sessionmaker[Session],
    service_context: tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage],
) -> None:
    service, _, _ = service_context
    claimed = _staged_upload(
        status=KnowledgeFSStagedUploadStatus.CLAIMED,
        control_space_id=_CONTROL_SPACE_ID,
        upload_session_id=_UPLOAD_SESSION_ID,
        knowledge_space_id=_KNOWLEDGE_SPACE_ID,
        claimed=True,
    )
    _seed(sqlite_session_factory, staged=claimed, upload_file=None)
    response = service._finish_claim(
        tenant_id=_TENANT_ID,
        account_id=_ACCOUNT_ID,
        upload_id=_STAGED_UPLOAD_ID,
        document_asset_id=_DOCUMENT_ASSET_ID,
        compilation_job_id=_COMPILATION_JOB_ID,
    )
    assert response.status == "accepted"

    with sqlite_session_factory.begin() as session:
        persisted = session.get(KnowledgeFSStagedUpload, _STAGED_UPLOAD_ID)
        assert persisted is not None
        persisted.status = KnowledgeFSStagedUploadStatus.CLAIMING
        persisted.document_asset_id = None
        persisted.compilation_job_id = None
        persisted.claimed_at = None
    response = service._finish_claim(
        tenant_id=_TENANT_ID,
        account_id=_ACCOUNT_ID,
        upload_id=_STAGED_UPLOAD_ID,
        document_asset_id=_DOCUMENT_ASSET_ID,
        compilation_job_id=_COMPILATION_JOB_ID,
    )
    assert response.document_asset_id == _DOCUMENT_ASSET_ID


def test_mark_failed_is_noop_for_terminal_or_missing_rows(
    sqlite_session_factory: sessionmaker[Session],
    service_context: tuple[KnowledgeFSStagedUploadService, FakeFacade, FakeStorage],
) -> None:
    service, _, _ = service_context
    claimed = _staged_upload(
        status=KnowledgeFSStagedUploadStatus.CLAIMED,
        control_space_id=_CONTROL_SPACE_ID,
        upload_session_id=_UPLOAD_SESSION_ID,
        knowledge_space_id=_KNOWLEDGE_SPACE_ID,
        claimed=True,
    )
    _seed(sqlite_session_factory, staged=claimed, upload_file=_upload_file())

    service._mark_failed(
        tenant_id=_TENANT_ID,
        account_id=_ACCOUNT_ID,
        upload_id=_STAGED_UPLOAD_ID,
        error_code="ignored",
    )
    service._mark_failed(
        tenant_id=_TENANT_ID,
        account_id=_ACCOUNT_ID,
        upload_id="00000000-0000-0000-0000-000000000099",
        error_code="ignored",
    )


def test_claim_response_rejects_incomplete_persisted_identifiers() -> None:
    staged = _staged_upload()
    with pytest.raises(KnowledgeFSStagedUploadConflictError, match="completion is incomplete"):
        staged_upload_module._claim_response(staged)
