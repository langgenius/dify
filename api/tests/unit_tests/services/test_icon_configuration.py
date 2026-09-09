from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from extensions.storage.storage_type import StorageType
from models.enums import CreatorUserRole
from models.model import IconType, UploadFile
from services.icon_configuration import is_valid_image_icon

TENANT_ID = "22222222-2222-2222-2222-222222222222"
OTHER_TENANT_ID = "33333333-3333-3333-3333-333333333333"
FILE_ID = "44444444-4444-4444-4444-444444444444"
ACCOUNT_ID = "55555555-5555-5555-5555-555555555555"


def _upload_file(*, tenant_id: str) -> UploadFile:
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"upload_files/{tenant_id}/icon.png",
        name="icon.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=ACCOUNT_ID,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        used=True,
    )
    upload_file.id = FILE_ID
    return upload_file


def test_validate_icon_reference_accepts_tenant_owned_file(sqlite_session: Session) -> None:
    sqlite_session.add(_upload_file(tenant_id=TENANT_ID))
    sqlite_session.commit()

    assert is_valid_image_icon(
        session=sqlite_session,
        tenant_id=TENANT_ID,
        icon_type=IconType.IMAGE,
        icon=FILE_ID,
    )


@pytest.mark.parametrize("persisted_tenant_id", [None, OTHER_TENANT_ID], ids=["missing", "cross-tenant"])
def test_validate_icon_reference_rejects_unavailable_file(
    sqlite_session: Session,
    persisted_tenant_id: str | None,
) -> None:
    if persisted_tenant_id is not None:
        sqlite_session.add(_upload_file(tenant_id=persisted_tenant_id))
        sqlite_session.commit()

    assert not is_valid_image_icon(
        session=sqlite_session,
        tenant_id=TENANT_ID,
        icon_type=IconType.IMAGE,
        icon=FILE_ID,
    )


def test_validate_icon_reference_rejects_empty_image_icon(sqlite_session: Session) -> None:
    assert not is_valid_image_icon(
        session=sqlite_session,
        tenant_id=TENANT_ID,
        icon_type=IconType.IMAGE,
        icon=None,
    )


def test_validate_icon_reference_rejects_non_uuid_without_querying_database(sqlite_session: Session) -> None:
    assert not is_valid_image_icon(
        session=sqlite_session,
        tenant_id=TENANT_ID,
        icon_type=IconType.IMAGE,
        icon="not-a-uuid",
    )
