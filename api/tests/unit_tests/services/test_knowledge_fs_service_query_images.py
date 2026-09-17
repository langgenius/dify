from __future__ import annotations

from contextlib import nullcontext
from io import BytesIO
from types import SimpleNamespace

import pytest
from werkzeug.datastructures import FileStorage

from core.knowledge_fs.errors import KnowledgeFSProductRequestRejectedError, KnowledgeFSQueryImageError
from models.enums import ApiTokenType, CreatorUserRole
from services.knowledge_fs import query_images, service_query_image_upload
from services.knowledge_fs.service_api_authorization import KnowledgeFSServiceApiProfile

TOKEN_ID = "00000000-0000-4000-8000-000000000001"
OTHER_TOKEN_ID = "00000000-0000-4000-8000-000000000002"
TENANT_ID = "00000000-0000-4000-8000-000000000003"
FILE_ID = "00000000-0000-4000-8000-000000000004"
PNG = b"\x89PNG\r\n\x1a\nimage"
PROFILE = KnowledgeFSServiceApiProfile(TENANT_ID, "control", TOKEN_ID, TOKEN_ID, "space", 1, 1, 1, 1, 1)
SUBJECT = f"dify-dataset-api-key:{TOKEN_ID}"


class _Session:
    def __init__(self) -> None:
        self.active_token: str | None = TOKEN_ID
        self.queries: list[dict[str, object]] = []
        self.added: list[object] = []
        self.committed = False
        self.fail_commit = False

    def scalar(self, statement):
        params = statement.compile().params
        self.queries.append(params)
        assert params["tenant_id_1"] == TENANT_ID
        assert params["type_1"] == ApiTokenType.DATASET
        return self.active_token if params["id_1"] == self.active_token else None

    def add(self, item) -> None:
        self.added.append(item)

    def commit(self) -> None:
        if self.fail_commit:
            raise RuntimeError("injected database failure")
        self.committed = True


def _install(monkeypatch: pytest.MonkeyPatch) -> tuple[_Session, dict[str, bytes]]:
    session = _Session()
    objects: dict[str, bytes] = {}
    monkeypatch.setattr(query_images.session_factory, "create_session", lambda: nullcontext(session))
    monkeypatch.setattr(service_query_image_upload.storage, "save", lambda key, body: objects.__setitem__(key, body))
    monkeypatch.setattr(service_query_image_upload.storage, "delete", lambda key: objects.pop(key, None))
    monkeypatch.setattr(query_images.storage, "load", lambda key, **_kwargs: iter([objects[key]]))
    monkeypatch.setattr(service_query_image_upload, "dify_config", SimpleNamespace(STORAGE_TYPE="local"))
    return session, objects


def _file(body: bytes = PNG, *, mime_type: str = "image/png", filename: str = "image.png") -> FileStorage:
    return FileStorage(stream=BytesIO(body), filename=filename, content_type=mime_type)


def _record(*, role: CreatorUserRole = CreatorUserRole.DATASET_API_KEY, owner: str = TOKEN_ID):
    return SimpleNamespace(
        id=FILE_ID,
        tenant_id=TENANT_ID,
        created_by_role=role,
        created_by=owner,
        mime_type="image/png",
        size=len(PNG),
        key="image-key",
        used=False,
        used_by=None,
        used_at=None,
    )


def test_upload_admission_and_inner_load_use_same_active_key_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    session, objects = _install(monkeypatch)
    response = service_query_image_upload.upload_service_query_image(profile=PROFILE, file=_file())
    upload = session.added[0]
    assert upload.created_by_role is CreatorUserRole.DATASET_API_KEY
    assert upload.created_by == TOKEN_ID
    assert upload.tenant_id == TENANT_ID
    assert upload.key.startswith(f"upload_files/{TENANT_ID}/")
    assert response == {"upload_file_id": upload.id, "byte_size": len(PNG), "mime_type": "image/png"}
    assert objects[upload.key] == PNG
    assert session.committed
    monkeypatch.setattr(
        query_images.FileService, "get_upload_files_by_ids", lambda *_args, **_kwargs: {upload.id: upload}
    )
    service_query_image_upload.validate_service_query_image_references(profile=PROFILE, upload_file_ids=[upload.id])
    assert upload.used_by == TOKEN_ID  # StringUUID receives the bare token id, never the subject prefix.
    assert upload.used
    result = query_images.load_query_image(tenant_id=TENANT_ID, account_id=SUBJECT, upload_file_id=upload.id)
    assert result.body == PNG
    assert len(session.queries) == 4


@pytest.mark.parametrize(
    ("role", "owner", "actor", "tenant"),
    [
        (CreatorUserRole.DATASET_API_KEY, OTHER_TOKEN_ID, SUBJECT, TENANT_ID),
        (CreatorUserRole.ACCOUNT, TOKEN_ID, SUBJECT, TENANT_ID),
        (CreatorUserRole.END_USER, TOKEN_ID, SUBJECT, TENANT_ID),
        (CreatorUserRole.DATASET_API_KEY, TOKEN_ID, TOKEN_ID, TENANT_ID),
        (CreatorUserRole.DATASET_API_KEY, TOKEN_ID, SUBJECT, "foreign-tenant"),
    ],
)
def test_query_images_never_cross_creator_role_key_or_tenant(
    monkeypatch: pytest.MonkeyPatch, role: CreatorUserRole, owner: str, actor: str, tenant: str
) -> None:
    session, objects = _install(monkeypatch)
    upload = _record(role=role, owner=owner)
    upload.tenant_id = tenant
    objects[upload.key] = PNG
    monkeypatch.setattr(query_images.FileService, "get_upload_files_by_ids", lambda *_a, **_k: {FILE_ID: upload})
    with pytest.raises(KnowledgeFSQueryImageError, match="not found"):
        query_images.validate_query_image_references(
            tenant_id=TENANT_ID, account_id=actor, upload_file_ids=[FILE_ID], mark_used=True
        )
    with pytest.raises(KnowledgeFSQueryImageError, match="not found"):
        query_images.load_query_image(tenant_id=TENANT_ID, account_id=actor, upload_file_id=FILE_ID)
    assert not session.committed


@pytest.mark.parametrize("subject", [SUBJECT, "dify-dataset-api-key:", "dify-dataset-api-key:invalid"])
def test_revoked_or_invalid_service_subject_cannot_read(monkeypatch: pytest.MonkeyPatch, subject: str) -> None:
    session, _ = _install(monkeypatch)
    session.active_token = None
    monkeypatch.setattr(query_images.FileService, "get_upload_files_by_ids", lambda *_a, **_k: {FILE_ID: _record()})
    with pytest.raises(KnowledgeFSQueryImageError, match="not found"):
        query_images.load_query_image(tenant_id=TENANT_ID, account_id=subject, upload_file_id=FILE_ID)


@pytest.mark.parametrize(
    ("file", "status"),
    [
        (None, 400),
        (_file(b"", mime_type="image/png"), 422),
        (_file(PNG, mime_type="image/jpeg"), 422),
        (_file(b"<svg/>", mime_type="image/svg+xml"), 422),
        (_file(b"not-an-image", mime_type="image/png"), 422),
        (_file(filename="../image.png"), 422),
        (_file(b"x" * (query_images.QUERY_IMAGE_MAX_BYTES + 1)), 413),
    ],
)
def test_upload_rejects_invalid_input_before_storage(
    monkeypatch: pytest.MonkeyPatch, file: FileStorage | None, status: int
) -> None:
    session, objects = _install(monkeypatch)
    with pytest.raises(KnowledgeFSProductRequestRejectedError) as error:
        service_query_image_upload.upload_service_query_image(profile=PROFILE, file=file)
    assert error.value.status_code == status
    assert not objects
    assert not session.added


@pytest.mark.parametrize("failure", ["commit", "storage", "revoke"])
def test_upload_failure_cleans_its_object(monkeypatch: pytest.MonkeyPatch, failure: str) -> None:
    session, objects = _install(monkeypatch)
    session.fail_commit = failure == "commit"

    def save(key: str, body: bytes) -> None:
        objects[key] = body
        if failure == "storage":
            raise RuntimeError("injected partial storage failure")
        if failure == "revoke":
            session.active_token = None

    monkeypatch.setattr(service_query_image_upload.storage, "save", save)
    with pytest.raises((RuntimeError, KnowledgeFSProductRequestRejectedError)):
        service_query_image_upload.upload_service_query_image(profile=PROFILE, file=_file())
    assert not objects
    assert not session.committed


def test_service_admission_reports_revoked_reference_as_safe_rejection(monkeypatch: pytest.MonkeyPatch) -> None:
    session, _ = _install(monkeypatch)
    session.active_token = None
    with pytest.raises(KnowledgeFSProductRequestRejectedError) as error:
        service_query_image_upload.validate_service_query_image_references(profile=PROFILE, upload_file_ids=[FILE_ID])
    assert error.value.status_code == 422
    assert error.value.violations == [{"field": ["queryImages"], "type": "QUERY_IMAGE_NOT_FOUND"}]
