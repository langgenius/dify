"""Document creation loads billing policy without holding database transactions."""

from collections.abc import Callable, Iterator

import httpx
import pytest
from sqlalchemy import Connection, Engine, event

from enums import DeploymentEdition
from services.billing_client import transport
from services.knowledge.documents.creation_adapters import load_document_creation_environment
from tests.helpers import billing_builders as builders


class BillingProbeStoppedError(Exception):
    """Stop a billing request before any network I/O occurs."""


@pytest.fixture
def active_transactions(sqlite_engine: Engine) -> Iterator[set[int]]:
    """Track engine transactions; remove all listeners after success or failure."""
    active: set[int] = set()

    def begin(connection: Connection) -> None:
        """Record the connection when its transaction begins."""
        active.add(id(connection))

    def end(connection: Connection) -> None:
        """Remove a committed or rolled-back connection from the active set."""
        active.discard(id(connection))

    event.listen(sqlite_engine, "begin", begin)
    event.listen(sqlite_engine, "commit", end)
    event.listen(sqlite_engine, "rollback", end)
    try:
        with sqlite_engine.begin():
            assert active
        assert not active
        yield active
    finally:
        event.remove(sqlite_engine, "begin", begin)
        event.remove(sqlite_engine, "commit", end)
        event.remove(sqlite_engine, "rollback", end)


@pytest.mark.parametrize("billing_fails", [False, True])
def test_billing_http_boundary_does_not_hold_a_transaction(
    active_transactions: set[int],
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
    billing_fails: bool,
) -> None:
    """Given Cloud configuration, billing success or failure leaves no open SQL transaction."""
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        BILLING_API_URL="https://billing.example.test",
        BILLING_QUOTA_API_URL="",
    )
    requested_urls: list[str] = []

    def request(method: str, url: str, **_kwargs: object) -> httpx.Response:
        """Require a transaction-free billing call and return a typed payload or the probe error."""
        assert not active_transactions
        assert method == "GET"
        assert url in {
            "https://billing.example.test/subscription/info",
            "https://billing.example.test/quota/info",
        }
        requested_urls.append(url)
        if billing_fails:
            raise BillingProbeStoppedError()
        payload = (
            builders.subscription_info("professional").model_dump(mode="json")
            if url.endswith("/subscription/info")
            else {
                "trigger_event": {"usage": 0, "limit": 10, "reset_date": 0},
                "api_rate_limit": {"usage": 0, "limit": 10, "reset_date": 0},
            }
        )
        return httpx.Response(
            200,
            json=payload,
            request=httpx.Request(method, url),
        )

    monkeypatch.setattr(transport._http_client, "request", request)
    if billing_fails:
        with pytest.raises(BillingProbeStoppedError):
            load_document_creation_environment("tenant-1")
    else:
        environment = load_document_creation_environment("tenant-1")
        assert environment.limits.enabled is True
        assert environment.limits.sandbox is False
        assert environment.limits.upload_quota_limit == 50
        assert environment.priority_indexing is True
    expected_urls = ["https://billing.example.test/subscription/info"]
    if not billing_fails:
        expected_urls.append("https://billing.example.test/quota/info")
    assert requested_urls == expected_urls
    assert not active_transactions
