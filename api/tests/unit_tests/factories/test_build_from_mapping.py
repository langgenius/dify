import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from httpx import Response
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import DatabaseFileAccessController, FileAccessScope, bind_file_access_scope
from core.workflow.file_reference import build_file_reference, parse_file_reference, resolve_file_record_id
from extensions.storage.storage_type import StorageType
from factories.file_factory.builders import build_from_mapping as _build_from_mapping
from graphon.file import File, FileTransferMethod, FileType, FileUploadConfig
from models import CreatorUserRole, ToolFile, UploadFile

# Test Data
TEST_TENANT_ID = "test_tenant_id"
TEST_UPLOAD_FILE_ID = str(uuid.uuid4())
TEST_TOOL_FILE_ID = str(uuid.uuid4())
TEST_REMOTE_URL = "http://example.com/test.jpg"
TEST_END_USER_ID = "end-user-id"
TEST_ACCESS_CONTROLLER = DatabaseFileAccessController()

# Test Config
TEST_CONFIG = FileUploadConfig(
    allowed_file_types=[FileType.IMAGE, FileType.DOCUMENT],
    allowed_file_extensions=[".jpg", ".pdf"],
    allowed_file_upload_methods=[FileTransferMethod.LOCAL_FILE, FileTransferMethod.TOOL_FILE],
    number_limits=10,
)


def build_from_mapping(*, mapping, tenant_id, config=None, strict_type_validation=False):
    return _build_from_mapping(
        mapping=mapping,
        tenant_id=tenant_id,
        config=config,
        strict_type_validation=strict_type_validation,
        access_controller=TEST_ACCESS_CONTROLLER,
    )


@dataclass(frozen=True)
class FileRecords:
    session: Session
    upload_file: UploadFile
    tool_file: ToolFile


# Fixtures
@pytest.fixture(autouse=True)
def file_records(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> Iterator[FileRecords]:
    """Persist authorized file rows and bind builder-owned sessions to SQLite."""
    UploadFile.metadata.create_all(sqlite_engine, tables=[UploadFile.__table__, ToolFile.__table__])
    sqlite_session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr("core.db.session_factory._session_maker", sqlite_session_maker)

    upload_file = UploadFile(
        tenant_id=TEST_TENANT_ID,
        storage_type=StorageType.LOCAL,
        key="test_key",
        name="test.jpg",
        size=1024,
        extension="jpg",
        mime_type="image/jpeg",
        created_by_role=CreatorUserRole.END_USER,
        created_by=TEST_END_USER_ID,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        used=False,
        source_url=TEST_REMOTE_URL,
    )
    upload_file.id = TEST_UPLOAD_FILE_ID
    tool_file = ToolFile(
        user_id=TEST_END_USER_ID,
        tenant_id=TEST_TENANT_ID,
        conversation_id=None,
        file_key="tool_file.pdf",
        mimetype="application/pdf",
        original_url="http://example.com/tool.pdf",
        name="tool_file.pdf",
        size=2048,
    )
    tool_file.id = TEST_TOOL_FILE_ID

    with sqlite_session_maker() as session:
        session.add_all([upload_file, tool_file])
        session.commit()
        yield FileRecords(session=session, upload_file=upload_file, tool_file=tool_file)


@pytest.fixture
def mock_http_head():
    def _mock_response(filename, size, content_type):
        return Response(
            status_code=200,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(size),
                "Content-Type": content_type,
            },
        )

    with patch("factories.file_factory.remote.remote_fetcher.make_request", autospec=True) as mock_head:
        mock_head.return_value = _mock_response("remote_test.jpg", 2048, "image/jpeg")
        yield mock_head


# Helper functions
def local_file_mapping(file_type="image"):
    return {
        "transfer_method": "local_file",
        "upload_file_id": TEST_UPLOAD_FILE_ID,
        "type": file_type,
    }


def tool_file_mapping(file_type="document"):
    return {
        "transfer_method": "tool_file",
        "tool_file_id": TEST_TOOL_FILE_ID,
        "type": file_type,
    }


# Tests
def test_build_from_mapping_backward_compatibility():
    mapping = local_file_mapping(file_type="image")
    file = build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)
    assert isinstance(file, File)
    assert file.transfer_method == FileTransferMethod.LOCAL_FILE
    assert file.type == FileType.IMAGE
    assert resolve_file_record_id(file.reference) == TEST_UPLOAD_FILE_ID
    assert parse_file_reference(file.reference).storage_key is None
    assert file.storage_key == "test_key"


def test_build_from_mapping_accepts_opaque_reference_for_local_file():
    mapping = {
        "transfer_method": "local_file",
        "reference": build_file_reference(record_id=TEST_UPLOAD_FILE_ID, storage_key="test_key"),
        "type": "image",
    }

    file = build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)

    assert isinstance(file, File)
    assert file.transfer_method == FileTransferMethod.LOCAL_FILE
    assert file.type == FileType.IMAGE
    assert resolve_file_record_id(file.reference) == TEST_UPLOAD_FILE_ID


def test_build_from_mapping_accepts_opaque_related_id_for_tool_file():
    mapping = {
        "transfer_method": "tool_file",
        "related_id": build_file_reference(record_id=TEST_TOOL_FILE_ID, storage_key="tool_file.pdf"),
        "type": "document",
    }

    file = build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)

    assert isinstance(file, File)
    assert file.transfer_method == FileTransferMethod.TOOL_FILE
    assert file.type == FileType.DOCUMENT
    assert resolve_file_record_id(file.reference) == TEST_TOOL_FILE_ID
    assert parse_file_reference(file.reference).storage_key is None
    assert file.storage_key == "tool_file.pdf"


def test_build_from_mapping_prefers_tool_filename_extension_over_mimetype(file_records: FileRecords):
    file_records.tool_file.name = "report.docx"
    file_records.tool_file.file_key = "tools/test_tenant_id/file.bin"
    file_records.tool_file.mimetype = "application/octet-stream"
    file_records.session.commit()
    mapping = tool_file_mapping(file_type="document")

    file = build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)

    assert file.extension == ".docx"
    assert file.filename == "report.docx"
    assert file.mime_type == "application/octet-stream"
    assert file.storage_key == "tools/test_tenant_id/file.bin"


@pytest.mark.parametrize(
    ("file_type", "should_pass", "expected_error"),
    [
        ("image", True, None),
        ("document", False, "Detected file type does not match"),
    ],
)
def test_build_from_local_file_strict_validation(file_type, should_pass, expected_error):
    mapping = local_file_mapping(file_type=file_type)
    if should_pass:
        file = build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID, strict_type_validation=True)
        assert file.type == FileType(file_type)
    else:
        with pytest.raises(ValueError, match=expected_error):
            build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID, strict_type_validation=True)


@pytest.mark.parametrize(
    ("file_type", "should_pass", "expected_error"),
    [
        ("document", True, None),
        ("image", False, "Detected file type does not match"),
    ],
)
def test_build_from_tool_file_strict_validation(file_type, should_pass, expected_error):
    """Strict type validation for tool_file."""
    mapping = tool_file_mapping(file_type=file_type)
    if should_pass:
        file = build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID, strict_type_validation=True)
        assert file.type == FileType(file_type)
    else:
        with pytest.raises(ValueError, match=expected_error):
            build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID, strict_type_validation=True)


def test_build_from_remote_url(mock_http_head):
    mapping = {
        "transfer_method": "remote_url",
        "url": TEST_REMOTE_URL,
        "type": "image",
    }
    file = build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)
    assert file.transfer_method == FileTransferMethod.REMOTE_URL
    assert file.type == FileType.IMAGE
    assert file.filename == "remote_test.jpg"
    assert file.size == 2048


def test_build_from_remote_url_prefers_filename_extension_over_mimetype():
    mapping = {
        "transfer_method": "remote_url",
        "url": TEST_REMOTE_URL,
        "type": "document",
    }

    with patch(
        "factories.file_factory.builders.get_remote_file_info",
        return_value=("application/octet-stream", "report.docx", 99),
    ):
        file = build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)

    assert file.filename == "report.docx"
    assert file.extension == ".docx"
    assert file.mime_type == "application/octet-stream"
    assert file.size == 99


@pytest.mark.parametrize(
    ("file_type", "should_pass", "expected_error"),
    [
        ("image", True, None),
        ("document", False, "Detected file type does not match the specified type"),
        ("video", False, "Detected file type does not match the specified type"),
    ],
)
def test_build_from_remote_url_strict_validation(mock_http_head, file_type, should_pass, expected_error):
    """Test strict type validation for remote_url."""
    mapping = {
        "transfer_method": "remote_url",
        "url": TEST_REMOTE_URL,
        "type": file_type,
    }
    if should_pass:
        file = build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID, strict_type_validation=True)
        assert file.type == FileType(file_type)
    else:
        with pytest.raises(ValueError, match=expected_error):
            build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID, strict_type_validation=True)


def test_build_from_remote_url_without_strict_validation(mock_http_head):
    """Test that remote_url allows type mismatch when strict_type_validation is False."""
    mapping = {
        "transfer_method": "remote_url",
        "url": TEST_REMOTE_URL,
        "type": "document",
    }
    file = build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID, strict_type_validation=False)
    assert file.transfer_method == FileTransferMethod.REMOTE_URL
    assert file.type == FileType.DOCUMENT
    assert file.filename == "remote_test.jpg"


def test_tool_file_not_found(file_records: FileRecords):
    """Test ToolFile not found in database."""
    file_records.session.delete(file_records.tool_file)
    file_records.session.commit()

    mapping = tool_file_mapping()
    with pytest.raises(ValueError, match=f"ToolFile {TEST_TOOL_FILE_ID} not found"):
        build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)


def test_local_file_not_found(file_records: FileRecords):
    """Test UploadFile not found in database."""
    file_records.session.delete(file_records.upload_file)
    file_records.session.commit()

    mapping = local_file_mapping()
    with pytest.raises(ValueError, match="Invalid upload file"):
        build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)


def test_build_without_type_specification():
    """Test the situation where no file type is specified"""
    mapping = {
        "transfer_method": "local_file",
        "upload_file_id": TEST_UPLOAD_FILE_ID,
        # type field is intentionally omitted
    }
    file = build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)
    # Should automatically infer the type as "image" based on the file extension
    assert file.type == FileType.IMAGE


@pytest.mark.parametrize(
    ("file_type", "should_pass", "expected_error"),
    [
        ("image", True, None),
        ("video", False, "File validation failed"),
    ],
)
def test_file_validation_with_config(file_type, should_pass, expected_error):
    """Test the validation of files and configurations"""
    mapping = local_file_mapping(file_type=file_type)
    if should_pass:
        file = build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID, config=TEST_CONFIG)
        assert file is not None
    else:
        with pytest.raises(ValueError, match=expected_error):
            build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID, config=TEST_CONFIG)


def test_invalid_transfer_method():
    """Test that invalid transfer method raises ValueError."""
    mapping = {
        "transfer_method": "invalid_method",
        "upload_file_id": TEST_UPLOAD_FILE_ID,
        "type": "image",
    }
    with pytest.raises(ValueError, match="'invalid_method' is not a valid FileTransferMethod"):
        build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)


def test_invalid_uuid_format():
    """Test that invalid UUID format raises ValueError."""
    mapping = {
        "transfer_method": "local_file",
        "upload_file_id": "not-a-valid-uuid",
        "type": "image",
    }
    with pytest.raises(ValueError, match="Invalid upload file id format"):
        build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)


def test_tenant_mismatch(file_records: FileRecords):
    """Test that tenant mismatch raises security error."""
    file_records.upload_file.tenant_id = "different_tenant_id"
    file_records.session.commit()

    mapping = local_file_mapping()
    with pytest.raises(ValueError, match="Invalid upload file"):
        build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)


def test_build_from_mapping_scopes_upload_file_to_end_user():
    scope = FileAccessScope(
        tenant_id=TEST_TENANT_ID,
        user_id=TEST_END_USER_ID,
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with bind_file_access_scope(scope):
        file = build_from_mapping(mapping=local_file_mapping(), tenant_id=TEST_TENANT_ID)

    assert resolve_file_record_id(file.reference) == TEST_UPLOAD_FILE_ID

    unauthorized_scope = FileAccessScope(
        tenant_id=TEST_TENANT_ID,
        user_id="different-end-user",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )
    with bind_file_access_scope(unauthorized_scope):
        with pytest.raises(ValueError, match="Invalid upload file"):
            build_from_mapping(mapping=local_file_mapping(), tenant_id=TEST_TENANT_ID)


def test_build_from_mapping_scopes_tool_file_to_end_user():
    scope = FileAccessScope(
        tenant_id=TEST_TENANT_ID,
        user_id=TEST_END_USER_ID,
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with bind_file_access_scope(scope):
        file = build_from_mapping(mapping=tool_file_mapping(), tenant_id=TEST_TENANT_ID)

    assert resolve_file_record_id(file.reference) == TEST_TOOL_FILE_ID

    unauthorized_scope = FileAccessScope(
        tenant_id=TEST_TENANT_ID,
        user_id="different-end-user",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )
    with bind_file_access_scope(unauthorized_scope):
        with pytest.raises(ValueError, match=f"ToolFile {TEST_TOOL_FILE_ID} not found"):
            build_from_mapping(mapping=tool_file_mapping(), tenant_id=TEST_TENANT_ID)


def test_disallowed_file_types():
    """Test that disallowed file types are rejected."""
    # Config that only allows image and document types
    restricted_config = FileUploadConfig(
        allowed_file_types=[FileType.IMAGE, FileType.DOCUMENT],
    )

    # Try to upload a video file
    mapping = local_file_mapping(file_type="video")
    with pytest.raises(ValueError, match="File validation failed"):
        build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID, config=restricted_config)


def test_disallowed_extensions(file_records: FileRecords):
    """Test that disallowed file extensions are rejected for custom type."""
    file_records.upload_file.extension = "exe"
    file_records.upload_file.name = "malicious.exe"
    file_records.upload_file.mime_type = "application/x-msdownload"
    file_records.session.commit()

    # Config that only allows specific extensions for custom files
    restricted_config = FileUploadConfig(
        allowed_file_extensions=[".txt", ".csv", ".json"],
    )

    # Mapping without specifying type (will be detected as custom)
    mapping = {
        "transfer_method": "local_file",
        "upload_file_id": TEST_UPLOAD_FILE_ID,
        "type": "custom",
    }

    with pytest.raises(ValueError, match="File validation failed"):
        build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID, config=restricted_config)


def test_custom_file_type_uses_extension_validation_under_strict_mode(file_records: FileRecords):
    """Custom form uploads are classified by the configured extension list."""
    file_records.upload_file.extension = "txt"
    file_records.upload_file.name = "notes.txt"
    file_records.upload_file.mime_type = "text/plain"
    file_records.session.commit()

    custom_config = FileUploadConfig(
        allowed_file_types=[FileType.CUSTOM],
        allowed_file_extensions=[".txt"],
    )
    mapping = {
        "transfer_method": "local_file",
        "upload_file_id": TEST_UPLOAD_FILE_ID,
        "type": "custom",
    }

    file = build_from_mapping(
        mapping=mapping,
        tenant_id=TEST_TENANT_ID,
        config=custom_config,
        strict_type_validation=True,
    )

    assert file.type == FileType.CUSTOM
