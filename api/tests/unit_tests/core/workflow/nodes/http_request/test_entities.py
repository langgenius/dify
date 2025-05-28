from unittest.mock import Mock, PropertyMock, patch

import httpx
import pytest

from core.workflow.nodes.http_request.entities import Response


@pytest.fixture
def mock_response():
    response = Mock(spec=httpx.Response)
    response.headers = {}
    return response


def test_is_file_with_attachment_disposition(mock_response):
    """Test is_file when content-disposition header contains 'attachment'"""
    mock_response.headers = {"content-disposition": "attachment; filename=test.pdf", "content-type": "application/pdf"}
    response = Response(mock_response)
    assert response.is_file


def test_is_file_with_filename_disposition(mock_response):
    """Test is_file when content-disposition header contains filename parameter"""
    mock_response.headers = {"content-disposition": "inline; filename=test.pdf", "content-type": "application/pdf"}
    response = Response(mock_response)
    assert response.is_file


@pytest.mark.parametrize("content_type", ["application/pdf", "image/jpeg", "audio/mp3", "video/mp4"])
def test_is_file_with_file_content_types(mock_response, content_type):
    """Test is_file with various file content types"""
    mock_response.headers = {"content-type": content_type}
    # Mock binary content
    type(mock_response).content = PropertyMock(return_value=bytes([0x00, 0xFF] * 512))
    response = Response(mock_response)
    assert response.is_file, f"Content type {content_type} should be identified as a file"


@pytest.mark.parametrize(
    "content_type",
    [
        "application/json",
        "application/xml",
        "application/javascript",
        "application/x-www-form-urlencoded",
        "application/yaml",
        "application/graphql",
    ],
)
def test_text_based_application_types(mock_response, content_type):
    """Test common text-based application types are not identified as files"""
    mock_response.headers = {"content-type": content_type}
    response = Response(mock_response)
    assert not response.is_file, f"Content type {content_type} should not be identified as a file"


@pytest.mark.parametrize(
    ("content", "content_type"),
    [
        (b'{"key": "value"}', "application/octet-stream"),
        (b"[1, 2, 3]", "application/unknown"),
        (b"function test() {}", "application/x-unknown"),
        (b"<root>test</root>", "application/binary"),
        (b"var x = 1;", "application/data"),
    ],
)
def test_content_based_detection(mock_response, content, content_type):
    """Test content-based detection for text-like content"""
    mock_response.headers = {"content-type": content_type}
    type(mock_response).content = PropertyMock(return_value=content)
    response = Response(mock_response)
    assert not response.is_file, f"Content {content} with type {content_type} should not be identified as a file"


@pytest.mark.parametrize(
    ("content", "content_type"),
    [
        (bytes([0x00, 0xFF] * 512), "application/octet-stream"),
        (bytes([0x89, 0x50, 0x4E, 0x47]), "application/unknown"),  # PNG magic numbers
        (bytes([0xFF, 0xD8, 0xFF]), "application/binary"),  # JPEG magic numbers
    ],
)
def test_binary_content_detection(mock_response, content, content_type):
    """Test content-based detection for binary content"""
    mock_response.headers = {"content-type": content_type}
    type(mock_response).content = PropertyMock(return_value=content)
    response = Response(mock_response)
    assert response.is_file, f"Binary content with type {content_type} should be identified as a file"


@pytest.mark.parametrize(
    ("content_type", "expected_main_type"),
    [
        ("x-world/x-vrml", "model"),  # VRML 3D model
        ("font/ttf", "application"),  # TrueType font
        ("text/csv", "text"),  # CSV text file
        ("unknown/xyz", None),  # Unknown type
    ],
)
def test_mimetype_based_detection(mock_response, content_type, expected_main_type):
    """Test detection using mimetypes.guess_type for non-application content types"""
    mock_response.headers = {"content-type": content_type}
    type(mock_response).content = PropertyMock(return_value=bytes([0x00]))  # Dummy content

    with patch("core.workflow.nodes.http_request.entities.mimetypes.guess_type") as mock_guess_type:
        # Mock the return value based on expected_main_type
        if expected_main_type:
            mock_guess_type.return_value = (f"{expected_main_type}/subtype", None)
        else:
            mock_guess_type.return_value = (None, None)

        response = Response(mock_response)

        # Check if the result matches our expectation
        if expected_main_type in ("application", "image", "audio", "video"):
            assert response.is_file, f"Content type {content_type} should be identified as a file"
        else:
            assert not response.is_file, f"Content type {content_type} should not be identified as a file"

        # Verify that guess_type was called
        mock_guess_type.assert_called_once()


def test_is_file_with_inline_disposition(mock_response):
    """Test is_file when content-disposition is 'inline'"""
    mock_response.headers = {"content-disposition": "inline", "content-type": "application/pdf"}
    # Mock binary content
    type(mock_response).content = PropertyMock(return_value=bytes([0x00, 0xFF] * 512))
    response = Response(mock_response)
    assert response.is_file


def test_is_file_with_no_content_disposition(mock_response):
    """Test is_file when no content-disposition header is present"""
    mock_response.headers = {"content-type": "application/pdf"}
    # Mock binary content
    type(mock_response).content = PropertyMock(return_value=bytes([0x00, 0xFF] * 512))
    response = Response(mock_response)
    assert response.is_file
