import json
from collections.abc import Callable

import httpx
import pytest

from core.extension.api_based_extension_requestor import APIBasedExtensionRequestor
from models.api_based_extension import APIBasedExtensionPoint


@pytest.fixture
def install_client(monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]):
    config_overrides(SSRF_PROXY_HTTP_URL=None, SSRF_PROXY_HTTPS_URL=None)
    client_type = httpx.Client

    def install(handler: Callable[[httpx.Request], httpx.Response]):
        requests: list[httpx.Request] = []
        options: list[tuple[dict[str, httpx.BaseTransport] | None, httpx.Timeout]] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return handler(request)

        def client(*, mounts: dict[str, httpx.BaseTransport] | None, timeout: httpx.Timeout) -> httpx.Client:
            options.append((mounts, timeout))
            return client_type(mounts=mounts, timeout=timeout, transport=httpx.MockTransport(respond), trust_env=False)

        monkeypatch.setattr(httpx, "Client", client)
        return requests, options

    return install


def test_request_success(install_client):
    requests, _ = install_client(lambda _: httpx.Response(200, json={"result": "success"}))
    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    result = requestor.request(APIBasedExtensionPoint.PING, {"foo": "bar"})

    assert result == {"result": "success"}
    assert len(requests) == 1
    request = requests[0]
    assert request.method == "POST"
    assert str(request.url) == "http://example.com"
    assert json.loads(request.content) == {"point": APIBasedExtensionPoint.PING.value, "params": {"foo": "bar"}}
    assert request.headers["Content-Type"] == "application/json"
    assert request.headers["Authorization"] == "Bearer test_key"


def test_request_with_ssrf_proxy(
    install_client, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
):
    config_overrides(SSRF_PROXY_HTTP_URL="http://proxy:8080", SSRF_PROXY_HTTPS_URL="https://proxy:8081")
    _, options = install_client(lambda _: httpx.Response(200, json={"result": "success"}))
    proxies: list[str] = []
    transports: list[httpx.MockTransport] = []

    def transport(*, proxy: str) -> httpx.MockTransport:
        proxies.append(proxy)
        result = httpx.MockTransport(lambda _: httpx.Response(200, json={"result": "success"}))
        transports.append(result)
        return result

    monkeypatch.setattr(httpx, "HTTPTransport", transport)
    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    requestor.request(APIBasedExtensionPoint.PING, {})

    assert len(options) == 1
    mounts, timeout = options[0]
    assert mounts == {"http://": transports[0], "https://": transports[1]}
    assert proxies == ["http://proxy:8080", "https://proxy:8081"]
    assert timeout is requestor.timeout


def test_request_with_only_one_proxy_config(install_client, config_overrides: Callable[..., None]):
    config_overrides(SSRF_PROXY_HTTP_URL="http://proxy:8080", SSRF_PROXY_HTTPS_URL=None)
    _, options = install_client(lambda _: httpx.Response(200, json={"result": "success"}))
    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    requestor.request(APIBasedExtensionPoint.PING, {})

    assert len(options) == 1
    assert options[0][0] is None


def test_request_timeout(install_client):
    original = httpx.TimeoutException("timeout")

    def fail(_request: httpx.Request) -> httpx.Response:
        raise original

    install_client(fail)
    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    with pytest.raises(ValueError, match="request timeout") as exc_info:
        requestor.request(APIBasedExtensionPoint.PING, {})

    assert exc_info.value.__cause__ is original


def test_request_connection_error(install_client):
    original = httpx.RequestError("error")

    def fail(_request: httpx.Request) -> httpx.Response:
        raise original

    install_client(fail)
    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    with pytest.raises(ValueError, match="request connection error") as exc_info:
        requestor.request(APIBasedExtensionPoint.PING, {})

    assert exc_info.value.__cause__ is original


def test_request_error_status_code(install_client):
    install_client(lambda _: httpx.Response(404, text="Not Found"))
    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    with pytest.raises(ValueError, match="request error, status_code: 404, content: Not Found"):
        requestor.request(APIBasedExtensionPoint.PING, {})


def test_request_error_status_code_long_content(install_client):
    install_client(lambda _: httpx.Response(500, text="A" * 200))
    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    expected_content = "A" * 100
    with pytest.raises(ValueError, match=f"request error, status_code: 500, content: {expected_content}"):
        requestor.request(APIBasedExtensionPoint.PING, {})
