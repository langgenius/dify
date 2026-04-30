"""Testcontainers integration tests for AttachmentService."""

import base64
from datetime import UTC, datetime
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import NotFound

import services.attachment_service as attachment_service_module
from extensions.ext_database import db
from extensions.storage.storage_type import StorageType
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.attachment_service import AttachmentService


class TestAttachmentService:
    def _create_upload_file(self, db_session_with_containers, *, tenant_id: str | None = None) -> UploadFile:
        upload_file = UploadFile(
            tenant_id=tenant_id or str(uuid4()),
            storage_type=StorageType.OPENDAL,
            key=f"upload/{uuid4()}.txt",
            name="test-file.txt",
            size=100,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=str(uuid4()),
            created_at=datetime.now(UTC),
            used=False,
        )
        db_session_with_containers.add(upload_file)
        db_session_with_containers.commit()
        return upload_file

    def test_should_initialize_with_sessionmaker(self):
        session_factory = sessionmaker()

        service = AttachmentService(session_factory=session_factory)

        assert service._session_maker is session_factory

    def test_should_initialize_with_engine(self):
        engine = create_engine("sqlite:///:memory:")

        service = AttachmentService(session_factory=engine)
        session = service._session_maker()
        try:
            assert session.bind == engine
        finally:
            session.close()
            engine.dispose()

    @pytest.mark.parametrize("invalid_session_factory", [None, "not-a-session-factory", 1])
    def test_should_raise_assertion_error_for_invalid_session_factory(self, invalid_session_factory):
        with pytest.raises(AssertionError, match="must be a sessionmaker or an Engine."):
            AttachmentService(session_factory=invalid_session_factory)

    def test_should_return_base64_when_file_exists(self, db_session_with_containers):
        upload_file = self._create_upload_file(db_session_with_containers)
        service = AttachmentService(session_factory=sessionmaker(bind=db.engine))

        with patch.object(attachment_service_module.storage, "load_once", return_value=b"binary-content") as mock_load:
            result = service.get_file_base64(upload_file.id)

        assert result == base64.b64encode(b"binary-content").decode()
        mock_load.assert_called_once_with(upload_file.key)

    def test_should_raise_not_found_when_file_missing(self, db_session_with_containers):
        service = AttachmentService(session_factory=sessionmaker(bind=db.engine))

        with patch.object(attachment_service_module.storage, "load_once") as mock_load:
            with pytest.raises(NotFound, match="File not found"):
                service.get_file_base64(str(uuid4()))

        mock_load.assert_not_called()
