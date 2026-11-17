"""Unit tests for traceparent header propagation in EnterpriseRequest.

This test module verifies that the W3C traceparent header is properly
generated and included in HTTP requests made by EnterpriseRequest.
"""

from collections.abc import Iterator
from http.cookiejar import CookieJar
from unittest.mock import patch

import httpx
import pytest

from services.enterprise.base import BaseRequest, EnterprisePluginManagerRequest, EnterpriseRequest

type PooledTransport = tuple[list[httpx.Request], list[httpx.Client]]


@pytest.fixture
def send_request_transport(monkeypatch: pytest.MonkeyPatch) -> Iterator[PooledTransport]:
    """Serve ``send_request`` calls from an in-process transport and record requests and built clients."""
    from services.enterprise import base

    BaseRequest._close_clients()
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/denied":
            return httpx.Response(403, json={"message": "denied"})
        return httpx.Response(200, json={"result": "success"}, headers={"set-cookie": "session=first; Path=/"})

    real_client = httpx.Client
    clients: list[httpx.Client] = []

    def build(*, mounts: dict[str, httpx.BaseTransport] | None, cookies: CookieJar) -> httpx.Client:
        client = real_client(transport=httpx.MockTransport(handle), mounts=mounts, cookies=cookies)
        clients.append(client)
        return client

    monkeypatch.setattr(base.httpx, "Client", build)
    monkeypatch.setattr(EnterpriseRequest, "base_url", "https://enterprise-api.example.com")
    monkeypatch.setattr(EnterpriseRequest, "secret_key", "test-secret-key")
    monkeypatch.setattr(EnterprisePluginManagerRequest, "base_url", "https://plugin-manager.example.com")
    yield requests, clients
    BaseRequest._close_clients()
    for client in clients:
        client.close()


class TestTraceparentPropagation:
    """Unit tests for traceparent header propagation."""

    def test_traceparent_header_included_when_generated(self, send_request_transport: PooledTransport) -> None:
        """Test that traceparent header is included when successfully generated."""
        requests, _ = send_request_transport
        expected_traceparent = "00-5b8aa5a2d2c872e8321cf37308d69df2-051581bf3bb55c45-01"

        with patch(
            "services.enterprise.base.generate_traceparent_header",
            return_value=expected_traceparent,
            autospec=True,
        ):
            assert EnterpriseRequest.send_request("GET", "/test") == {"result": "success"}

        assert len(requests) == 1
        headers = requests[0].headers
        assert headers["traceparent"] == expected_traceparent
        assert headers["Content-Type"] == "application/json"
        assert headers["Enterprise-Api-Secret-Key"] == "test-secret-key"


class TestSendRequestConnectionPooling:
    """``send_request`` must reuse one client per request class instead of building one per call."""

    @pytest.fixture(autouse=True)
    def _no_traceparent(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from services.enterprise import base

        monkeypatch.setattr(base, "generate_traceparent_header", lambda: None)

    def test_reuses_client_without_sharing_cookies_or_timeouts(self, send_request_transport: PooledTransport) -> None:
        requests, clients = send_request_transport

        assert EnterpriseRequest.send_request("GET", "/info", timeout=3) == {"result": "success"}
        assert EnterpriseRequest.send_request(
            "POST", "/webapp/access-mode", json={"appId": "app-1"}, timeout=7, extra_headers={"X-Extra": "1"}
        ) == {"result": "success"}

        assert len(clients) == 1
        assert not clients[0].is_closed
        assert [request.url.path for request in requests] == ["/info", "/webapp/access-mode"]
        assert "cookie" not in requests[1].headers
        assert "X-Extra" not in requests[0].headers
        assert requests[1].headers["X-Extra"] == "1"
        assert requests[0].extensions["timeout"]["read"] == 3
        assert requests[1].extensions["timeout"]["read"] == 7

    def test_each_request_class_keeps_its_own_client(self, send_request_transport: PooledTransport) -> None:
        requests, clients = send_request_transport

        EnterpriseRequest.send_request("GET", "/info")
        EnterprisePluginManagerRequest.send_request("GET", "/plugins")
        EnterpriseRequest.send_request("GET", "/info")

        assert len(clients) == 2
        assert EnterpriseRequest._get_client() is clients[0]
        assert EnterprisePluginManagerRequest._get_client() is clients[1]
        assert [request.url.host for request in requests] == [
            "enterprise-api.example.com",
            "plugin-manager.example.com",
            "enterprise-api.example.com",
        ]

    def test_concurrent_calls_share_one_client(self, send_request_transport: PooledTransport) -> None:
        from concurrent.futures import ThreadPoolExecutor

        requests, clients = send_request_transport

        def send(index: int) -> object:
            return EnterpriseRequest.send_request("GET", "/info", params={"index": index})

        with ThreadPoolExecutor(max_workers=4) as executor:
            assert list(executor.map(send, range(12))) == [{"result": "success"}] * 12
        assert len(clients) == 1
        assert sorted(int(request.url.params["index"]) for request in requests) == list(range(12))

    def test_error_response_does_not_close_shared_client(self, send_request_transport: PooledTransport) -> None:
        from services.errors.enterprise import EnterpriseAPIForbiddenError

        _, clients = send_request_transport

        with pytest.raises(EnterpriseAPIForbiddenError):
            EnterpriseRequest.send_request("GET", "/denied")

        assert len(clients) == 1
        assert not clients[0].is_closed
        assert EnterpriseRequest.send_request("GET", "/info") == {"result": "success"}
        assert len(clients) == 1

    def test_close_releases_clients_and_next_call_builds_a_new_one(
        self, send_request_transport: PooledTransport
    ) -> None:
        _, clients = send_request_transport

        EnterpriseRequest.send_request("GET", "/info")
        BaseRequest._close_clients()

        assert clients[0].is_closed
        assert EnterpriseRequest.send_request("GET", "/info") == {"result": "success"}
        assert len(clients) == 2
        assert not clients[1].is_closed


class TestRBACConnectionPooling:
    @pytest.fixture
    def pooled_transport(self, monkeypatch: pytest.MonkeyPatch) -> Iterator[PooledTransport]:
        from services.enterprise import base

        EnterpriseRequest._close_rbac_clients()
        requests: list[httpx.Request] = []

        def handle(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json={"ok": True}, headers={"set-cookie": "session=first; Path=/"})

        real_client = httpx.Client
        clients: list[httpx.Client] = []

        def build(*, mounts: dict[str, httpx.BaseTransport] | None, cookies: CookieJar) -> httpx.Client:
            client = real_client(transport=httpx.MockTransport(handle), mounts=mounts, cookies=cookies)
            clients.append(client)
            return client

        monkeypatch.setattr(base.httpx, "Client", build)
        monkeypatch.setattr(EnterpriseRequest, "rbac_base_url", "https://rbac.example.com")
        monkeypatch.setattr(base, "generate_traceparent_header", lambda: None)
        yield requests, clients
        EnterpriseRequest._close_rbac_clients()
        for client in clients:
            client.close()

    def test_reuses_client_without_sharing_identity_or_cookies(self, pooled_transport: PooledTransport) -> None:
        requests, clients = pooled_transport
        assert EnterpriseRequest.send_inner_rbac_request(
            "GET", "/permissions", tenant_id="tenant-a", account_id="account-a", timeout=3
        ) == {"ok": True}
        EnterpriseRequest.send_inner_rbac_request("GET", "/permissions", tenant_id="tenant-b", timeout=7)

        assert len(clients) == 1
        assert not clients[0].is_closed
        assert requests[0].headers["X-Inner-Tenant-Id"] == "tenant-a"
        assert requests[0].headers["X-Inner-Account-Id"] == "account-a"
        assert requests[1].headers["X-Inner-Tenant-Id"] == "tenant-b"
        assert "X-Inner-Account-Id" not in requests[1].headers
        assert "cookie" not in requests[1].headers
        assert requests[0].extensions["timeout"]["read"] == 3
        assert requests[1].extensions["timeout"]["read"] == 7

    def test_close_releases_shared_client(self, pooled_transport: PooledTransport) -> None:
        client = EnterpriseRequest._get_rbac_client()
        EnterpriseRequest._close_rbac_clients()
        assert client.is_closed
        assert EnterpriseRequest._rbac_client is None

    def test_concurrent_calls_share_one_client(self, pooled_transport: PooledTransport) -> None:
        from concurrent.futures import ThreadPoolExecutor

        requests, clients = pooled_transport

        def send(index: int) -> object:
            return EnterpriseRequest.send_inner_rbac_request(
                "GET", "/permissions", tenant_id=f"tenant-{index}", account_id=f"account-{index}"
            )

        with ThreadPoolExecutor(max_workers=4) as executor:
            assert list(executor.map(send, range(12))) == [{"ok": True}] * 12
        assert len(clients) == 1
        assert len(requests) == 12
        for request in requests:
            assert request.headers["X-Inner-Tenant-Id"].removeprefix("tenant-") == request.headers[
                "X-Inner-Account-Id"
            ].removeprefix("account-")
            assert "cookie" not in request.headers

    def test_error_does_not_close_shared_client(self, pooled_transport: PooledTransport) -> None:
        from services.errors.enterprise import EnterpriseAPIForbiddenError

        client = EnterpriseRequest._get_rbac_client()
        with patch.object(client, "request", return_value=httpx.Response(403, json={"message": "denied"})):
            with pytest.raises(EnterpriseAPIForbiddenError):
                EnterpriseRequest.send_inner_rbac_request("GET", "/permissions", tenant_id="tenant-a")
        assert not client.is_closed
        assert EnterpriseRequest.send_inner_rbac_request("GET", "/permissions", tenant_id="tenant-a") == {"ok": True}
