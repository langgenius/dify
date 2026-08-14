import httpx
import pytest
from pytest_mock import MockerFixture

from core.extension.api_based_extension_requestor import APIBasedExtensionRequestor
from models.api_based_extension import APIBasedExtensionPoint


class _Resp:
    def __init__(self, status_code: int, *, json_value=None, text: str = ""):
        self.status_code = status_code
        self.text = text
        self._json_value = json_value

    def json(self):
        return self._json_value


def test_request_success(mocker: MockerFixture):
    mock_response = _Resp(200, json_value={"result": "success"})
    mock_make_request = mocker.patch(
        "core.extension.api_based_extension_requestor.make_request", return_value=mock_response
    )

    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    result = requestor.request(APIBasedExtensionPoint.PING, {"foo": "bar"})

    assert result == {"result": "success"}
    mock_make_request.assert_called_once_with(
        method="POST",
        url="http://example.com",
        json={"point": APIBasedExtensionPoint.PING.value, "params": {"foo": "bar"}},
        headers={"Content-Type": "application/json", "Authorization": "Bearer test_key"},
        timeout=requestor.timeout,
    )


def test_request_does_not_construct_httpx_client(mocker: MockerFixture):
    """Refactor: the requestor must go through ssrf_proxy.make_request, not
    construct an httpx.Client directly (the latter bypassed SSRF protection on
    deployments without the proxy mount)."""
    mock_make_request = mocker.patch(
        "core.extension.api_based_extension_requestor.make_request",
        return_value=_Resp(200, json_value={"result": "success"}),
    )
    mock_client_class = mocker.patch("httpx.Client")

    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    requestor.request(APIBasedExtensionPoint.PING, {})

    mock_make_request.assert_called_once()
    mock_client_class.assert_not_called()


def test_request_does_not_read_ssrf_proxy_config(mocker: MockerFixture):
    """Refactor: the conditional SSRF_PROXY_*_URL mounts are gone because
    ssrf_proxy.make_request handles that policy internally. The requestor must
    not touch dify_config.SSRF_PROXY_* at all."""
    mock_make_request = mocker.patch(
        "core.extension.api_based_extension_requestor.make_request",
        return_value=_Resp(200, json_value={"result": "success"}),
    )
    mock_http_proxy = mocker.patch.object(
        __import__("configs", fromlist=["dify_config"]).dify_config, "SSRF_PROXY_HTTP_URL", None
    )
    mock_https_proxy = mocker.patch.object(
        __import__("configs", fromlist=["dify_config"]).dify_config, "SSRF_PROXY_HTTPS_URL", None
    )

    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    requestor.request(APIBasedExtensionPoint.PING, {})

    mock_make_request.assert_called_once()


def test_request_timeout(mocker: MockerFixture):
    mock_make_request = mocker.patch("core.extension.api_based_extension_requestor.make_request")
    mock_make_request.side_effect = httpx.TimeoutException("timeout")

    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    with pytest.raises(ValueError, match="request timeout"):
        requestor.request(APIBasedExtensionPoint.PING, {})


def test_request_connection_error(mocker: MockerFixture):
    mock_make_request = mocker.patch("core.extension.api_based_extension_requestor.make_request")
    mock_make_request.side_effect = httpx.RequestError("error")

    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    with pytest.raises(ValueError, match="request connection error"):
        requestor.request(APIBasedExtensionPoint.PING, {})


def test_request_error_status_code(mocker: MockerFixture):
    mock_response = _Resp(404, text="Not Found")
    mocker.patch(
        "core.extension.api_based_extension_requestor.make_request", return_value=mock_response
    )

    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    with pytest.raises(ValueError, match="request error, status_code: 404, content: Not Found"):
        requestor.request(APIBasedExtensionPoint.PING, {})


def test_request_error_status_code_long_content(mocker: MockerFixture):
    mock_response = _Resp(500, text="A" * 200)
    mocker.patch(
        "core.extension.api_based_extension_requestor.make_request", return_value=mock_response
    )

    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    expected_content = "A" * 100
    with pytest.raises(ValueError, match=f"request error, status_code: 500, content: {expected_content}"):
        requestor.request(APIBasedExtensionPoint.PING, {})
