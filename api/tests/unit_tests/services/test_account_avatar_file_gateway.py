from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_storage import storage
from extensions.storage.opendal_storage import OpenDALStorage
from extensions.storage.storage_type import StorageType
from models.account import Tenant
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.account_avatar_file_gateway import SQLAlchemyAccountAvatarFileGateway


def _persist_upload_file(session: Session, *, file_id: str, account_id: str) -> None:
    tenant = Tenant(name=f"Tenant {file_id}")
    tenant.id = f"tenant-{file_id}"
    upload_file = UploadFile(
        tenant_id=tenant.id,
        storage_type=StorageType.LOCAL,
        key="avatar.png",
        name="avatar.png",
        size=128,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account_id,
        created_at=datetime.now(UTC).replace(tzinfo=None),
        used=False,
    )
    upload_file.id = file_id
    session.add_all([tenant, upload_file])
    session.commit()


def test_gateway_signs_only_an_avatar_owned_by_the_account(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_upload_file(sqlite_session, file_id="file-1", account_id="account-1")
    gateway = SQLAlchemyAccountAvatarFileGateway(session_factory=sqlite_session_factory)

    with patch(
        "services.account_avatar_file_gateway.file_helpers.get_signed_file_url",
        return_value="https://signed.example/avatar",
    ) as signer:
        owned_url = gateway.get_owned_signed_url(account_id="account-1", upload_file_id="file-1")
        unowned_url = gateway.get_owned_signed_url(account_id="account-2", upload_file_id="file-1")

    assert owned_url == "https://signed.example/avatar"
    assert unowned_url is None
    signer.assert_called_once_with(upload_file_id="file-1")


def test_failed_metadata_insert_removes_the_new_blob(
    sqlite_session_factory: sessionmaker[Session], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(storage, "storage_runner", OpenDALStorage("fs", root=str(tmp_path)), raising=False)
    with sqlite_session_factory.begin() as session:
        session.execute(
            text(
                "CREATE TRIGGER reject_avatar BEFORE INSERT ON upload_files BEGIN SELECT RAISE(ABORT, 'rejected'); END"
            )
        )
    content = BytesIO()
    Image.new("RGB", (8, 8), "blue").save(content, format="PNG")
    gateway = SQLAlchemyAccountAvatarFileGateway(session_factory=sqlite_session_factory)
    with pytest.raises(IntegrityError, match="rejected"):
        gateway.upload(account_id="account-1", filename="avatar.png", content=content.getvalue())
    assert not any(path.is_file() for path in tmp_path.rglob("*"))
