from collections.abc import Callable

import httpx
import pytest

from services.billing_client import transport

type RespondWith = Callable[[httpx.Response], list[httpx.Request]]


@pytest.fixture(autouse=True)
def billing_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BILLING_API_URL", "http://billing/v1")
    monkeypatch.setenv("BILLING_QUOTA_API_URL", "http://quota/v1")
    monkeypatch.setenv("BILLING_API_SECRET_KEY", "secret")


@pytest.fixture
def respond_with(monkeypatch: pytest.MonkeyPatch) -> RespondWith:
    """Route the pooled billing client to a MockTransport that answers every request with `response`."""
    requests: list[httpx.Request] = []

    def install(response: httpx.Response) -> list[httpx.Request]:
        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return response

        monkeypatch.setattr(transport, "_http_client", httpx.Client(transport=httpx.MockTransport(handler)))
        return requests

    return install
