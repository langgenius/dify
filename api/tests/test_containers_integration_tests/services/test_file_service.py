import hashlib
from io import BytesIO
from unittest.mock import create_autospec, patch

import pytest
from faker import Faker
from sqlalchemy import Engine
from werkzeug.exceptions import NotFound

from configs import dify_config
from models import Account, Tenant
from models.enums import CreatorUserRole
from models.model import EndUser, UploadFile
from services.errors.file import FileTooLargeError, UnsupportedFileTypeError
from services.file_service import FileService


class TestFileService:
    """Integration tests for FileService using testcontainers."""

    @pytest.fixture
    def engine(self, db_session_with_containers):
        bind = db_session_with_containers.get_bind()
        assert isinstance(bind, Engine)
        return bind

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.file_service.storage") as mock_storage,
            patch("services.file_service.file_helpers") as mock_file_helpers,
            patch("services.file_service.ExtractProcessor") as mock_extract_processor,
        ):
            # Setup default mock returns
            mock_storage.save.return_value = None
            mock_storage.load.return_value = BytesIO(b"mock file content")
            mock_file_helpers.get_signed_file_url.return_value = "https://example.com/signed-url"
            mock_file_helpers.verify_image_signature.return_value = True
            mock_file_helpers.verify_file_signature.return_value = True
            mock_extract_processor.load_from_upload_file.return_value = "extracted text content"

            yield {
                "storage": mock_storage,
                "file_helpers": mock_file_helpers,
                "extract_processor": mock_extract_processor,
            }

    def _create_test_account(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Helper method to create a test account for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            Account: Created account instance
        """
        fake = Faker()

        # Create account
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )

        from extensions.ext_database import db

        db.session.add(account)
        db.session.commit()

        # Create tenant for the account
        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join
        from models.account import TenantAccountJoin, TenantAccountRole

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

        # Set current tenant for account
        account.current_tenant = tenant

        return account

    def _create_test_end_user(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Helper method to create a test end user for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            EndUser: Created end user instance
        """
        fake = Faker()

        end_user = EndUser(
            tenant_id=str(fake.uuid4()),
            type="web",
            name=fake.name(),
            is_anonymous=False,
            session_id=fake.uuid4(),
        )

        from extensions.ext_database import db

        db.session.add(end_user)
        db.session.commit()

        return end_user

    def _create_test_upload_file(self, db_session_with_containers, mock_external_service_dependencies, account):
        """
        Helper method to create a test upload file for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            account: Account instance

        Returns:
            UploadFile: Created upload file instance
        """
        fake = Faker()

        upload_file = UploadFile(
            tenant_id=account.current_tenant_id if hasattr(account, "current_tenant_id") else str(fake.uuid4()),
            storage_type="local",
            key=f"upload_files/test/{fake.uuid4()}.txt",
            name="test_file.txt",
            size=1024,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
            created_at=fake.date_time(),
            used=False,
            hash=hashlib.sha3_256(b"test content").hexdigest(),
            source_url="",
        )

        from extensions.ext_database import db

        db.session.add(upload_file)
        db.session.commit()

        return upload_file

    # Test upload_file method
    def test_upload_file_success(self, db_session_with_containers, engine, mock_external_service_dependencies):
        """
        Test successful file upload with valid parameters.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        filename = "test_document.pdf"
        content = b"test file content"
        mimetype = "application/pdf"

        upload_file = FileService(engine).upload_file(
            filename=filename,
            content=content,
            mimetype=mimetype,
            user=account,
        )

        assert upload_file is not None
        assert upload_file.name == filename
        assert upload_file.size == len(content)
        assert upload_file.extension == "pdf"
        assert upload_file.mime_type == mimetype
        assert upload_file.created_by == account.id
        assert upload_file.created_by_role == CreatorUserRole.ACCOUNT
        assert upload_file.used is False
        assert upload_file.hash == hashlib.sha3_256(content).hexdigest()

        # Verify storage was called
        mock_external_service_dependencies["storage"].save.assert_called_once()

        assert upload_file.id is not None

    def test_upload_file_with_end_user(self, db_session_with_containers, engine, mock_external_service_dependencies):
        """
        Test file upload with end user instead of account.
        """
        fake = Faker()
        end_user = self._create_test_end_user(db_session_with_containers, mock_external_service_dependencies)

        filename = "test_image.jpg"
        content = b"test image content"
        mimetype = "image/jpeg"

        upload_file = FileService(engine).upload_file(
            filename=filename,
            content=content,
            mimetype=mimetype,
            user=end_user,
        )

        assert upload_file is not None
        assert upload_file.created_by == end_user.id
        assert upload_file.created_by_role == CreatorUserRole.END_USER

    def test_upload_file_with_datasets_source(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test file upload with datasets source parameter.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        filename = "test_document.pdf"
        content = b"test file content"
        mimetype = "application/pdf"

        upload_file = FileService(engine).upload_file(
            filename=filename,
            content=content,
            mimetype=mimetype,
            user=account,
            source="datasets",
            source_url="https://example.com/source",
        )

        assert upload_file is not None
        assert upload_file.source_url == "https://example.com/source"

    def test_upload_file_invalid_filename_characters(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test file upload with invalid filename characters.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        filename = "test/file<name>.txt"
        content = b"test content"
        mimetype = "text/plain"

        with pytest.raises(ValueError, match="Filename contains invalid characters"):
            FileService(engine).upload_file(
                filename=filename,
                content=content,
                mimetype=mimetype,
                user=account,
            )

    def test_upload_file_filename_too_long(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test file upload with filename that exceeds length limit.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Create a filename longer than 200 characters
        long_name = "a" * 250
        filename = f"{long_name}.txt"
        content = b"test content"
        mimetype = "text/plain"

        upload_file = FileService(engine).upload_file(
            filename=filename,
            content=content,
            mimetype=mimetype,
            user=account,
        )

        # Verify filename was truncated (the logic truncates the base name to 200 chars + extension)
        # So the total length should be <= 200 + len(extension) + 1 (for the dot)
        assert len(upload_file.name) <= 200 + len(upload_file.extension) + 1
        assert upload_file.name.endswith(".txt")
        # Verify the base name was truncated
        base_name = upload_file.name[:-4]  # Remove .txt
        assert len(base_name) <= 200

    def test_upload_file_datasets_unsupported_type(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test file upload for datasets with unsupported file type.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        filename = "test_image.jpg"
        content = b"test content"
        mimetype = "image/jpeg"

        with pytest.raises(UnsupportedFileTypeError):
            FileService(engine).upload_file(
                filename=filename,
                content=content,
                mimetype=mimetype,
                user=account,
                source="datasets",
            )

    def test_upload_file_too_large(self, db_session_with_containers, engine, mock_external_service_dependencies):
        """
        Test file upload with file size exceeding limit.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        filename = "large_image.jpg"
        # Create content larger than the limit
        content = b"x" * (dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT * 1024 * 1024 + 1)
        mimetype = "image/jpeg"

        with pytest.raises(FileTooLargeError):
            FileService(engine).upload_file(
                filename=filename,
                content=content,
                mimetype=mimetype,
                user=account,
            )

    # Test is_file_size_within_limit method
    def test_is_file_size_within_limit_image_success(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test file size check for image files within limit.
        """
        extension = "jpg"
        file_size = dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT * 1024 * 1024  # Exactly at limit

        result = FileService(engine).is_file_size_within_limit(extension=extension, file_size=file_size)

        assert result is True

    def test_is_file_size_within_limit_video_success(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test file size check for video files within limit.
        """
        extension = "mp4"
        file_size = dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT * 1024 * 1024  # Exactly at limit

        result = FileService(engine).is_file_size_within_limit(extension=extension, file_size=file_size)

        assert result is True

    def test_is_file_size_within_limit_audio_success(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test file size check for audio files within limit.
        """
        extension = "mp3"
        file_size = dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT * 1024 * 1024  # Exactly at limit

        result = FileService(engine).is_file_size_within_limit(extension=extension, file_size=file_size)

        assert result is True

    def test_is_file_size_within_limit_document_success(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test file size check for document files within limit.
        """
        extension = "pdf"
        file_size = dify_config.UPLOAD_FILE_SIZE_LIMIT * 1024 * 1024  # Exactly at limit

        result = FileService(engine).is_file_size_within_limit(extension=extension, file_size=file_size)

        assert result is True

    def test_is_file_size_within_limit_image_exceeded(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test file size check for image files exceeding limit.
        """
        extension = "jpg"
        file_size = dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT * 1024 * 1024 + 1  # Exceeds limit

        result = FileService(engine).is_file_size_within_limit(extension=extension, file_size=file_size)

        assert result is False

    def test_is_file_size_within_limit_unknown_extension(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test file size check for unknown file extension.
        """
        extension = "xyz"
        file_size = dify_config.UPLOAD_FILE_SIZE_LIMIT * 1024 * 1024  # Uses default limit

        result = FileService(engine).is_file_size_within_limit(extension=extension, file_size=file_size)

        assert result is True

    # Test upload_text method
    def test_upload_text_success(self, db_session_with_containers, engine, mock_external_service_dependencies):
        """
        Test successful text upload.
        """
        fake = Faker()
        text = "This is a test text content"
        text_name = "test_text.txt"

        # Mock current_user using create_autospec
        mock_current_user = create_autospec(Account, instance=True)
        mock_current_user.current_tenant_id = str(fake.uuid4())
        mock_current_user.id = str(fake.uuid4())

        upload_file = FileService(engine).upload_text(
            text=text,
            text_name=text_name,
            user_id=mock_current_user.id,
            tenant_id=mock_current_user.current_tenant_id,
        )

        assert upload_file is not None
        assert upload_file.name == text_name
        assert upload_file.size == len(text)
        assert upload_file.extension == "txt"
        assert upload_file.mime_type == "text/plain"
        assert upload_file.used is True
        assert upload_file.used_by == mock_current_user.id

        # Verify storage was called
        mock_external_service_dependencies["storage"].save.assert_called_once()

    def test_upload_text_name_too_long(self, db_session_with_containers, engine, mock_external_service_dependencies):
        """
        Test text upload with name that exceeds length limit.
        """
        fake = Faker()
        text = "test content"
        long_name = "a" * 250  # Longer than 200 characters

        # Mock current_user using create_autospec
        mock_current_user = create_autospec(Account, instance=True)
        mock_current_user.current_tenant_id = str(fake.uuid4())
        mock_current_user.id = str(fake.uuid4())

        upload_file = FileService(engine).upload_text(
            text=text,
            text_name=long_name,
            user_id=mock_current_user.id,
            tenant_id=mock_current_user.current_tenant_id,
        )

        # Verify name was truncated
        assert len(upload_file.name) <= 200
        assert upload_file.name == "a" * 200

    # Test get_file_preview method
    def test_get_file_preview_success(self, db_session_with_containers, engine, mock_external_service_dependencies):
        """
        Test successful file preview generation.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)
        upload_file = self._create_test_upload_file(
            db_session_with_containers, mock_external_service_dependencies, account
        )

        # Update file to have document extension
        upload_file.extension = "pdf"
        from extensions.ext_database import db

        db.session.commit()

        result = FileService(engine).get_file_preview(file_id=upload_file.id)

        assert result == "extracted text content"
        mock_external_service_dependencies["extract_processor"].load_from_upload_file.assert_called_once()

    def test_get_file_preview_file_not_found(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test file preview with non-existent file.
        """
        fake = Faker()
        non_existent_id = str(fake.uuid4())

        with pytest.raises(NotFound, match="File not found"):
            FileService(engine).get_file_preview(file_id=non_existent_id)

    def test_get_file_preview_unsupported_file_type(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test file preview with unsupported file type.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)
        upload_file = self._create_test_upload_file(
            db_session_with_containers, mock_external_service_dependencies, account
        )

        # Update file to have non-document extension
        upload_file.extension = "jpg"
        from extensions.ext_database import db

        db.session.commit()

        with pytest.raises(UnsupportedFileTypeError):
            FileService(engine).get_file_preview(file_id=upload_file.id)

    def test_get_file_preview_text_truncation(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test file preview with text that exceeds preview limit.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)
        upload_file = self._create_test_upload_file(
            db_session_with_containers, mock_external_service_dependencies, account
        )

        # Update file to have document extension
        upload_file.extension = "pdf"
        from extensions.ext_database import db

        db.session.commit()

        # Mock long text content
        long_text = "x" * 5000  # Longer than PREVIEW_WORDS_LIMIT
        mock_external_service_dependencies["extract_processor"].load_from_upload_file.return_value = long_text

        result = FileService(engine).get_file_preview(file_id=upload_file.id)

        assert len(result) == 3000  # PREVIEW_WORDS_LIMIT
        assert result == "x" * 3000

    # Test get_image_preview method
    def test_get_image_preview_success(self, db_session_with_containers, engine, mock_external_service_dependencies):
        """
        Test successful image preview generation.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)
        upload_file = self._create_test_upload_file(
            db_session_with_containers, mock_external_service_dependencies, account
        )

        # Update file to have image extension
        upload_file.extension = "jpg"
        from extensions.ext_database import db

        db.session.commit()

        timestamp = "1234567890"
        nonce = "test_nonce"
        sign = "test_signature"

        generator, mime_type = FileService(engine).get_image_preview(
            file_id=upload_file.id,
            timestamp=timestamp,
            nonce=nonce,
            sign=sign,
        )

        assert generator is not None
        assert mime_type == upload_file.mime_type
        mock_external_service_dependencies["file_helpers"].verify_image_signature.assert_called_once()

    def test_get_image_preview_invalid_signature(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test image preview with invalid signature.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)
        upload_file = self._create_test_upload_file(
            db_session_with_containers, mock_external_service_dependencies, account
        )

        # Mock invalid signature
        mock_external_service_dependencies["file_helpers"].verify_image_signature.return_value = False

        timestamp = "1234567890"
        nonce = "test_nonce"
        sign = "invalid_signature"

        with pytest.raises(NotFound, match="File not found or signature is invalid"):
            FileService(engine).get_image_preview(
                file_id=upload_file.id,
                timestamp=timestamp,
                nonce=nonce,
                sign=sign,
            )

    def test_get_image_preview_file_not_found(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test image preview with non-existent file.
        """
        fake = Faker()
        non_existent_id = str(fake.uuid4())

        timestamp = "1234567890"
        nonce = "test_nonce"
        sign = "test_signature"

        with pytest.raises(NotFound, match="File not found or signature is invalid"):
            FileService(engine).get_image_preview(
                file_id=non_existent_id,
                timestamp=timestamp,
                nonce=nonce,
                sign=sign,
            )

    def test_get_image_preview_unsupported_file_type(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test image preview with non-image file type.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)
        upload_file = self._create_test_upload_file(
            db_session_with_containers, mock_external_service_dependencies, account
        )

        # Update file to have non-image extension
        upload_file.extension = "pdf"
        from extensions.ext_database import db

        db.session.commit()

        timestamp = "1234567890"
        nonce = "test_nonce"
        sign = "test_signature"

        with pytest.raises(UnsupportedFileTypeError):
            FileService(engine).get_image_preview(
                file_id=upload_file.id,
                timestamp=timestamp,
                nonce=nonce,
                sign=sign,
            )

    # Test get_file_generator_by_file_id method
    def test_get_file_generator_by_file_id_success(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test successful file generator retrieval.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)
        upload_file = self._create_test_upload_file(
            db_session_with_containers, mock_external_service_dependencies, account
        )

        timestamp = "1234567890"
        nonce = "test_nonce"
        sign = "test_signature"

        generator, file_obj = FileService(engine).get_file_generator_by_file_id(
            file_id=upload_file.id,
            timestamp=timestamp,
            nonce=nonce,
            sign=sign,
        )

        assert generator is not None
        assert file_obj.id == upload_file.id
        mock_external_service_dependencies["file_helpers"].verify_file_signature.assert_called_once()

    def test_get_file_generator_by_file_id_invalid_signature(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test file generator retrieval with invalid signature.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)
        upload_file = self._create_test_upload_file(
            db_session_with_containers, mock_external_service_dependencies, account
        )

        # Mock invalid signature
        mock_external_service_dependencies["file_helpers"].verify_file_signature.return_value = False

        timestamp = "1234567890"
        nonce = "test_nonce"
        sign = "invalid_signature"

        with pytest.raises(NotFound, match="File not found or signature is invalid"):
            FileService(engine).get_file_generator_by_file_id(
                file_id=upload_file.id,
                timestamp=timestamp,
                nonce=nonce,
                sign=sign,
            )

    def test_get_file_generator_by_file_id_file_not_found(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test file generator retrieval with non-existent file.
        """
        fake = Faker()
        non_existent_id = str(fake.uuid4())

        timestamp = "1234567890"
        nonce = "test_nonce"
        sign = "test_signature"

        with pytest.raises(NotFound, match="File not found or signature is invalid"):
            FileService(engine).get_file_generator_by_file_id(
                file_id=non_existent_id,
                timestamp=timestamp,
                nonce=nonce,
                sign=sign,
            )

    # Test get_public_image_preview method
    def test_get_public_image_preview_success(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test successful public image preview generation.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)
        upload_file = self._create_test_upload_file(
            db_session_with_containers, mock_external_service_dependencies, account
        )

        # Update file to have image extension
        upload_file.extension = "jpg"
        from extensions.ext_database import db

        db.session.commit()

        generator, mime_type = FileService(engine).get_public_image_preview(file_id=upload_file.id)

        assert generator is not None
        assert mime_type == upload_file.mime_type
        mock_external_service_dependencies["storage"].load.assert_called_once()

    def test_get_public_image_preview_file_not_found(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test public image preview with non-existent file.
        """
        fake = Faker()
        non_existent_id = str(fake.uuid4())

        with pytest.raises(NotFound, match="File not found or signature is invalid"):
            FileService(engine).get_public_image_preview(file_id=non_existent_id)

    def test_get_public_image_preview_unsupported_file_type(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test public image preview with non-image file type.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)
        upload_file = self._create_test_upload_file(
            db_session_with_containers, mock_external_service_dependencies, account
        )

        # Update file to have non-image extension
        upload_file.extension = "pdf"
        from extensions.ext_database import db

        db.session.commit()

        with pytest.raises(UnsupportedFileTypeError):
            FileService(engine).get_public_image_preview(file_id=upload_file.id)

    # Test edge cases and boundary conditions
    def test_upload_file_empty_content(self, db_session_with_containers, engine, mock_external_service_dependencies):
        """
        Test file upload with empty content.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        filename = "empty.txt"
        content = b""
        mimetype = "text/plain"

        upload_file = FileService(engine).upload_file(
            filename=filename,
            content=content,
            mimetype=mimetype,
            user=account,
        )

        assert upload_file is not None
        assert upload_file.size == 0

    def test_upload_file_special_characters_in_name(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test file upload with special characters in filename (but valid ones).
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        filename = "test-file_with_underscores_and.dots.txt"
        content = b"test content"
        mimetype = "text/plain"

        upload_file = FileService(engine).upload_file(
            filename=filename,
            content=content,
            mimetype=mimetype,
            user=account,
        )

        assert upload_file is not None
        assert upload_file.name == filename

    def test_upload_file_different_case_extensions(
        self, db_session_with_containers, engine, mock_external_service_dependencies
    ):
        """
        Test file upload with different case extensions.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        filename = "test.PDF"
        content = b"test content"
        mimetype = "application/pdf"

        upload_file = FileService(engine).upload_file(
            filename=filename,
            content=content,
            mimetype=mimetype,
            user=account,
        )

        assert upload_file is not None
        assert upload_file.extension == "pdf"  # Should be converted to lowercase

    def test_upload_text_empty_text(self, db_session_with_containers, engine, mock_external_service_dependencies):
        """
        Test text upload with empty text.
        """
        fake = Faker()
        text = ""
        text_name = "empty.txt"

        # Mock current_user using create_autospec
        mock_current_user = create_autospec(Account, instance=True)
        mock_current_user.current_tenant_id = str(fake.uuid4())
        mock_current_user.id = str(fake.uuid4())

        upload_file = FileService(engine).upload_text(
            text=text,
            text_name=text_name,
            user_id=mock_current_user.id,
            tenant_id=mock_current_user.current_tenant_id,
        )

        assert upload_file is not None
        assert upload_file.size == 0

    def test_file_size_limits_edge_cases(self, db_session_with_containers, engine, mock_external_service_dependencies):
        """
        Test file size limits with edge case values.
        """
        # Test exactly at limit
        for extension, limit_config in [
            ("jpg", dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT),
            ("mp4", dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT),
            ("mp3", dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT),
            ("pdf", dify_config.UPLOAD_FILE_SIZE_LIMIT),
        ]:
            file_size = limit_config * 1024 * 1024
            result = FileService(engine).is_file_size_within_limit(extension=extension, file_size=file_size)
            assert result is True

            # Test one byte over limit
            file_size = limit_config * 1024 * 1024 + 1
            result = FileService(engine).is_file_size_within_limit(extension=extension, file_size=file_size)
            assert result is False

    def test_upload_file_with_source_url(self, db_session_with_containers, engine, mock_external_service_dependencies):
        """
        Test file upload with source URL that gets overridden by signed URL.
        """
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        filename = "test.pdf"
        content = b"test content"
        mimetype = "application/pdf"
        source_url = "https://original-source.com/file.pdf"

        upload_file = FileService(engine).upload_file(
            filename=filename,
            content=content,
            mimetype=mimetype,
            user=account,
            source_url=source_url,
        )

        # When source_url is provided, it should be preserved
        assert upload_file.source_url == source_url

        # The signed URL should only be set when source_url is empty
        # Let's test that scenario
        upload_file2 = FileService(engine).upload_file(
            filename="test2.pdf",
            content=b"test content 2",
            mimetype="application/pdf",
            user=account,
            source_url="",  # Empty source_url
        )

        # Should have the signed URL when source_url is empty
        assert upload_file2.source_url == "https://example.com/signed-url"
