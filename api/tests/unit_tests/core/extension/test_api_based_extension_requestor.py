import json
from collections.abc import Callable, Iterator
from contextlib import ExitStack
from typing import Never

import httpx
import pytest

from core.extension.api_based_extension_requestor import APIBasedExtensionRequestor
from core.helper import ssrf_proxy
from core.tools.errors import ToolSSRFError
from models.api_based_extension import APIBasedExtensionPoint

type InstallClient = Callable[[Callable[[httpx.Request], httpx.Response]], list[httpx.Request]]


@pytest.fixture
def install_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[InstallClient]:
    """Serve the shared SSRF client from a controlled transport and reject direct HTTPX clients."""
    with ExitStack() as stack:

        def install(handler: Callable[[httpx.Request], httpx.Response]) -> list[httpx.Request]:
            requests: list[httpx.Request] = []

            def respond(request: httpx.Request) -> httpx.Response:
                requests.append(request)
                return handler(request)

            client = stack.enter_context(httpx.Client(transport=httpx.MockTransport(respond)))

            def get_client(verify: bool) -> httpx.Client:
                assert verify is True, "API-based extension requests must always verify TLS"
                return client

            monkeypatch.setattr(ssrf_proxy, "_get_ssrf_client", get_client)

            def reject_direct_client(*_args: object, **_kwargs: object) -> Never:
                pytest.fail("API-based extension request bypassed the shared SSRF client")

            monkeypatch.setattr(httpx, "Client", reject_direct_client)
            return requests

        yield install


def test_request_verifies_tls_even_when_http_node_verify_is_off(
    install_client: InstallClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ssrf_proxy.dify_config, "HTTP_REQUEST_NODE_SSL_VERIFY", False)
    requests = install_client(lambda _: httpx.Response(200, json={"result": "success"}))
    requestor = APIBasedExtensionRequestor(api_endpoint="https://example.com", api_key="test_key")

    assert requestor.request(APIBasedExtensionPoint.PING, {}) == {"result": "success"}
    assert len(requests) == 1


def test_request_success(install_client: InstallClient) -> None:
    requests = install_client(lambda _: httpx.Response(200, json={"result": "success"}))
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
    assert request.extensions["timeout"] == requestor.timeout.as_dict()


def test_request_blocked_by_ssrf_proxy(install_client: InstallClient) -> None:
    install_client(lambda _: httpx.Response(403, headers={"server": "squid/6.10"}, text="Access Denied"))
    requestor = APIBasedExtensionRequestor(api_endpoint="http://10.0.0.1/extension", api_key="test_key")

    with pytest.raises(ToolSSRFError, match="blocked by SSRF protection"):
        requestor.request(APIBasedExtensionPoint.PING, {})


def test_request_timeout(install_client: InstallClient) -> None:
    original = httpx.TimeoutException("timeout")

    def fail(_request: httpx.Request) -> httpx.Response:
        raise original

    requests = install_client(fail)
    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    with pytest.raises(ValueError, match="request timeout") as exc_info:
        requestor.request(APIBasedExtensionPoint.PING, {})

    assert exc_info.value.__cause__ is original
    assert len(requests) == 1


def test_request_connection_error(install_client: InstallClient) -> None:
    original = httpx.RequestError("error")

    def fail(_request: httpx.Request) -> httpx.Response:
        raise original

    requests = install_client(fail)
    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    with pytest.raises(ValueError, match="request connection error") as exc_info:
        requestor.request(APIBasedExtensionPoint.PING, {})

    assert exc_info.value.__cause__ is original
    assert len(requests) == 1


def test_request_error_status_code(install_client: InstallClient) -> None:
    install_client(lambda _: httpx.Response(404, text="Not Found"))
    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    with pytest.raises(ValueError, match="request error, status_code: 404, content: Not Found"):
        requestor.request(APIBasedExtensionPoint.PING, {})


def test_request_error_status_code_long_content(install_client: InstallClient) -> None:
    requests = install_client(lambda _: httpx.Response(500, text="A" * 200))
    requestor = APIBasedExtensionRequestor(api_endpoint="http://example.com", api_key="test_key")
    expected_content = "A" * 100
    with pytest.raises(ValueError, match=f"request error, status_code: 500, content: {expected_content}"):
        requestor.request(APIBasedExtensionPoint.PING, {})

    # Extension calls are not retried, so a 5xx is reported after a single attempt.
    assert len(requests) == 1
