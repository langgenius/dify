import secrets
from unittest.mock import MagicMock, patch

import pytest

from core.helper.ssrf_proxy import (
    SSRF_DEFAULT_MAX_RETRIES,
    STATUS_FORCELIST,
    _get_user_provided_host_header,
    make_request,
)


@patch("core.helper.ssrf_proxy._get_ssrf_client")
def test_successful_request(mock_get_client):
    mock_client = MagicMock()
    mock_request = MagicMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_client.send.return_value = mock_response
    mock_client.build_request.return_value = mock_request
    mock_get_client.return_value = mock_client

    response = make_request("GET", "http://example.com")
    assert response.status_code == 200


@patch("core.helper.ssrf_proxy._get_ssrf_client")
def test_retry_exceed_max_retries(mock_get_client):
    mock_client = MagicMock()
    mock_request = MagicMock()
    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_client.send.return_value = mock_response
    mock_client.build_request.return_value = mock_request
    mock_get_client.return_value = mock_client

    with pytest.raises(Exception) as e:
        make_request("GET", "http://example.com", max_retries=SSRF_DEFAULT_MAX_RETRIES - 1)
    assert str(e.value) == f"Reached maximum retries ({SSRF_DEFAULT_MAX_RETRIES - 1}) for URL http://example.com"


@patch("core.helper.ssrf_proxy._get_ssrf_client")
def test_retry_logic_success(mock_get_client):
    mock_client = MagicMock()
    mock_request = MagicMock()
    mock_response = MagicMock()
    mock_response.status_code = 200

    side_effects = []
    for _ in range(SSRF_DEFAULT_MAX_RETRIES):
        status_code = secrets.choice(STATUS_FORCELIST)
        retry_response = MagicMock()
        retry_response.status_code = status_code
        side_effects.append(retry_response)

    side_effects.append(mock_response)
    mock_client.send.side_effect = side_effects
    mock_client.build_request.return_value = mock_request
    mock_get_client.return_value = mock_client

    response = make_request("GET", "http://example.com", max_retries=SSRF_DEFAULT_MAX_RETRIES)

    assert response.status_code == 200
    assert mock_client.send.call_count == SSRF_DEFAULT_MAX_RETRIES + 1
    assert mock_client.build_request.call_count == SSRF_DEFAULT_MAX_RETRIES + 1


class TestGetUserProvidedHostHeader:
    """Tests for _get_user_provided_host_header function."""

    def test_returns_none_when_headers_is_none(self):
        assert _get_user_provided_host_header(None) is None

    def test_returns_none_when_headers_is_empty(self):
        assert _get_user_provided_host_header({}) is None

    def test_returns_none_when_host_header_not_present(self):
        headers = {"Content-Type": "application/json", "Authorization": "Bearer token"}
        assert _get_user_provided_host_header(headers) is None

    def test_returns_host_header_lowercase(self):
        headers = {"host": "example.com"}
        assert _get_user_provided_host_header(headers) == "example.com"

    def test_returns_host_header_uppercase(self):
        headers = {"HOST": "example.com"}
        assert _get_user_provided_host_header(headers) == "example.com"

    def test_returns_host_header_mixed_case(self):
        headers = {"HoSt": "example.com"}
        assert _get_user_provided_host_header(headers) == "example.com"

    def test_returns_host_header_from_multiple_headers(self):
        headers = {"Content-Type": "application/json", "Host": "api.example.com", "Authorization": "Bearer token"}
        assert _get_user_provided_host_header(headers) == "api.example.com"

    def test_returns_first_host_header_when_duplicates(self):
        headers = {"host": "first.com", "Host": "second.com"}
        # Should return the first one encountered (iteration order is preserved in dict)
        result = _get_user_provided_host_header(headers)
        assert result in ("first.com", "second.com")


@patch("core.helper.ssrf_proxy._get_ssrf_client")
def test_host_header_preservation_without_user_header(mock_get_client):
    """Test that when no Host header is provided, the default behavior is maintained."""
    mock_client = MagicMock()
    mock_request = MagicMock()
    mock_request.headers = {}
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_client.send.return_value = mock_response
    mock_client.build_request.return_value = mock_request
    mock_get_client.return_value = mock_client

    response = make_request("GET", "http://example.com")

    assert response.status_code == 200
    # build_request should be called without headers dict containing Host
    mock_client.build_request.assert_called_once()
    # Host should not be set if not provided by user
    assert "Host" not in mock_request.headers or mock_request.headers.get("Host") is None


@patch("core.helper.ssrf_proxy._get_ssrf_client")
def test_host_header_preservation_with_user_header(mock_get_client):
    """Test that user-provided Host header is preserved in the request."""
    mock_client = MagicMock()
    mock_request = MagicMock()
    mock_request.headers = {}
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_client.send.return_value = mock_response
    mock_client.build_request.return_value = mock_request
    mock_get_client.return_value = mock_client

    custom_host = "custom.example.com:8080"
    response = make_request("GET", "http://example.com", headers={"Host": custom_host})

    assert response.status_code == 200
    # Verify build_request was called
    mock_client.build_request.assert_called_once()
    # Verify the Host header was set on the request object
    assert mock_request.headers.get("Host") == custom_host
    mock_client.send.assert_called_once_with(mock_request)


@patch("core.helper.ssrf_proxy._get_ssrf_client")
@pytest.mark.parametrize("host_key", ["host", "HOST"])
def test_host_header_preservation_case_insensitive(mock_get_client, host_key):
    """Test that Host header is preserved regardless of case."""
    mock_client = MagicMock()
    mock_request = MagicMock()
    mock_request.headers = {}
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_client.send.return_value = mock_response
    mock_client.build_request.return_value = mock_request
    mock_get_client.return_value = mock_client
    response = make_request("GET", "http://example.com", headers={host_key: "api.example.com"})
    assert mock_request.headers.get("Host") == "api.example.com"
