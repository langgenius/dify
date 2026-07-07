import httpx
import pytest
from pytest_mock import MockerFixture

from core.extension.api_based_extension_requestor import APIBasedExtensionRequestor
from models.api_based_extension import APIBasedExtensionPoint


def test_request_success(mocker: MockerFixture):
    # Mock httpx.Client and its context manager
    mock_client = mocker.MagicMock()
    mock_client_instance = mock_client.__enter__.return_value
    mocker.patch("httpx.Client", return_value=mock_client)

    mock_response = mocker.MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"result": "success"}
    mock_client_instance.request.return_value = mock_response

    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    result = requestor.request(APIBasedExtensionPoint.PING, {"foo": "bar"})

    assert result == {"result": "success"}
    mock_client_instance.request.assert_called_once_with(
        method="POST",
        url="http://example.com",
        json={"point": APIBasedExtensionPoint.PING.value, "params": {"foo": "bar"}},
        headers={"Content-Type": "application/json", "Authorization": "Bearer test_key"},
    )


def test_request_with_ssrf_proxy(mocker: MockerFixture):
    # Mock dify_config
    mocker.patch("configs.dify_config.SSRF_PROXY_HTTP_URL", "http://proxy:8080")
    mocker.patch("configs.dify_config.SSRF_PROXY_HTTPS_URL", "https://proxy:8081")

    # Mock httpx.Client
    mock_client = mocker.MagicMock()
    mock_client_class = mocker.patch("httpx.Client", return_value=mock_client)
    mock_client_instance = mock_client.__enter__.return_value

    # Mock response
    mock_response = mocker.MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"result": "success"}
    mock_client_instance.request.return_value = mock_response

    # Mock HTTPTransport
    mock_transport = mocker.patch("httpx.HTTPTransport")

    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    requestor.request(APIBasedExtensionPoint.PING, {})

    # Verify httpx.Client was called with mounts
    mock_client_class.assert_called_once()
    kwargs = mock_client_class.call_args.kwargs
    assert "mounts" in kwargs
    assert "http://" in kwargs["mounts"]
    assert "https://" in kwargs["mounts"]
    assert mock_transport.call_count == 2


def test_request_with_only_one_proxy_config(mocker: MockerFixture):
    # Mock dify_config with only one proxy
    mocker.patch("configs.dify_config.SSRF_PROXY_HTTP_URL", "http://proxy:8080")
    mocker.patch("configs.dify_config.SSRF_PROXY_HTTPS_URL", None)

    # Mock httpx.Client
    mock_client = mocker.MagicMock()
    mock_client_class = mocker.patch("httpx.Client", return_value=mock_client)
    mock_client_instance = mock_client.__enter__.return_value

    # Mock response
    mock_response = mocker.MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"result": "success"}
    mock_client_instance.request.return_value = mock_response

    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    requestor.request(APIBasedExtensionPoint.PING, {})

    # Verify httpx.Client was called with mounts=None (default)
    mock_client_class.assert_called_once()
    kwargs = mock_client_class.call_args.kwargs
    assert kwargs.get("mounts") is None


def test_request_timeout(mocker: MockerFixture):
    mock_client = mocker.MagicMock()
    mock_client_instance = mock_client.__enter__.return_value
    mocker.patch("httpx.Client", return_value=mock_client)
    mock_client_instance.request.side_effect = httpx.TimeoutException("timeout")

    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    with pytest.raises(ValueError, match="request timeout"):
        requestor.request(APIBasedExtensionPoint.PING, {})


def test_request_connection_error(mocker: MockerFixture):
    mock_client = mocker.MagicMock()
    mock_client_instance = mock_client.__enter__.return_value
    mocker.patch("httpx.Client", return_value=mock_client)
    mock_client_instance.request.side_effect = httpx.RequestError("error")

    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    with pytest.raises(ValueError, match="request connection error"):
        requestor.request(APIBasedExtensionPoint.PING, {})


def test_request_error_status_code(mocker: MockerFixture):
    mock_client = mocker.MagicMock()
    mock_client_instance = mock_client.__enter__.return_value
    mocker.patch("httpx.Client", return_value=mock_client)

    mock_response = mocker.MagicMock()
    mock_response.status_code = 404
    mock_response.text = "Not Found"
    mock_client_instance.request.return_value = mock_response

    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    with pytest.raises(ValueError, match="request error, status_code: 404, content: Not Found"):
        requestor.request(APIBasedExtensionPoint.PING, {})


def test_request_error_status_code_long_content(mocker: MockerFixture):
    mock_client = mocker.MagicMock()
    mock_client_instance = mock_client.__enter__.return_value
    mocker.patch("httpx.Client", return_value=mock_client)

    mock_response = mocker.MagicMock()
    mock_response.status_code = 500
    mock_response.text = "A" * 200  # Testing truncation of content
    mock_client_instance.request.return_value = mock_response

    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    expected_content = "A" * 100
    with pytest.raises(ValueError, match=f"request error, status_code: 500, content: {expected_content}"):
        requestor.request(APIBasedExtensionPoint.PING, {})
