from __future__ import annotations

from contextlib import nullcontext
from types import SimpleNamespace

import pytest

from graphon.file import File, FileTransferMethod, FileType
from models.enums import CreatorUserRole
from services.knowledge_fs import query_images


class _Session:
    committed = False

    def commit(self) -> None:
        self.committed = True


def _upload(
    *,
    upload_file_id: str = "00000000-0000-4000-8000-000000000001",
    account_id: str = "account-1",
    mime_type: str = "image/png",
    size: int = 12,
    tenant_id: str = "tenant-1",
) -> SimpleNamespace:
    return SimpleNamespace(
        created_by=account_id,
        created_by_role=CreatorUserRole.ACCOUNT,
        id=upload_file_id,
        key=f"uploads/{upload_file_id}",
        mime_type=mime_type,
        size=size,
        tenant_id=tenant_id,
        used=False,
        used_at=None,
        used_by=None,
    )


def _install_files(monkeypatch: pytest.MonkeyPatch, files: list[SimpleNamespace]) -> _Session:
    session = _Session()

    def get_upload_files_by_ids(_tenant_id: str, _ids: list[str], *, session: _Session) -> dict[str, SimpleNamespace]:
        assert session is not None
        return {item.id: item for item in files}

    monkeypatch.setattr(query_images.session_factory, "create_session", lambda: nullcontext(session))
    monkeypatch.setattr(
        query_images.FileService,
        "get_upload_files_by_ids",
        get_upload_files_by_ids,
    )
    return session


def test_validate_query_images_checks_actor_bounds_and_marks_usage(monkeypatch: pytest.MonkeyPatch) -> None:
    upload = _upload()
    session = _install_files(monkeypatch, [upload])
    monkeypatch.setattr(query_images, "naive_utc_now", lambda: "now")

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
    assert upload.used is True
    assert upload.used_by == "account-1"
    assert upload.used_at == "now"
    assert session.committed is True


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
    monkeypatch: pytest.MonkeyPatch,
    upload: SimpleNamespace,
    code: str,
) -> None:
    _install_files(monkeypatch, [upload])

    with pytest.raises(query_images.KnowledgeFSQueryImageError) as error:
        query_images.validate_query_image_references(
            tenant_id="tenant-1",
            account_id="account-1",
            upload_file_ids=[upload.id],
            mark_used=False,
        )

    assert error.value.code == code


def test_validate_query_images_rejects_missing_and_oversized_aggregate(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_files(monkeypatch, [])
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
    _install_files(monkeypatch, uploads)
    with pytest.raises(query_images.KnowledgeFSQueryImageError) as oversized:
        query_images.validate_query_image_references(
            tenant_id="tenant-1",
            account_id="account-1",
            upload_file_ids=[upload.id for upload in uploads],
            mark_used=False,
        )
    assert oversized.value.code == "QUERY_IMAGE_TOTAL_TOO_LARGE"


def test_load_query_image_sniffs_bytes_and_hashes_content(monkeypatch: pytest.MonkeyPatch) -> None:
    body = b"\x89PNG\r\n\x1a\nrest"
    upload = _upload(size=len(body))
    _install_files(monkeypatch, [upload])
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


def test_load_query_image_stops_when_stream_exceeds_declared_size(monkeypatch: pytest.MonkeyPatch) -> None:
    upload = _upload(size=8)
    _install_files(monkeypatch, [upload])
    image_stream = iter((b"\x89PNG\r\n\x1a\n", b"unexpected"))

    def load(_key: str, *, stream: bool = False):
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
) -> None:
    body = b"\x89PNG\r\n\x1a\nrest"
    upload = _upload(account_id="another-account", size=len(body))
    _install_files(monkeypatch, [upload])

    class _Controller:
        def get_upload_file(self, **_kwargs: object) -> SimpleNamespace:
            return upload

    monkeypatch.setattr(query_images, "DatabaseFileAccessController", _Controller)
    monkeypatch.setattr(query_images.dify_config, "SECRET_KEY", "test-secret")
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


def test_workflow_grant_loads_tool_files(monkeypatch: pytest.MonkeyPatch) -> None:
    body = b"\x89PNG\r\n\x1a\nrest"
    tool_file = SimpleNamespace(
        file_key="tool-files/image.png",
        id="00000000-0000-4000-8000-000000000002",
        mimetype="image/png",
        size=len(body),
        tenant_id="tenant-1",
    )

    class _ToolFileSession(_Session):
        def get(self, model: object, file_id: str) -> SimpleNamespace | None:
            assert model is query_images.ToolFile
            return tool_file if file_id == tool_file.id else None

    class _Controller:
        def get_tool_file(self, **_kwargs: object) -> SimpleNamespace:
            return tool_file

    monkeypatch.setattr(query_images.session_factory, "create_session", lambda: nullcontext(_ToolFileSession()))
    monkeypatch.setattr(query_images, "DatabaseFileAccessController", _Controller)
    monkeypatch.setattr(query_images.dify_config, "SECRET_KEY", "test-secret")
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


def test_workflow_grant_rejects_cross_tenant_files_and_expiry(monkeypatch: pytest.MonkeyPatch) -> None:
    upload = _upload(tenant_id="other-tenant")

    class _Controller:
        def get_upload_file(self, **_kwargs: object) -> SimpleNamespace:
            return upload

    monkeypatch.setattr(query_images, "DatabaseFileAccessController", _Controller)
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
