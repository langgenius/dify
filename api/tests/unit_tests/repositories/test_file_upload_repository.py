from datetime import datetime
from typing import cast
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from models.enums import CreatorUserRole
from models.model import UploadFile
from repositories.file_repository import SQLAlchemyFileRepository
from services.file_upload_service import FileUploadData


@pytest.mark.parametrize("role", [CreatorUserRole.ACCOUNT, CreatorUserRole.END_USER])
def test_create_commits_all_metadata_and_returns_detached_immutable_values(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session], role: CreatorUserRole
) -> None:
    created_at = datetime(2026, 9, 1, 2, 3, 4)
    used_at = datetime(2026, 9, 1, 3, 4, 5)
    data = FileUploadData(
        name="report.txt",
        size=17,
        extension="txt",
        mime_type="text/plain",
        created_by=str(uuid4()),
        created_at=created_at,
        tenant_id=str(uuid4()),
        source_url="https://source.example.com/report.txt",
        key="upload_files/owner/key.txt",
        storage_type="opendal",
        created_by_role=role,
        hash="content-hash",
        used=True,
        used_by=str(uuid4()),
        used_at=used_at,
    )
    result = SQLAlchemyFileRepository(session_factory=sqlite_session_factory).create(upload=data)

    assert UUID(result.id).version == 4
    assert cast(QueuePool, sqlite_engine.pool).checkedout() == 0
    assert result.name == data.name
    assert result.size == data.size
    assert result.extension == data.extension
    assert result.mime_type == data.mime_type
    assert result.created_by == data.created_by
    assert result.created_at == created_at
    assert result.tenant_id == data.tenant_id
    assert result.source_url == data.source_url
    assert result.key == data.key
    assert result.storage_type == data.storage_type
    assert result.created_by_role == role
    assert result.hash == data.hash
    assert result.used is True
    assert result.used_by == data.used_by
    assert result.used_at == used_at
    with sqlite_session_factory() as session:
        persisted = session.scalars(select(UploadFile)).one()
        assert persisted.id == result.id
        assert persisted.created_by_role == role
        assert persisted.tenant_id == data.tenant_id
        assert persisted.source_url == data.source_url
        assert persisted.used_by == data.used_by
        assert persisted.used_at == used_at
