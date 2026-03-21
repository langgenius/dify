import base64
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import NotFound

import services.attachment_service as attachment_service_module
from models.model import UploadFile
from services.attachment_service import AttachmentService


class TestAttachmentService:
    def test_should_initialize_with_sessionmaker_when_sessionmaker_is_provided(self):
        """Test that AttachmentService keeps the provided sessionmaker instance."""
        session_factory = sessionmaker()

        service = AttachmentService(session_factory=session_factory)

        assert service._session_maker is session_factory

    def test_should_initialize_with_bound_sessionmaker_when_engine_is_provided(self):
        """Test that AttachmentService builds a sessionmaker bound to the provided engine."""
        engine = create_engine("sqlite:///:memory:")

        service = AttachmentService(session_factory=engine)
        session = service._session_maker()
        try:
            assert session.bind == engine
        finally:
            session.close()
            engine.dispose()

    @pytest.mark.parametrize("invalid_session_factory", [None, "not-a-session-factory", 1])
    def test_should_raise_assertion_error_when_session_factory_type_is_invalid(self, invalid_session_factory):
        """Test that invalid session_factory types are rejected."""
        with pytest.raises(AssertionError, match="must be a sessionmaker or an Engine."):
            AttachmentService(session_factory=invalid_session_factory)

    def test_should_return_base64_encoded_blob_when_file_exists(self):
        """Test that existing files are loaded from storage and returned as base64."""
        service = AttachmentService(session_factory=sessionmaker())
        upload_file = MagicMock(spec=UploadFile)
        upload_file.key = "upload-file-key"

        session = MagicMock()
        session.query.return_value.where.return_value.first.return_value = upload_file
        service._session_maker = MagicMock(return_value=session)

        with patch.object(attachment_service_module.storage, "load_once", return_value=b"binary-content") as mock_load:
            result = service.get_file_base64("file-123")

        assert result == base64.b64encode(b"binary-content").decode()
        service._session_maker.assert_called_once_with(expire_on_commit=False)
        session.query.assert_called_once_with(UploadFile)
        mock_load.assert_called_once_with("upload-file-key")

    def test_should_raise_not_found_when_file_does_not_exist(self):
        """Test that missing files raise NotFound and never call storage."""
        service = AttachmentService(session_factory=sessionmaker())

        session = MagicMock()
        session.query.return_value.where.return_value.first.return_value = None
        service._session_maker = MagicMock(return_value=session)

        with patch.object(attachment_service_module.storage, "load_once") as mock_load:
            with pytest.raises(NotFound, match="File not found"):
                service.get_file_base64("missing-file")

        service._session_maker.assert_called_once_with(expire_on_commit=False)
        session.query.assert_called_once_with(UploadFile)
        mock_load.assert_not_called()
