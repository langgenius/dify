from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator
from datetime import datetime

import pytest
from sqlalchemy.orm import Session, sessionmaker

from extensions.storage.storage_type import StorageType
from graphon.file import File, FileTransferMethod, FileType
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.tools import ToolFile
from services.knowledge_fs import query_images


def _upload(
    *,
    upload_file_id: str = "00000000-0000-4000-8000-000000000001",
    account_id: str = "account-1",
    mime_type: str = "image/png",
    size: int = 12,
    tenant_id: str = "tenant-1",
) -> UploadFile:
    upload = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"uploads/{upload_file_id}",
        name="image.png",
        size=size,
        extension="png",
        mime_type=mime_type,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account_id,
        created_at=datetime(2026, 7, 21, 12, 0),
        used=False,
    )
    upload.id = upload_file_id
    return upload


def _persist_files(session: Session, files: Iterable[UploadFile | ToolFile]) -> None:
    session.add_all(files)
    session.commit()


def test_validate_query_images_checks_actor_bounds_and_marks_usage(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    upload = _upload()
    _persist_files(sqlite_session, [upload])
    used_at = datetime(2026, 7, 21, 12, 30)
    monkeypatch.setattr(query_images, "naive_utc_now", lambda: used_at)

    result = query_images.validate_query_image_references(
        tenant_id="tenant-1",
        account_id="account-1",
        upload_file_ids=[upload.id],
        mark_used=True,
    )

    assert result == [
        query_images.KnowledgeFSQueryImageMetadata(
            upload_file_id=upload.id,
            byte_size=12,
            mime_type="image/png",
        )
    ]
    with sqlite_session_factory() as session:
        persisted = session.get(UploadFile, upload.id)
        assert persisted is not None
        assert persisted.used is True
        assert persisted.used_by == "account-1"
        assert persisted.used_at == used_at


@pytest.mark.parametrize(
    ("upload", "code"),
    [
        (_upload(account_id="other"), "QUERY_IMAGE_NOT_FOUND"),
        (_upload(mime_type="image/svg+xml"), "QUERY_IMAGE_MIME_UNSUPPORTED"),
        (_upload(size=0), "QUERY_IMAGE_EMPTY"),
        (_upload(size=query_images.QUERY_IMAGE_MAX_BYTES + 1), "QUERY_IMAGE_TOO_LARGE"),
    ],
)
def test_validate_query_images_rejects_hidden_or_invalid_files(
    sqlite_session: Session,
    upload: UploadFile,
    code: str,
) -> None:
    _persist_files(sqlite_session, [upload])

    with pytest.raises(query_images.KnowledgeFSQueryImageError) as error:
        query_images.validate_query_image_references(
            tenant_id="tenant-1",
            account_id="account-1",
            upload_file_ids=[upload.id],
            mark_used=False,
        )

    assert error.value.code == code


def test_load_query_image_previews_signs_only_files_the_actor_owns(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    owned = _upload(upload_file_id="00000000-0000-4000-8000-000000000001")
    owned.name = "diagram.png"
    foreign = _upload(upload_file_id="00000000-0000-4000-8000-000000000002", account_id="account-2")
    foreign.name = "other.png"
    other_tenant = _upload(upload_file_id="00000000-0000-4000-8000-000000000004", tenant_id="other-tenant")
    _persist_files(sqlite_session, [owned, foreign, other_tenant])
    monkeypatch.setattr(
        query_images.file_helpers,
        "get_signed_file_url",
        lambda *, upload_file_id: f"https://files.example.test/{upload_file_id}/file-preview?sign=1",
    )

    previews = query_images.load_query_image_previews(
        tenant_id="tenant-1",
        account_id="account-1",
        upload_file_ids=[
            owned.id,
            owned.id,
            foreign.id,
            other_tenant.id,
            "00000000-0000-4000-8000-000000000003",
        ],
    )

    assert list(previews) == [owned.id]
    assert previews[owned.id] == query_images.KnowledgeFSQueryImagePreview(
        upload_file_id=owned.id,
        name="diagram.png",
        mime_type="image/png",
        byte_size=12,
        preview_url=f"https://files.example.test/{owned.id}/file-preview?sign=1",
    )
    assert (
        query_images.load_query_image_previews(tenant_id="tenant-1", account_id="account-1", upload_file_ids=[]) == {}
    )


def test_validate_query_images_rejects_missing_and_oversized_aggregate(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with pytest.raises(query_images.KnowledgeFSQueryImageError) as missing:
        query_images.validate_query_image_references(
            tenant_id="tenant-1",
            account_id="account-1",
            upload_file_ids=["missing"],
            mark_used=False,
        )
    assert missing.value.code == "QUERY_IMAGE_NOT_FOUND"

    uploads = [
        _upload(upload_file_id=f"00000000-0000-4000-8000-00000000000{index}", size=9 * 1024 * 1024)
        for index in range(1, 5)
    ]
    _persist_files(sqlite_session, uploads)
    with pytest.raises(query_images.KnowledgeFSQueryImageError) as oversized:
        query_images.validate_query_image_references(
            tenant_id="tenant-1",
            account_id="account-1",
            upload_file_ids=[upload.id for upload in uploads],
            mark_used=True,
        )
    assert oversized.value.code == "QUERY_IMAGE_TOTAL_TOO_LARGE"

    with sqlite_session_factory() as session:
        for upload in uploads:
            persisted = session.get(UploadFile, upload.id)
            assert persisted is not None
            assert persisted.used is False
            assert persisted.used_by is None
            assert persisted.used_at is None


def test_load_query_image_sniffs_bytes_and_hashes_content(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    body = b"\x89PNG\r\n\x1a\nrest"
    upload = _upload(size=len(body))
    _persist_files(sqlite_session, [upload])
    monkeypatch.setattr(
        query_images.storage,
        "load",
        lambda _key, *, stream=False: iter((body[:8], body[8:])) if stream else body,
    )

    result = query_images.load_query_image(
        tenant_id="tenant-1",
        account_id="account-1",
        upload_file_id=upload.id,
    )

    assert result.body == body
    assert result.mime_type == "image/png"
    assert len(result.sha256) == 64


def test_load_query_image_stops_when_stream_exceeds_declared_size(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    upload = _upload(size=8)
    _persist_files(sqlite_session, [upload])
    image_stream = iter((b"\x89PNG\r\n\x1a\n", b"unexpected"))

    def load(_key: str, *, stream: bool = False) -> Iterator[bytes]:
        assert stream is True
        return image_stream

    monkeypatch.setattr(query_images.storage, "load", load)

    with pytest.raises(query_images.KnowledgeFSQueryImageError) as error:
        query_images.load_query_image(
            tenant_id="tenant-1",
            account_id="account-1",
            upload_file_id=upload.id,
        )

    assert error.value.code == "QUERY_IMAGE_SIZE_INVALID"


def test_workflow_grant_is_file_tenant_subject_scoped_and_loads_without_actor_ownership(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    sqlite_session: Session,
) -> None:
    body = b"\x89PNG\r\n\x1a\nrest"
    upload = _upload(account_id="another-account", size=len(body))
    _persist_files(sqlite_session, [upload])

    config_overrides(SECRET_KEY="test-secret")
    monkeypatch.setattr(query_images.time, "time", lambda: 1_001)
    monkeypatch.setattr(query_images.storage, "load", lambda _key, **_kwargs: iter((body,)))
    reference = query_images.issue_workflow_query_image_reference(
        app_id="app-1",
        file=File(
            file_type=FileType.IMAGE,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            reference=upload.id,
            filename="diagram.png",
        ),
        now=1_000,
        tenant_id="tenant-1",
    )

    resolved = query_images.load_query_image(
        access_grant=reference.access_grant,
        subject_id="dify-app:app-1",
        tenant_id="tenant-1",
        upload_file_id=upload.id,
    )

    assert resolved.body == body
    with pytest.raises(query_images.KnowledgeFSQueryImageError) as wrong_subject:
        query_images.load_query_image(
            access_grant=reference.access_grant,
            subject_id="dify-app:app-2",
            tenant_id="tenant-1",
            upload_file_id=upload.id,
        )
    assert wrong_subject.value.code == "QUERY_IMAGE_GRANT_INVALID"


def test_workflow_grant_loads_tool_files(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    sqlite_session: Session,
) -> None:
    body = b"\x89PNG\r\n\x1a\nrest"
    tool_file = ToolFile(
        user_id="account-1",
        tenant_id="tenant-1",
        conversation_id=None,
        file_key="tool-files/image.png",
        mimetype="image/png",
        size=len(body),
    )
    tool_file.id = "00000000-0000-4000-8000-000000000002"

    _persist_files(sqlite_session, [tool_file])
    config_overrides(SECRET_KEY="test-secret")
    monkeypatch.setattr(query_images.time, "time", lambda: 1_001)
    monkeypatch.setattr(query_images.storage, "load", lambda _key, **_kwargs: iter((body,)))

    reference = query_images.issue_workflow_query_image_reference(
        app_id="app-1",
        file=File(
            file_type=FileType.IMAGE,
            transfer_method=FileTransferMethod.TOOL_FILE,
            reference=tool_file.id,
            filename="diagram.png",
        ),
        now=1_000,
        tenant_id="tenant-1",
    )
    resolved = query_images.load_query_image(
        access_grant=reference.access_grant,
        subject_id="dify-app:app-1",
        tenant_id="tenant-1",
        upload_file_id=tool_file.id,
    )

    assert resolved.body == body
    assert resolved.mime_type == "image/png"


def test_workflow_grant_rejects_invalid_context_and_file_shape() -> None:
    image = File(
        file_type=FileType.IMAGE,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        reference="file-1",
    )
    with pytest.raises(query_images.KnowledgeFSQueryImageError) as invalid_context:
        query_images.issue_workflow_query_image_reference(
            app_id=" ",
            file=image,
            tenant_id="tenant-1",
        )
    assert invalid_context.value.code == "QUERY_IMAGE_CONTEXT_INVALID"

    with pytest.raises(query_images.KnowledgeFSQueryImageError) as invalid_type:
        query_images.issue_workflow_query_image_reference(
            app_id="app-1",
            file=File(
                file_type=FileType.DOCUMENT,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                reference="file-1",
            ),
            tenant_id="tenant-1",
        )
    assert invalid_type.value.code == "QUERY_IMAGE_MIME_UNSUPPORTED"

    object.__setattr__(image, "reference", None)
    with pytest.raises(query_images.KnowledgeFSQueryImageError) as missing_reference:
        query_images.issue_workflow_query_image_reference(
            app_id="app-1",
            file=image,
            tenant_id="tenant-1",
        )
    assert missing_reference.value.code == "QUERY_IMAGE_REFERENCE_UNSUPPORTED"


def test_workflow_grant_rejects_cross_tenant_files_and_expiry(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    upload = _upload(tenant_id="other-tenant")

    _persist_files(sqlite_session, [upload])
    with pytest.raises(query_images.KnowledgeFSQueryImageError) as cross_tenant:
        query_images.issue_workflow_query_image_reference(
            app_id="app-1",
            file=File(
                file_type=FileType.IMAGE,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                reference=upload.id,
            ),
            now=1_000,
            tenant_id="tenant-1",
        )
    assert cross_tenant.value.code == "QUERY_IMAGE_NOT_FOUND"

    grant = query_images._encode_workflow_query_image_grant(
        query_images._WorkflowQueryImageGrant(
            expires_at=1_000,
            file_id=upload.id,
            file_kind="upload_file",
            subject_id="dify-app:app-1",
            tenant_id="tenant-1",
        )
    )
    monkeypatch.setattr(query_images.time, "time", lambda: 1_000)
    with pytest.raises(query_images.KnowledgeFSQueryImageError) as expired:
        query_images._decode_workflow_query_image_grant(
            grant,
            expected_file_id=upload.id,
            expected_subject_id="dify-app:app-1",
            expected_tenant_id="tenant-1",
        )
    assert expired.value.code == "QUERY_IMAGE_GRANT_EXPIRED"


def test_reference_shape_rejects_duplicates_and_over_count() -> None:
    with pytest.raises(query_images.KnowledgeFSQueryImageError, match="duplicate"):
        query_images._validate_reference_ids(["same", "same"])
    with pytest.raises(query_images.KnowledgeFSQueryImageError, match="max count"):
        query_images._validate_reference_ids([str(index) for index in range(5)])


@pytest.mark.parametrize("file_kind", ["upload_file", "tool_file"])
@pytest.mark.parametrize("unavailable", ["deleted", "other_tenant"])
def test_workflow_grant_rechecks_persisted_file_availability(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    sqlite_session: Session,
    file_kind: str,
    unavailable: str,
) -> None:
    upload = _upload()
    if file_kind == "tool_file":
        record: UploadFile | ToolFile = ToolFile(
            conversation_id=None,
            tenant_id="tenant-1",
            user_id="account-1",
            file_key="tool-files/image.png",
            mimetype="image/png",
            size=12,
        )
    else:
        record = upload
    record.id = upload.id
    _persist_files(sqlite_session, [record])
    config_overrides(SECRET_KEY="test-secret")
    monkeypatch.setattr(query_images.time, "time", lambda: 1_001)
    reference = query_images.issue_workflow_query_image_reference(
        app_id="app-1",
        file=File(
            file_type=FileType.IMAGE,
            transfer_method=FileTransferMethod.TOOL_FILE if file_kind == "tool_file" else FileTransferMethod.LOCAL_FILE,
            reference=record.id,
        ),
        now=1_000,
        tenant_id="tenant-1",
    )
    if unavailable == "deleted":
        sqlite_session.delete(record)
    else:
        record.tenant_id = "other-tenant"
    sqlite_session.commit()

    with pytest.raises(query_images.KnowledgeFSQueryImageError) as error:
        query_images.load_query_image(
            access_grant=reference.access_grant,
            subject_id="dify-app:app-1",
            tenant_id="tenant-1",
            upload_file_id=record.id,
        )

    assert error.value.code == "QUERY_IMAGE_NOT_FOUND"
