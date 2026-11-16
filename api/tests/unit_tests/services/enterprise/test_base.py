"""Unit tests for traceparent header propagation in EnterpriseRequest.

This test module verifies that the W3C traceparent header is properly
generated and included in HTTP requests made by EnterpriseRequest.
"""

from collections.abc import Iterator
from http.cookiejar import CookieJar
from unittest.mock import MagicMock, patch

import httpx
import pytest

from services.enterprise.base import EnterpriseRequest


class TestTraceparentPropagation:
    """Unit tests for traceparent header propagation."""

    @pytest.fixture
    def mock_enterprise_config(self) -> Iterator[None]:
        """Mock EnterpriseRequest configuration."""
        with (
            patch.object(EnterpriseRequest, "base_url", "https://enterprise-api.example.com"),
            patch.object(EnterpriseRequest, "secret_key", "test-secret-key"),
            patch.object(EnterpriseRequest, "secret_key_header", "Enterprise-Api-Secret-Key"),
        ):
            yield

    @pytest.fixture
    def mock_httpx_client(self) -> Iterator[MagicMock]:
        """Mock httpx.Client for testing."""
        with patch("services.enterprise.base.httpx.Client", autospec=True) as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__.return_value = mock_client
            mock_client_class.return_value.__exit__.return_value = None

            # Setup default response
            mock_response = MagicMock()
            mock_response.json.return_value = {"result": "success"}
            mock_client.request.return_value = mock_response

            yield mock_client

    def test_traceparent_header_included_when_generated(
        self, mock_enterprise_config: None, mock_httpx_client: MagicMock
    ) -> None:
        """Test that traceparent header is included when successfully generated."""
        # Arrange
        expected_traceparent = "00-5b8aa5a2d2c872e8321cf37308d69df2-051581bf3bb55c45-01"

        with patch(
            "services.enterprise.base.generate_traceparent_header",
            return_value=expected_traceparent,
            autospec=True,
        ):
            # Act
            EnterpriseRequest.send_request("GET", "/test")

            # Assert
            mock_httpx_client.request.assert_called_once()
            call_args = mock_httpx_client.request.call_args
            headers = call_args[1]["headers"]

            assert "traceparent" in headers
            assert headers["traceparent"] == expected_traceparent
            assert headers["Content-Type"] == "application/json"
            assert headers["Enterprise-Api-Secret-Key"] == "test-secret-key"


type PooledTransport = tuple[list[httpx.Request], list[httpx.Client]]


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
