import uuid
from unittest.mock import MagicMock, patch

import pytest
from httpx import Response

from factories.file_factory import (
    File,
    FileTransferMethod,
    FileType,
    FileUploadConfig,
    build_from_mapping,
)
from models import ToolFile, UploadFile

# Test Data
TEST_TENANT_ID = "test_tenant_id"
TEST_UPLOAD_FILE_ID = str(uuid.uuid4())
TEST_TOOL_FILE_ID = str(uuid.uuid4())
TEST_REMOTE_URL = "http://example.com/test.jpg"

# Test Config
TEST_CONFIG = FileUploadConfig(
    allowed_file_types=["image", "document"],
    allowed_file_extensions=[".jpg", ".pdf"],
    allowed_file_upload_methods=[FileTransferMethod.LOCAL_FILE, FileTransferMethod.TOOL_FILE],
    number_limits=10,
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
    with patch("factories.file_factory.db.session.scalar", return_value=mock) as m:
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
    with patch("factories.file_factory.db.session.query") as mock_query:
        mock_query.return_value.filter.return_value.first.return_value = mock
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

    with patch("factories.file_factory.ssrf_proxy.head") as mock_head:
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
    assert file.related_id == TEST_UPLOAD_FILE_ID


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


def test_tool_file_not_found():
    """Test ToolFile not found in database."""
    with patch("factories.file_factory.db.session.query") as mock_query:
        mock_query.return_value.filter.return_value.first.return_value = None
        mapping = tool_file_mapping()
        with pytest.raises(ValueError, match=f"ToolFile {TEST_TOOL_FILE_ID} not found"):
            build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)


def test_local_file_not_found():
    """Test UploadFile not found in database."""
    with patch("factories.file_factory.db.session.scalar", return_value=None):
        mapping = local_file_mapping()
        with pytest.raises(ValueError, match="Invalid upload file"):
            build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)


def test_build_without_type_specification(mock_upload_file):
    """Test the situation where no file type is specified"""
    mapping = {
        "transfer_method": "local_file",
        "upload_file_id": TEST_UPLOAD_FILE_ID,
        # leave out the type
    }
    file = build_from_mapping(mapping=mapping, tenant_id=TEST_TENANT_ID)
    # It should automatically infer the type as "image" based on the file extension
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
