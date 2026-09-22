from dataclasses import replace
from datetime import datetime
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from models.enums import CreatorUserRole
from models.model import UploadFile
from repositories.file_repository import SQLAlchemyFileRepository
from services.file_upload_service import FileUploadData


@pytest.mark.parametrize("different_field", ["id", "tenant_id", "key"])
def test_delete_matches_id_tenant_and_storage_key_before_removing_metadata(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session], different_field: str
) -> None:
    repository = SQLAlchemyFileRepository(session_factory=sqlite_session_factory)
    file = repository.create(
        upload=FileUploadData(
            name="report.txt",
            size=7,
            extension="txt",
            mime_type="text/plain",
            created_by=str(uuid4()),
            created_at=datetime(2026, 9, 1),
            tenant_id=str(uuid4()),
            source_url="",
            key="upload_files/report.txt",
            storage_type="opendal",
            created_by_role=CreatorUserRole.ACCOUNT,
            hash=None,
            used=True,
            used_by=None,
            used_at=None,
        )
    )
    stale = replace(
        file,
        id=str(uuid4()) if different_field == "id" else file.id,
        tenant_id=str(uuid4()) if different_field == "tenant_id" else file.tenant_id,
        key="different-key" if different_field == "key" else file.key,
    )
    repository.delete(file=stale)

    with sqlite_session_factory() as session:
        assert session.get(UploadFile, file.id) is not None
    assert cast(QueuePool, sqlite_engine.pool).checkedout() == 0

    repository.delete(file=file)
    assert cast(QueuePool, sqlite_engine.pool).checkedout() == 0
    with sqlite_session_factory() as session:
        assert session.get(UploadFile, file.id) is None
