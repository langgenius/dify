import json
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


# UTF-8 Encoding Tests
@pytest.mark.parametrize(
    ("content_bytes", "expected_text", "description"),
    [
        # Chinese UTF-8 bytes
        (
            b'{"message": "\xe4\xbd\xa0\xe5\xa5\xbd\xe4\xb8\x96\xe7\x95\x8c"}',
            '{"message": "你好世界"}',
            "Chinese characters UTF-8",
        ),
        # Japanese UTF-8 bytes
        (
            b'{"message": "\xe3\x81\x93\xe3\x82\x93\xe3\x81\xab\xe3\x81\xa1\xe3\x81\xaf"}',
            '{"message": "こんにちは"}',
            "Japanese characters UTF-8",
        ),
        # Korean UTF-8 bytes
        (
            b'{"message": "\xec\x95\x88\xeb\x85\x95\xed\x95\x98\xec\x84\xb8\xec\x9a\x94"}',
            '{"message": "안녕하세요"}',
            "Korean characters UTF-8",
        ),
        # Arabic UTF-8
        (b'{"text": "\xd9\x85\xd8\xb1\xd8\xad\xd8\xa8\xd8\xa7"}', '{"text": "مرحبا"}', "Arabic characters UTF-8"),
        # European characters UTF-8
        (b'{"text": "Caf\xc3\xa9 M\xc3\xbcnchen"}', '{"text": "Café München"}', "European accented characters"),
        # Simple ASCII
        (b'{"text": "Hello World"}', '{"text": "Hello World"}', "Simple ASCII text"),
    ],
)
def test_text_property_utf8_decoding(mock_response, content_bytes, expected_text, description):
    """Test that Response.text properly decodes UTF-8 content with charset_normalizer"""
    mock_response.headers = {"content-type": "application/json; charset=utf-8"}
    type(mock_response).content = PropertyMock(return_value=content_bytes)
    # Mock httpx response.text to return something different (simulating potential encoding issues)
    mock_response.text = "incorrect-fallback-text"  # To ensure we are not falling back to httpx's text property

    response = Response(mock_response)

    # Our enhanced text property should decode properly using charset_normalizer
    assert response.text == expected_text, (
        f"Failed for {description}: got {repr(response.text)}, expected {repr(expected_text)}"
    )


def test_text_property_fallback_to_httpx(mock_response):
    """Test that Response.text falls back to httpx.text when charset_normalizer fails"""
    mock_response.headers = {"content-type": "application/json"}

    # Create malformed UTF-8 bytes
    malformed_bytes = b'{"text": "\xff\xfe\x00\x00 invalid"}'
    type(mock_response).content = PropertyMock(return_value=malformed_bytes)

    # Mock httpx.text to return some fallback value
    fallback_text = '{"text": "fallback"}'
    mock_response.text = fallback_text

    response = Response(mock_response)

    # Should fall back to httpx's text when charset_normalizer fails
    assert response.text == fallback_text


@pytest.mark.parametrize(
    ("json_content", "description"),
    [
        # JSON with escaped Unicode (like Flask jsonify())
        ('{"message": "\\u4f60\\u597d\\u4e16\\u754c"}', "JSON with escaped Unicode"),
        # JSON with mixed escape sequences and UTF-8
        ('{"mixed": "Hello \\u4f60\\u597d"}', "Mixed escaped and regular text"),
        # JSON with complex escape sequences
        ('{"complex": "\\ud83d\\ude00\\u4f60\\u597d"}', "Emoji and Chinese escapes"),
    ],
)
def test_text_property_with_escaped_unicode(mock_response, json_content, description):
    """Test Response.text with JSON containing Unicode escape sequences"""
    mock_response.headers = {"content-type": "application/json"}

    content_bytes = json_content.encode("utf-8")
    type(mock_response).content = PropertyMock(return_value=content_bytes)
    mock_response.text = json_content  # httpx would return the same for valid UTF-8

    response = Response(mock_response)

    # Should preserve the escape sequences (valid JSON)
    assert response.text == json_content, f"Failed for {description}"

    # The text should be valid JSON that can be parsed back to proper Unicode
    parsed = json.loads(response.text)
    assert isinstance(parsed, dict), f"Invalid JSON for {description}"
