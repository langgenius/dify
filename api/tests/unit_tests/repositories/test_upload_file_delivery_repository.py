from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session, sessionmaker

from extensions.storage.storage_type import StorageType
from models.account import Tenant
from models.enums import CreatorUserRole
from models.model import UploadFile
from repositories.upload_file_delivery_repository import UploadFileDeliveryQueryRepository
from services.upload_file_delivery_service import UploadFileDeliveryNotFoundError, UploadFileDeliveryRecord

WORKSPACE_ID = "11111111-1111-1111-1111-111111111111"
OTHER_WORKSPACE_ID = "22222222-2222-2222-2222-222222222222"
FILE_ID = "33333333-3333-3333-3333-333333333333"
OTHER_FILE_ID = "44444444-4444-4444-4444-444444444444"


def _upload_file(*, file_id: str = FILE_ID, tenant_id: str = WORKSPACE_ID) -> UploadFile:
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"upload_files/{tenant_id}/{file_id}.png",
        name="logo.png",
        size=42,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="55555555-5555-5555-5555-555555555555",
        created_at=datetime.now(UTC),
        used=True,
    )
    upload_file.id = file_id
    return upload_file


def _workspace(*, workspace_id: str = WORKSPACE_ID, logo_file_id: str | None = None) -> Tenant:
    workspace = Tenant(name=f"Workspace {workspace_id}")
    workspace.id = workspace_id
    if logo_file_id is not None:
        workspace.custom_config_dict = {"replace_webapp_logo": logo_file_id}
    return workspace


def _repository(session_factory: sessionmaker[Session]) -> UploadFileDeliveryQueryRepository:
    return UploadFileDeliveryQueryRepository(session_factory=session_factory)


def test_get_by_id_returns_detached_record(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    upload_file = _upload_file()
    sqlite_session.add(upload_file)
    sqlite_session.commit()

    result = _repository(sqlite_session_factory).get_by_id(file_id=upload_file.id)

    assert result == UploadFileDeliveryRecord(
        key=upload_file.key,
        name=upload_file.name,
        size=upload_file.size,
        extension=upload_file.extension,
        mime_type=upload_file.mime_type,
    )


def test_get_by_id_returns_none_when_file_does_not_exist(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    assert _repository(sqlite_session_factory).get_by_id(file_id=FILE_ID) is None


def test_get_workspace_logo_returns_workspace_owned_file(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    upload_file = _upload_file()
    sqlite_session.add_all([_workspace(logo_file_id=upload_file.id), upload_file])
    sqlite_session.commit()

    result = _repository(sqlite_session_factory).get_workspace_logo(workspace_id=WORKSPACE_ID)

    assert result == UploadFileDeliveryRecord(
        key=upload_file.key,
        name=upload_file.name,
        size=upload_file.size,
        extension=upload_file.extension,
        mime_type=upload_file.mime_type,
    )


def test_get_workspace_logo_rejects_missing_workspace(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with pytest.raises(UploadFileDeliveryNotFoundError):
        _repository(sqlite_session_factory).get_workspace_logo(workspace_id=WORKSPACE_ID)


def test_get_workspace_logo_rejects_workspace_without_configured_logo(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add(_workspace())
    sqlite_session.commit()

    with pytest.raises(UploadFileDeliveryNotFoundError, match="webapp logo is not found"):
        _repository(sqlite_session_factory).get_workspace_logo(workspace_id=WORKSPACE_ID)


def test_get_workspace_logo_returns_none_when_configured_file_does_not_exist(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add(_workspace(logo_file_id=FILE_ID))
    sqlite_session.commit()

    assert _repository(sqlite_session_factory).get_workspace_logo(workspace_id=WORKSPACE_ID) is None


def test_get_workspace_logo_rejects_file_owned_by_another_workspace(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    foreign_logo = _upload_file(file_id=OTHER_FILE_ID, tenant_id=OTHER_WORKSPACE_ID)
    sqlite_session.add_all([_workspace(logo_file_id=foreign_logo.id), foreign_logo])
    sqlite_session.commit()

    assert _repository(sqlite_session_factory).get_workspace_logo(workspace_id=WORKSPACE_ID) is None
