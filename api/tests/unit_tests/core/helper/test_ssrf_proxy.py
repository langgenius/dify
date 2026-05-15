from unittest.mock import ANY, MagicMock, call, patch

import httpx
import pytest

from core.helper.ssrf_proxy import (
    SSRF_DEFAULT_MAX_RETRIES,
    SSRFProxy,
    _build_ssrf_client,
    _get_user_provided_host_header,
    _to_graphon_http_response,
    graphon_ssrf_proxy,
    is_safe_external_url,
    make_request,
    max_retries_exceeded_error,
    request_error,
)


@patch("core.helper.ssrf_proxy._get_ssrf_client", autospec=True)
def test_successful_request(mock_get_client):
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_client.request.return_value = mock_response
    mock_get_client.return_value = mock_client

    response = make_request("GET", "http://example.com")
    assert response.status_code == 200
    mock_client.request.assert_called_once()


@patch("core.helper.ssrf_proxy._get_ssrf_client", autospec=True)
def test_retry_exceed_max_retries(mock_get_client):
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_client.request.return_value = mock_response
    mock_get_client.return_value = mock_client

    with pytest.raises(Exception) as e:
        make_request("GET", "http://example.com", max_retries=SSRF_DEFAULT_MAX_RETRIES - 1)
    assert str(e.value) == f"Reached maximum retries ({SSRF_DEFAULT_MAX_RETRIES - 1}) for URL http://example.com"


def test_build_ssrf_client_passes_ssl_verify_to_proxy_mount_transports():
    mock_client = MagicMock()
    http_transport = MagicMock()
    https_transport = MagicMock()

    with (
        patch("core.helper.ssrf_proxy.dify_config.SSRF_PROXY_ALL_URL", None),
        patch("core.helper.ssrf_proxy.dify_config.SSRF_PROXY_HTTP_URL", "http://proxy.example.com:8080"),
        patch("core.helper.ssrf_proxy.dify_config.SSRF_PROXY_HTTPS_URL", "http://proxy.example.com:8443"),
        patch("core.helper.ssrf_proxy.httpx.HTTPTransport", side_effect=[http_transport, https_transport]) as transport,
        patch("core.helper.ssrf_proxy.httpx.Client", return_value=mock_client) as client,
    ):
        ssrf_client = _build_ssrf_client(verify=False)

    assert ssrf_client is mock_client
    transport.assert_has_calls(
        [
            call(proxy="http://proxy.example.com:8080", verify=False),
            call(proxy="http://proxy.example.com:8443", verify=False),
        ],
    )
    client.assert_called_once_with(
        mounts={"http://": http_transport, "https://": https_transport},
        verify=False,
        limits=ANY,
    )


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


@patch("core.helper.ssrf_proxy._get_ssrf_client", autospec=True)
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


@patch("core.helper.ssrf_proxy._get_ssrf_client", autospec=True)
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

    @patch("core.helper.ssrf_proxy._get_ssrf_client", autospec=True)
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

    @patch("core.helper.ssrf_proxy._get_ssrf_client", autospec=True)
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

    @patch("core.helper.ssrf_proxy._get_ssrf_client", autospec=True)
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

    @patch("core.helper.ssrf_proxy._get_ssrf_client", autospec=True)
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


def test_to_graphon_http_response_preserves_httpx_response_fields() -> None:
    response = httpx.Response(
        201,
        headers={"X-Test": "1"},
        content=b"payload",
        request=httpx.Request("GET", "https://example.com/resource"),
    )

    wrapped = _to_graphon_http_response(response)

    assert wrapped.status_code == 201
    assert wrapped.headers == {"x-test": "1", "content-length": "7"}
    assert wrapped.content == b"payload"
    assert wrapped.url == "https://example.com/resource"
    assert wrapped.reason_phrase == "Created"
    assert wrapped.text == "payload"


def test_ssrf_proxy_exposes_expected_error_types() -> None:
    proxy = SSRFProxy()

    assert proxy.max_retries_exceeded_error is max_retries_exceeded_error
    assert proxy.request_error is request_error
    assert graphon_ssrf_proxy.max_retries_exceeded_error is max_retries_exceeded_error
    assert graphon_ssrf_proxy.request_error is request_error


@pytest.mark.parametrize("method_name", ["get", "head", "post", "put", "delete", "patch"])
def test_graphon_ssrf_proxy_wraps_module_requests(method_name: str) -> None:
    response = httpx.Response(
        200,
        headers={"X-Test": "1"},
        content=b"ok",
        request=httpx.Request("GET", "https://example.com/resource"),
    )

    with patch(f"core.helper.ssrf_proxy.{method_name}", return_value=response) as mock_method:
        wrapped = getattr(graphon_ssrf_proxy, method_name)(
            "https://example.com/resource",
            max_retries=3,
            headers={"X-Test": "1"},
        )

    mock_method.assert_called_once_with(
        url="https://example.com/resource",
        max_retries=3,
        headers={"X-Test": "1"},
    )
    assert wrapped.status_code == 200
    assert wrapped.url == "https://example.com/resource"
    assert wrapped.content == b"ok"


# ---------------------------------------------------------------------------
# is_safe_external_url — defense-in-depth checks for tenant-supplied URLs
# (e.g. MCP tool ``server_url``).
# ---------------------------------------------------------------------------


def _no_proxy_config(monkeypatch):
    monkeypatch.setattr("core.helper.ssrf_proxy.dify_config.SSRF_PROXY_ALL_URL", "")
    monkeypatch.setattr("core.helper.ssrf_proxy.dify_config.SSRF_PROXY_HTTP_URL", "")
    monkeypatch.setattr("core.helper.ssrf_proxy.dify_config.SSRF_PROXY_HTTPS_URL", "")


@pytest.mark.parametrize(
    "url",
    [
        "",
        None,
        "not-a-url",
        "ftp://example.com",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "http://",
    ],
)
def test_is_safe_external_url_rejects_malformed_or_wrong_scheme(monkeypatch, url):
    _no_proxy_config(monkeypatch)
    assert is_safe_external_url(url) is False


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/path",
        "http://127.0.0.1:8080/",
        "https://10.0.0.1/",
        "https://10.255.255.255/",
        "https://172.16.0.5/",
        "https://172.31.255.255/",
        "https://192.168.1.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://0.0.0.0/",
        "http://[::1]/",
        "http://[fe80::1]/",
        "http://[::ffff:127.0.0.1]/",
    ],
)
def test_is_safe_external_url_rejects_internal_ip_literals(monkeypatch, url):
    """169.254.169.254 (AWS/GCP metadata), loopback, RFC1918, link-local IPv6
    and unspecified addresses must all be blocked before the HTTP client is
    handed a tenant-supplied ``server_url``."""
    _no_proxy_config(monkeypatch)
    assert is_safe_external_url(url) is False


@pytest.mark.parametrize(
    "url",
    [
        "http://93.184.216.34/",
        "https://93.184.216.34/path",
        "http://[2606:2800:220:1:248:1893:25c8:1946]/",
    ],
)
def test_is_safe_external_url_accepts_public_ip_literals(monkeypatch, url):
    _no_proxy_config(monkeypatch)
    assert is_safe_external_url(url) is True


def test_is_safe_external_url_rejects_hostname_resolving_to_private(monkeypatch):
    _no_proxy_config(monkeypatch)

    def fake_getaddrinfo(host, *args, **kwargs):
        return [(0, 0, 0, "", ("127.0.0.1", 0))]

    monkeypatch.setattr("core.helper.ssrf_proxy.socket.getaddrinfo", fake_getaddrinfo)
    assert is_safe_external_url("https://attacker.example/") is False


def test_is_safe_external_url_rejects_hostname_with_any_private_record(monkeypatch):
    """If a hostname round-robins between public and private addresses, the
    private record must veto — DNS round-robin must not bypass the guard."""
    _no_proxy_config(monkeypatch)

    def fake_getaddrinfo(host, *args, **kwargs):
        return [
            (0, 0, 0, "", ("93.184.216.34", 0)),
            (0, 0, 0, "", ("10.0.0.1", 0)),
        ]

    monkeypatch.setattr("core.helper.ssrf_proxy.socket.getaddrinfo", fake_getaddrinfo)
    assert is_safe_external_url("https://mixed.example/") is False


def test_is_safe_external_url_accepts_public_hostname(monkeypatch):
    _no_proxy_config(monkeypatch)

    def fake_getaddrinfo(host, *args, **kwargs):
        return [(0, 0, 0, "", ("93.184.216.34", 0))]

    monkeypatch.setattr("core.helper.ssrf_proxy.socket.getaddrinfo", fake_getaddrinfo)
    assert is_safe_external_url("https://example.com/") is True


def test_is_safe_external_url_skips_resolution_when_proxy_configured(monkeypatch):
    """With an SSRF egress proxy in front of all outbound traffic, the proxy
    is the chokepoint that enforces network policy. Skip the DNS round-trip
    for hostnames so the validation path is fast and never reveals tenant
    URLs to the public resolver."""
    monkeypatch.setattr(
        "core.helper.ssrf_proxy.dify_config.SSRF_PROXY_ALL_URL",
        "http://squid:3128",
    )

    def fail_resolve(*args, **kwargs):
        raise AssertionError("getaddrinfo must not run when proxy is configured")

    monkeypatch.setattr("core.helper.ssrf_proxy.socket.getaddrinfo", fail_resolve)
    assert is_safe_external_url("https://attacker.example/") is True


def test_is_safe_external_url_still_rejects_ip_literals_when_proxy_configured(monkeypatch):
    """Even with the SSRF proxy in front, a request whose URL already names
    an internal IP literal should be rejected at the boundary — the proxy
    would forward the literal as-is."""
    monkeypatch.setattr(
        "core.helper.ssrf_proxy.dify_config.SSRF_PROXY_ALL_URL",
        "http://squid:3128",
    )
    assert is_safe_external_url("http://169.254.169.254/latest/meta-data/") is False
    assert is_safe_external_url("http://127.0.0.1/") is False


def test_is_safe_external_url_rejects_unresolvable_hostname(monkeypatch):
    """``getaddrinfo`` failure is treated as fail-closed — a hostname we
    cannot resolve cannot be proven safe."""
    _no_proxy_config(monkeypatch)

    def boom(*args, **kwargs):
        import socket as _socket

        raise _socket.gaierror("nodename nor servname provided, or not known")

    monkeypatch.setattr("core.helper.ssrf_proxy.socket.getaddrinfo", boom)
    assert is_safe_external_url("https://nonexistent.invalid/") is False
