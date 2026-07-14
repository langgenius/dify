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
    make_request,
    max_retries_exceeded_error,
    request_error,
)
from core.tools.errors import ToolSSRFError


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
# Squid-blocked 403 regression tests (issue #38443)
# ---------------------------------------------------------------------------
# When the SSRF proxy denies a request to a private/internal network address,
# Squid returns 401/403 with itself identified in the Server or Via header.
# The Python client must raise ToolSSRFError with a message that tells the
# user exactly which env var to set, instead of just "blocked by SSRF
# protection" (the pre-#38443 message gave no actionable guidance).


def _build_squid_blocked_response(status_code: int = 403) -> MagicMock:
    """Construct a mock httpx.Response that looks like Squid's ACL deny."""
    response = MagicMock()
    response.status_code = status_code
    response.headers = {"server": "squid/4.10", "via": "1.1 squid (squid/4.10)"}
    return response


@patch("core.helper.ssrf_proxy._get_ssrf_client", autospec=True)
def test_squid_block_raises_actionable_tool_ssrf_error(mock_get_client) -> None:
    """A 403 from Squid must raise ToolSSRFError whose message tells the user
    exactly which env var to set. Pre-#38443 the message had no remediation
    hint, so users hit dead ends when their internal API was blocked."""
    mock_client = MagicMock()
    mock_client.request.return_value = _build_squid_blocked_response(status_code=403)
    mock_get_client.return_value = mock_client

    with pytest.raises(ToolSSRFError) as exc_info:
        make_request("GET", "http://172.21.0.5/api/health")

    msg = str(exc_info.value)
    assert "172.21.0.5" in msg, f"URL should appear in the error, got: {msg!r}"
    assert "SSRF_PROXY_ALLOW_PRIVATE_IPS" in msg, (
        "Error must tell the user which env var to set; got: " + msg
    )
    # The remediation hint must include a concrete example, otherwise users
    # still have to grep the squid config to figure out the syntax.
    assert "172.21.0.0/16" in msg
    # And it must point to the issue so maintainers can find context.
    assert "issues/38443" in msg


@patch("core.helper.ssrf_proxy._get_ssrf_client", autospec=True)
def test_squid_401_via_header_also_triggers_actionable_error(mock_get_client) -> None:
    """Squid can return 401 with only the Via header set (no Server header)
    on some configurations. The detection must work for both."""
    mock_client = MagicMock()
    response = MagicMock()
    response.status_code = 401
    # Server header absent — only Via identifies Squid.
    response.headers = {"server": "", "via": "1.1 squid (squid/4.10)"}
    mock_client.request.return_value = response
    mock_get_client.return_value = mock_client

    with pytest.raises(ToolSSRFError) as exc_info:
        make_request("GET", "http://10.0.0.1/internal")

    assert "SSRF_PROXY_ALLOW_PRIVATE_IPS" in str(exc_info.value)


@patch("core.helper.ssrf_proxy._get_ssrf_client", autospec=True)
def test_non_squid_403_is_not_treated_as_ssrf_block(mock_get_client) -> None:
    """A 403 from the *target server* (not Squid) must NOT be re-raised as
    a ToolSSRFError — that would mislead the user into editing SSRF config
    when the real problem is application-level authorization on the target.
    Pre-#38443 we didn't have this guard at all; the new wording only changes
    the Squid path, so verify we don't accidentally widen it."""
    mock_client = MagicMock()
    response = MagicMock()
    response.status_code = 403
    response.headers = {"server": "nginx/1.21", "via": "1.1 varnish"}
    mock_client.request.return_value = response
    mock_get_client.return_value = mock_client

    # Should return the response, not raise.
    returned = make_request("GET", "http://public.example.com/admin")
    assert returned.status_code == 403


@patch("core.helper.ssrf_proxy._get_ssrf_client", autospec=True)
def test_squid_block_with_internal_10_x_url_mentions_allowlist(mock_get_client) -> None:
    """Real-world repro from #38443: 10.x.x.x internal API blocked. The error
    message must still point at SSRF_PROXY_ALLOW_PRIVATE_IPS, not just say
    "private address" without telling the user what to do."""
    mock_client = MagicMock()
    mock_client.request.return_value = _build_squid_blocked_response(status_code=403)
    mock_get_client.return_value = mock_client

    with pytest.raises(ToolSSRFError) as exc_info:
        make_request("POST", "http://10.0.0.42/v1/chat/completions")

    assert "10.0.0.42" in str(exc_info.value)
    assert "SSRF_PROXY_ALLOW_PRIVATE_IPS" in str(exc_info.value)

