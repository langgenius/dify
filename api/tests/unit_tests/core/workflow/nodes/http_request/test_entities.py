from unittest.mock import Mock

import httpx
import pytest

from core.workflow.nodes.http_request.entities import NON_FILE_CONTENT_TYPES, Response


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


FILE_CONTENT_TYPES = ["application/pdf", "image/jpeg", "audio/mp3", "video/mp4"]


@pytest.mark.parametrize("content_type", FILE_CONTENT_TYPES)
def test_is_file_with_file_content_types(mock_response, content_type):
    """Test is_file with various file content types"""
    mock_response.headers = {"content-type": content_type}
    response = Response(mock_response)
    assert response.is_file, f"Content type {content_type} should be identified as a file"


@pytest.mark.parametrize("content_type", NON_FILE_CONTENT_TYPES)
def test_individual_non_file_content_types(mock_response, content_type):
    """Test each non-file content type individually"""
    mock_response.headers = {"content-type": content_type}
    response = Response(mock_response)
    assert not response.is_file, f"Content type {content_type} should not be identified as a file"


def test_is_file_with_inline_disposition(mock_response):
    """Test is_file when content-disposition is 'inline'"""
    mock_response.headers = {"content-disposition": "inline", "content-type": "application/pdf"}
    response = Response(mock_response)
    assert response.is_file


def test_is_file_with_no_content_disposition(mock_response):
    """Test is_file when no content-disposition header is present"""
    mock_response.headers = {"content-type": "application/pdf"}
    response = Response(mock_response)
    assert response.is_file
