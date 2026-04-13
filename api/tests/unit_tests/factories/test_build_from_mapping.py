import uuid
from unittest.mock import MagicMock, patch

import pytest
from graphon.file import File, FileTransferMethod, FileType, FileUploadConfig
from httpx import Response

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import DatabaseFileAccessController, FileAccessScope, bind_file_access_scope
from core.workflow.file_reference import build_file_reference, parse_file_reference, resolve_file_record_id
from factories.file_factory.builders import build_from_mapping as _build_from_mapping
from models import ToolFile, UploadFile

# Test Data
TEST_TENANT_ID = "test_tenant_id"
TEST_UPLOAD_FILE_ID = str(uuid.uuid4())
TEST_TOOL_FILE_ID = str(uuid.uuid4())
TEST_REMOTE_URL = "http://example.com/test.jpg"
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


# Fixtures
@pytest.fixture
def mock_upload_file():
    mock = MagicMock(spec=UploadFile)
    mock.id = TEST_UPLOAD_FILE_ID
    mock.tenant_id = TEST_TENANT_ID
    mock.name = "test.jpg"
    mock.extension = "jpg"
    mock.mime_type = "image/jpeg"
    mock.source_url = TEST_REMOTE_URL
    mock.size = 1024
    mock.key = "test_key"
    with patch("factories.file_factory.builders.db.session.scalar", return_value=mock, autospec=True) as m:
        yield m


@pytest.fixture
def mock_tool_file():
    mock = MagicMock(spec=ToolFile)
    mock.id = TEST_TOOL_FILE_ID
    mock.tenant_id = TEST_TENANT_ID
    mock.name = "tool_file.pdf"
    mock.file_key = "tool_file.pdf"
    mock.mimetype = "application/pdf"
    mock.original_url = "http://example.com/tool.pdf"
    mock.size = 2048
    with patch("factories.file_factory.builders.db.session.scalar", return_value=mock, autospec=True):
        yield mock


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

    with patch("factories.file_factory.remote.ssrf_proxy.head", autospec=True) as mock_head:
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
def test_build_from_mapping_backward_compatibility(mock_upload_file):
    mapping = local_file_mapping(file_type="image")
    file = build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)
    assert isinstance(file, File)
    assert file.transfer_method == FileTransferMethod.LOCAL_FILE
    assert file.type == FileType.IMAGE
    assert resolve_file_record_id(file.reference) == TEST_UPLOAD_FILE_ID
    assert parse_file_reference(file.reference).storage_key is None
    assert file.storage_key == "test_key"


def test_build_from_mapping_accepts_opaque_reference_for_local_file(mock_upload_file):
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


def test_build_from_mapping_accepts_opaque_related_id_for_tool_file(mock_tool_file):
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


@pytest.mark.parametrize(
    ("file_type", "should_pass", "expected_error"),
    [
        ("image", True, None),
        ("document", False, "Detected file type does not match"),
    ],
)
def test_build_from_local_file_strict_validation(mock_upload_file, file_type, should_pass, expected_error):
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
def test_build_from_tool_file_strict_validation(mock_tool_file, file_type, should_pass, expected_error):
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


def test_tool_file_not_found():
    """Test ToolFile not found in database."""
    with patch("factories.file_factory.builders.db.session.scalar", return_value=None, autospec=True):
        mapping = tool_file_mapping()
        with pytest.raises(ValueError, match=f"ToolFile {TEST_TOOL_FILE_ID} not found"):
            build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)


def test_local_file_not_found():
    """Test UploadFile not found in database."""
    with patch("factories.file_factory.builders.db.session.scalar", return_value=None, autospec=True):
        mapping = local_file_mapping()
        with pytest.raises(ValueError, match="Invalid upload file"):
            build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)


def test_build_without_type_specification(mock_upload_file):
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
def test_file_validation_with_config(mock_upload_file, file_type, should_pass, expected_error):
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
    with pytest.raises(ValueError, match="No matching enum found for value 'invalid_method'"):
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


def test_tenant_mismatch():
    """Test that tenant mismatch raises security error."""
    # Create a mock upload file with a different tenant_id
    mock_file = MagicMock(spec=UploadFile)
    mock_file.id = TEST_UPLOAD_FILE_ID
    mock_file.tenant_id = "different_tenant_id"
    mock_file.name = "test.jpg"
    mock_file.extension = "jpg"
    mock_file.mime_type = "image/jpeg"
    mock_file.source_url = TEST_REMOTE_URL
    mock_file.size = 1024
    mock_file.key = "test_key"

    # Mock the database query to return None (no file found for this tenant)
    with patch("factories.file_factory.builders.db.session.scalar", return_value=None, autospec=True):
        mapping = local_file_mapping()
        with pytest.raises(ValueError, match="Invalid upload file"):
            build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)


def test_build_from_mapping_scopes_upload_file_to_end_user(mock_upload_file):
    scope = FileAccessScope(
        tenant_id=TEST_TENANT_ID,
        user_id="end-user-id",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with bind_file_access_scope(scope):
        build_from_mapping(mapping=local_file_mapping(), tenant_id=TEST_TENANT_ID)

    stmt = mock_upload_file.call_args.args[0]
    whereclause = str(stmt.whereclause)
    assert "upload_files.created_by_role" in whereclause
    assert "upload_files.created_by" in whereclause


def test_build_from_mapping_scopes_tool_file_to_end_user():
    tool_file = MagicMock(spec=ToolFile)
    tool_file.id = TEST_TOOL_FILE_ID
    tool_file.tenant_id = TEST_TENANT_ID
    tool_file.name = "tool_file.pdf"
    tool_file.file_key = "tool_file.pdf"
    tool_file.mimetype = "application/pdf"
    tool_file.original_url = "http://example.com/tool.pdf"
    tool_file.size = 2048
    scope = FileAccessScope(
        tenant_id=TEST_TENANT_ID,
        user_id="end-user-id",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with patch("factories.file_factory.builders.db.session.scalar", return_value=tool_file, autospec=True) as scalar:
        with bind_file_access_scope(scope):
            build_from_mapping(mapping=tool_file_mapping(), tenant_id=TEST_TENANT_ID)

    stmt = scalar.call_args.args[0]
    whereclause = str(stmt.whereclause)
    assert "tool_files.user_id" in whereclause


def test_disallowed_file_types(mock_upload_file):
    """Test that disallowed file types are rejected."""
    # Config that only allows image and document types
    restricted_config = FileUploadConfig(
        allowed_file_types=[FileType.IMAGE, FileType.DOCUMENT],
    )

    # Try to upload a video file
    mapping = local_file_mapping(file_type="video")
    with pytest.raises(ValueError, match="File validation failed"):
        build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID, config=restricted_config)


def test_disallowed_extensions(mock_upload_file):
    """Test that disallowed file extensions are rejected for custom type."""
    # Mock a file with .exe extension
    mock_upload_file.return_value.extension = "exe"
    mock_upload_file.return_value.name = "malicious.exe"
    mock_upload_file.return_value.mime_type = "application/x-msdownload"

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
