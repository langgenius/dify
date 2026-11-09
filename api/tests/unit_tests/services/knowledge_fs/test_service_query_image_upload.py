from __future__ import annotations

from datetime import datetime
from io import BytesIO

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from werkzeug.datastructures import FileStorage

from extensions.storage.storage_type import StorageType
from models.enums import ApiTokenType, CreatorUserRole
from models.model import ApiToken, UploadFile
from services.knowledge_fs import query_images, service_query_image_upload
from services.knowledge_fs.errors import KnowledgeFSProductRequestRejectedError, KnowledgeFSQueryImageError
from services.knowledge_fs.service_api_authorization import KnowledgeFSServiceApiProfile
from tests.helpers.unit.config_override import apply_config_overrides

TOKEN_ID = "00000000-0000-4000-8000-000000000001"
OTHER_TOKEN_ID = "00000000-0000-4000-8000-000000000002"
TENANT_ID = "00000000-0000-4000-8000-000000000003"
FILE_ID = "00000000-0000-4000-8000-000000000004"
PNG = b"\x89PNG\r\n\x1a\nimage"
PROFILE = KnowledgeFSServiceApiProfile(TENANT_ID, "control", TOKEN_ID, TOKEN_ID, "space", 1, 1, 1, 1, 1)
SUBJECT = f"dify-dataset-api-key:{TOKEN_ID}"


def _install(monkeypatch: pytest.MonkeyPatch) -> dict[str, bytes]:
    """Fake object storage only; database access runs against the shared SQLite fixture."""
    objects: dict[str, bytes] = {}
    monkeypatch.setattr(service_query_image_upload.storage, "save", lambda key, body: objects.__setitem__(key, body))
    monkeypatch.setattr(service_query_image_upload.storage, "delete", lambda key: objects.pop(key, None))
    monkeypatch.setattr(query_images.storage, "load", lambda key, **_kwargs: iter([objects[key]]))
    apply_config_overrides(monkeypatch, STORAGE_TYPE="local")
    return objects


def _seed_token(
    sqlite_session: Session,
    *,
    token_id: str = TOKEN_ID,
    tenant_id: str = TENANT_ID,
    token_type: ApiTokenType = ApiTokenType.DATASET,
) -> None:
    sqlite_session.add(ApiToken(id=token_id, tenant_id=tenant_id, type=token_type, token=f"token-{token_id}"))
    sqlite_session.commit()


def _file(body: bytes = PNG, *, mime_type: str = "image/png", filename: str = "image.png") -> FileStorage:
    return FileStorage(stream=BytesIO(body), filename=filename, content_type=mime_type)


def _record(*, role: CreatorUserRole = CreatorUserRole.DATASET_API_KEY, owner: str = TOKEN_ID) -> UploadFile:
    record = UploadFile(
        tenant_id=TENANT_ID,
        storage_type=StorageType.LOCAL,
        key="image-key",
        name="image.png",
        size=len(PNG),
        extension="png",
        mime_type="image/png",
        created_by_role=role,
        created_by=owner,
        created_at=datetime(2026, 7, 21, 12, 0),
        used=False,
    )
    record.id = FILE_ID
    return record


def test_upload_admission_and_inner_load_use_same_active_key_owner(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    objects = _install(monkeypatch)
    _seed_token(sqlite_session)

    response = service_query_image_upload.upload_service_query_image(profile=PROFILE, file=_file())

    upload = sqlite_session.get(UploadFile, response["upload_file_id"])
    assert upload is not None
    assert upload.created_by_role is CreatorUserRole.DATASET_API_KEY
    assert upload.created_by == TOKEN_ID
    assert upload.tenant_id == TENANT_ID
    assert upload.key.startswith(f"upload_files/{TENANT_ID}/")
    assert response == {"upload_file_id": upload.id, "byte_size": len(PNG), "mime_type": "image/png"}
    assert objects[upload.key] == PNG

    service_query_image_upload.validate_service_query_image_references(profile=PROFILE, upload_file_ids=[upload.id])

    sqlite_session.expire_all()
    marked = sqlite_session.get(UploadFile, upload.id)
    assert marked is not None
    assert marked.used_by == TOKEN_ID  # StringUUID receives the bare token id, never the subject prefix.
    assert marked.used

    result = query_images.load_query_image(tenant_id=TENANT_ID, account_id=SUBJECT, upload_file_id=upload.id)
    assert result.body == PNG


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
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    role: CreatorUserRole,
    owner: str,
    actor: str,
    tenant: str,
) -> None:
    objects = _install(monkeypatch)
    _seed_token(sqlite_session)
    upload = _record(role=role, owner=owner)
    upload.tenant_id = tenant
    objects[upload.key] = PNG
    sqlite_session.add(upload)
    sqlite_session.commit()

    with pytest.raises(KnowledgeFSQueryImageError, match="not found"):
        query_images.validate_query_image_references(
            tenant_id=TENANT_ID, account_id=actor, upload_file_ids=[FILE_ID], mark_used=True
        )
    with pytest.raises(KnowledgeFSQueryImageError, match="not found"):
        query_images.load_query_image(tenant_id=TENANT_ID, account_id=actor, upload_file_id=FILE_ID)

    sqlite_session.expire_all()
    persisted = sqlite_session.get(UploadFile, FILE_ID)
    assert persisted is not None
    assert not persisted.used


@pytest.mark.parametrize("subject", [SUBJECT, "dify-dataset-api-key:", "dify-dataset-api-key:invalid"])
def test_revoked_or_invalid_service_subject_cannot_read(monkeypatch: pytest.MonkeyPatch, subject: str) -> None:
    _install(monkeypatch)
    # No ApiToken row: deleted credentials are revoked, so admission fails before any file lookup.

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
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, file: FileStorage | None, status: int
) -> None:
    objects = _install(monkeypatch)
    _seed_token(sqlite_session)

    with pytest.raises(KnowledgeFSProductRequestRejectedError) as error:
        service_query_image_upload.upload_service_query_image(profile=PROFILE, file=file)
    assert error.value.status_code == status
    assert not objects
    assert sqlite_session.scalar(select(UploadFile)) is None


@pytest.mark.parametrize("failure", ["commit", "storage", "revoke"])
def test_upload_failure_cleans_its_object(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    objects = _install(monkeypatch)
    _seed_token(sqlite_session)

    if failure == "commit":

        def boom(_session: Session) -> None:
            raise RuntimeError("injected database failure")

        monkeypatch.setattr(Session, "commit", boom)

    def save(key: str, body: bytes) -> None:
        objects[key] = body
        if failure == "storage":
            raise RuntimeError("injected partial storage failure")
        if failure == "revoke":
            sqlite_session.execute(delete(ApiToken).where(ApiToken.id == TOKEN_ID))
            sqlite_session.commit()

    monkeypatch.setattr(service_query_image_upload.storage, "save", save)
    with pytest.raises((RuntimeError, KnowledgeFSProductRequestRejectedError)):
        service_query_image_upload.upload_service_query_image(profile=PROFILE, file=_file())
    assert not objects


def test_service_admission_reports_revoked_reference_as_safe_rejection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install(monkeypatch)
    # No ApiToken row: the dataset credential was revoked.

    with pytest.raises(KnowledgeFSProductRequestRejectedError) as error:
        service_query_image_upload.validate_service_query_image_references(profile=PROFILE, upload_file_ids=[FILE_ID])
    assert error.value.status_code == 422
    assert error.value.violations == [{"field": ["queryImages"], "type": "QUERY_IMAGE_NOT_FOUND"}]
