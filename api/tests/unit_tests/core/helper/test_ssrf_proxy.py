from unittest.mock import MagicMock, patch

import pytest

from core.helper.ssrf_proxy import (
    SSRF_DEFAULT_MAX_RETRIES,
    _get_user_provided_host_header,
    make_request,
)


@patch("core.helper.ssrf_proxy._get_ssrf_client")
def test_successful_request(mock_get_client):
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_client.request.return_value = mock_response
    mock_get_client.return_value = mock_client

    response = make_request("GET", "http://example.com")
    assert response.status_code == 200
    mock_client.request.assert_called_once()


@patch("core.helper.ssrf_proxy._get_ssrf_client")
def test_retry_exceed_max_retries(mock_get_client):
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_client.request.return_value = mock_response
    mock_get_client.return_value = mock_client

    with pytest.raises(Exception) as e:
        make_request("GET", "http://example.com", max_retries=SSRF_DEFAULT_MAX_RETRIES - 1)
    assert str(e.value) == f"Reached maximum retries ({SSRF_DEFAULT_MAX_RETRIES - 1}) for URL http://example.com"


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
def test_host_header_preservation_with_user_header(mock_get_client):
    """Test that user-provided Host header is preserved in the request."""
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_client.request.return_value = mock_response
    mock_get_client.return_value = mock_client

    custom_host = "custom.example.com:8080"
    response = make_request("GET", "http://example.com", headers={"Host": custom_host})

    assert response.status_code == 200
    # Verify client.request was called with the host header preserved (lowercase)
    call_kwargs = mock_client.request.call_args.kwargs
    assert call_kwargs["headers"]["host"] == custom_host


@patch("core.helper.ssrf_proxy._get_ssrf_client")
@pytest.mark.parametrize("host_key", ["host", "HOST", "Host"])
def test_host_header_preservation_case_insensitive(mock_get_client, host_key):
    """Test that Host header is preserved regardless of case."""
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_client.request.return_value = mock_response
    mock_get_client.return_value = mock_client

    response = make_request("GET", "http://example.com", headers={host_key: "api.example.com"})

    assert response.status_code == 200
    # Host header should be normalized to lowercase "host"
    call_kwargs = mock_client.request.call_args.kwargs
    assert call_kwargs["headers"]["host"] == "api.example.com"


class TestFollowRedirectsParameter:
    """Tests for follow_redirects parameter handling.

    These tests verify that follow_redirects is correctly passed to client.request().
    """

    @patch("core.helper.ssrf_proxy._get_ssrf_client")
    def test_follow_redirects_passed_to_request(self, mock_get_client):
        """Verify follow_redirects IS passed to client.request()."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_client.request.return_value = mock_response
        mock_get_client.return_value = mock_client

        make_request("GET", "http://example.com", follow_redirects=True)

        # Verify follow_redirects was passed to request
        call_kwargs = mock_client.request.call_args.kwargs
        assert call_kwargs.get("follow_redirects") is True

    @patch("core.helper.ssrf_proxy._get_ssrf_client")
    def test_allow_redirects_converted_to_follow_redirects(self, mock_get_client):
        """Verify allow_redirects (requests-style) is converted to follow_redirects (httpx-style)."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_client.request.return_value = mock_response
        mock_get_client.return_value = mock_client

        # Use allow_redirects (requests-style parameter)
        make_request("GET", "http://example.com", allow_redirects=True)

        # Verify it was converted to follow_redirects
        call_kwargs = mock_client.request.call_args.kwargs
        assert call_kwargs.get("follow_redirects") is True
        assert "allow_redirects" not in call_kwargs

    @patch("core.helper.ssrf_proxy._get_ssrf_client")
    def test_follow_redirects_not_set_when_not_specified(self, mock_get_client):
        """Verify follow_redirects is not in kwargs when not specified (httpx default behavior)."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_client.request.return_value = mock_response
        mock_get_client.return_value = mock_client

        make_request("GET", "http://example.com")

        # follow_redirects should not be in kwargs, letting httpx use its default
        call_kwargs = mock_client.request.call_args.kwargs
        assert "follow_redirects" not in call_kwargs

    @patch("core.helper.ssrf_proxy._get_ssrf_client")
    def test_follow_redirects_takes_precedence_over_allow_redirects(self, mock_get_client):
        """Verify follow_redirects takes precedence when both are specified."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_client.request.return_value = mock_response
        mock_get_client.return_value = mock_client

        # Both specified - follow_redirects should take precedence
        make_request("GET", "http://example.com", allow_redirects=False, follow_redirects=True)

        call_kwargs = mock_client.request.call_args.kwargs
        assert call_kwargs.get("follow_redirects") is True
