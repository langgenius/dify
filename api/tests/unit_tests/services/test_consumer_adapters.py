"""Shared discovery uses the existing deployment contract and fails closed."""

import pytest

from services.consumer_adapters import SharedConsumerAppDiscovery
from services.enterprise.enterprise_service import EnterpriseService
from services.errors.enterprise import EnterpriseAPIError
from services.webapp_access_query_service import WebAppAccessUnavailableError


def test_shared_discovery_consumes_all_pages_and_deduplicates(monkeypatch: pytest.MonkeyPatch) -> None:
    def list_apps(*, page: int, limit: int) -> dict[str, object]:
        assert limit == 100
        if page == 1:
            return {"data": [{"appId": "app-1"}], "hasMore": True}
        assert page == 2
        return {"data": [{"appId": "app-1"}, {"appId": "app-2"}], "hasMore": False}

    monkeypatch.setattr(EnterpriseService.WebAppAuth, "list_externally_accessible_apps", list_apps)
    assert SharedConsumerAppDiscovery(enabled=True)() == ("app-1", "app-2")
    assert SharedConsumerAppDiscovery(enabled=False)() == ()


@pytest.mark.parametrize("result", [{}, {"data": [], "hasMore": True}, {"data": [], "hasMore": "false"}])
def test_invalid_shared_discovery_response_is_unavailable(
    monkeypatch: pytest.MonkeyPatch, result: dict[str, object]
) -> None:
    monkeypatch.setattr(EnterpriseService.WebAppAuth, "list_externally_accessible_apps", lambda **_kwargs: result)
    with pytest.raises(WebAppAccessUnavailableError):
        SharedConsumerAppDiscovery(enabled=True)()


def test_discovery_outage_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    def unavailable(**_kwargs) -> dict[str, object]:
        raise EnterpriseAPIError("Unavailable", status_code=503)

    monkeypatch.setattr(EnterpriseService.WebAppAuth, "list_externally_accessible_apps", unavailable)
    with pytest.raises(WebAppAccessUnavailableError):
        SharedConsumerAppDiscovery(enabled=True)()
