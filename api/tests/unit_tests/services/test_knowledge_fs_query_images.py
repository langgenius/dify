from __future__ import annotations

from contextlib import nullcontext
from types import SimpleNamespace

import pytest

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
) -> SimpleNamespace:
    return SimpleNamespace(
        created_by=account_id,
        created_by_role=CreatorUserRole.ACCOUNT,
        id=upload_file_id,
        key=f"uploads/{upload_file_id}",
        mime_type=mime_type,
        size=size,
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


def test_reference_shape_rejects_duplicates_and_over_count() -> None:
    with pytest.raises(query_images.KnowledgeFSQueryImageError, match="duplicate"):
        query_images._validate_reference_ids(["same", "same"])
    with pytest.raises(query_images.KnowledgeFSQueryImageError, match="max count"):
        query_images._validate_reference_ids([str(index) for index in range(5)])
