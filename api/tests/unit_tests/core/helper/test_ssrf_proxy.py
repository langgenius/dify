import secrets
from unittest.mock import MagicMock, patch

import pytest

from core.helper.ssrf_proxy import SSRF_DEFAULT_MAX_RETRIES, STATUS_FORCELIST, is_private_or_local_address, make_request
from core.tools.errors import ToolSSRFError


@patch("httpx.Client.request")
def test_successful_request(mock_request):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_request.return_value = mock_response

    response = make_request("GET", "http://example.com")
    assert response.status_code == 200


@patch("httpx.Client.request")
def test_retry_exceed_max_retries(mock_request):
    mock_response = MagicMock()
    mock_response.status_code = 500

    side_effects = [mock_response] * SSRF_DEFAULT_MAX_RETRIES
    mock_request.side_effect = side_effects

    with pytest.raises(Exception) as e:
        make_request("GET", "http://example.com", max_retries=SSRF_DEFAULT_MAX_RETRIES - 1)
    assert str(e.value) == f"Reached maximum retries ({SSRF_DEFAULT_MAX_RETRIES - 1}) for URL http://example.com"


@patch("httpx.Client.request")
def test_retry_logic_success(mock_request):
    side_effects = []

    for _ in range(SSRF_DEFAULT_MAX_RETRIES):
        status_code = secrets.choice(STATUS_FORCELIST)
        mock_response = MagicMock()
        mock_response.status_code = status_code
        side_effects.append(mock_response)

    mock_response_200 = MagicMock()
    mock_response_200.status_code = 200
    side_effects.append(mock_response_200)

    mock_request.side_effect = side_effects

    response = make_request("GET", "http://example.com", max_retries=SSRF_DEFAULT_MAX_RETRIES)

    assert response.status_code == 200
    assert mock_request.call_count == SSRF_DEFAULT_MAX_RETRIES + 1
    assert mock_request.call_args_list[0][1].get("method") == "GET"


@patch("httpx.Client.request")
def test_squid_ssrf_rejection_detected(mock_request):
    """Test that Squid SSRF rejection (403) is converted to ToolSSRFError."""
    mock_response = MagicMock()
    mock_response.status_code = 403
    mock_response.headers = {"server": "squid/5.2", "via": "1.1 squid"}
    mock_request.return_value = mock_response

    with pytest.raises(ToolSSRFError) as exc_info:
        make_request("GET", "http://192.168.1.1/api")

    assert "blocked by SSRF protection" in str(exc_info.value)
    assert "192.168.1.1" in str(exc_info.value)
    assert "squid.conf.template" in str(exc_info.value)


@patch("httpx.Client.request")
def test_squid_ssrf_rejection_via_header(mock_request):
    """Test detection via Via header when Server header is not present."""
    mock_response = MagicMock()
    mock_response.status_code = 403
    mock_response.headers = {"via": "1.1 squid-proxy (squid/5.2)"}
    mock_request.return_value = mock_response

    with pytest.raises(ToolSSRFError) as exc_info:
        make_request("GET", "http://10.0.0.1/api")

    assert "SSRF protection" in str(exc_info.value)


@patch("httpx.Client.request")
def test_squid_401_rejection_detected(mock_request):
    """Test that Squid SSRF rejection with 401 is also converted to ToolSSRFError."""
    mock_response = MagicMock()
    mock_response.status_code = 401
    mock_response.headers = {"server": "squid/5.2"}
    mock_request.return_value = mock_response

    with pytest.raises(ToolSSRFError) as exc_info:
        make_request("GET", "http://192.168.1.1/api")

    assert "SSRF protection" in str(exc_info.value)
    assert "squid.conf.template" in str(exc_info.value)


@patch("httpx.Client.request")
def test_regular_403_not_treated_as_ssrf(mock_request):
    """Test that regular 403 responses (not from Squid) are returned normally."""
    mock_response = MagicMock()
    mock_response.status_code = 403
    mock_response.headers = {"server": "nginx/1.21.0"}  # Not Squid
    mock_request.return_value = mock_response

    # Should not raise ToolSSRFError
    response = make_request("GET", "http://example.com/api")
    assert response.status_code == 403


class TestIsPrivateOrLocalAddress:
    """Test cases for SSRF protection function."""

    def test_localhost_variants(self):
        """Test that localhost variants are detected as private."""
        assert is_private_or_local_address("http://localhost/api") is True
        assert is_private_or_local_address("http://127.0.0.1/api") is True
        assert is_private_or_local_address("http://[::1]/api") is True
        assert is_private_or_local_address("https://localhost:8080/") is True

    def test_private_ipv4_ranges(self):
        """Test that private IPv4 ranges are detected."""
        # 10.0.0.0/8
        assert is_private_or_local_address("http://10.0.0.1/api") is True
        assert is_private_or_local_address("http://10.255.255.255/api") is True

        # 172.16.0.0/12
        assert is_private_or_local_address("http://172.16.0.1/api") is True
        assert is_private_or_local_address("http://172.31.255.255/api") is True

        # 192.168.0.0/16
        assert is_private_or_local_address("http://192.168.0.1/api") is True
        assert is_private_or_local_address("http://192.168.255.255/api") is True

        # 169.254.0.0/16 (link-local)
        assert is_private_or_local_address("http://169.254.1.1/api") is True

    def test_local_domains(self):
        """Test that .local domains are detected as private."""
        assert is_private_or_local_address("http://myserver.local/api") is True
        assert is_private_or_local_address("https://test.local:8080/") is True

    def test_public_addresses(self):
        """Test that public addresses are not detected as private."""
        assert is_private_or_local_address("http://example.com/api") is False
        assert is_private_or_local_address("https://api.openai.com/v1") is False
        assert is_private_or_local_address("http://8.8.8.8/") is False
        assert is_private_or_local_address("https://1.1.1.1/") is False
        assert is_private_or_local_address("http://93.184.216.34/") is False

    def test_edge_cases(self):
        """Test edge cases and invalid inputs."""
        # Empty or None
        assert is_private_or_local_address("") is False
        assert is_private_or_local_address(None) is False

        # Invalid URLs
        assert is_private_or_local_address("not-a-url") is False
        assert is_private_or_local_address("://invalid") is False

    def test_ipv6_private_ranges(self):
        """Test that private IPv6 ranges are detected."""
        # IPv6 loopback
        assert is_private_or_local_address("http://[::1]/api") is True

        # IPv6 link-local (fe80::/10)
        assert is_private_or_local_address("http://[fe80::1]/api") is True

        # IPv6 unique local (fc00::/7)
        assert is_private_or_local_address("http://[fc00::1]/api") is True
        assert is_private_or_local_address("http://[fd00::1]/api") is True

    def test_public_ipv6(self):
        """Test that public IPv6 addresses are not detected as private."""
        # Public IPv6 addresses (real examples)
        # Google Public DNS IPv6
        assert is_private_or_local_address("http://[2001:4860:4860::8888]/api") is False
        # Cloudflare DNS IPv6
        assert is_private_or_local_address("http://[2606:4700:4700::1111]/api") is False

    def test_url_with_ports(self):
        """Test URLs with custom ports."""
        assert is_private_or_local_address("http://localhost:8080/api") is True
        assert is_private_or_local_address("http://192.168.1.1:3000/") is True
        assert is_private_or_local_address("https://example.com:443/api") is False

    def test_url_schemes(self):
        """Test different URL schemes."""
        assert is_private_or_local_address("https://127.0.0.1/api") is True
        assert is_private_or_local_address("http://127.0.0.1/api") is True
        assert is_private_or_local_address("https://example.com/api") is False
