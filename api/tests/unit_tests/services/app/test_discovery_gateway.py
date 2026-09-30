"""Discovery permissions use enterprise HTTP snapshots without opening Sessions."""

from collections.abc import Callable
from unittest.mock import ANY, Mock, call

import pytest
from sqlalchemy.orm import Session

from machinery.context import RequestContext
from services.app.access import AppAccessFilter
from services.app.discovery_gateway import EnterpriseAppDiscoveryAccess
from services.enterprise.enterprise_service import EnterpriseRequest


@pytest.mark.parametrize("rbac_enabled", [False, True])
def test_visibility_needs_no_database_session(
    config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch, rbac_enabled: bool
) -> None:
    config_overrides(RBAC_ENABLED=rbac_enabled)
    send = Mock(
        side_effect=[
            {"workspace": {"permission_keys": ["app.full_access", "app.create_and_management"]}},
            {"unrestricted": False, "resource_ids": ["app-1"]},
        ]
    )
    monkeypatch.setattr(EnterpriseRequest, "send_inner_rbac_request", send)

    def reject_session(*_args: object, **_kwargs: object) -> None:
        pytest.fail("Discovery permissions must not create a database Session")

    monkeypatch.setattr(Session, "__init__", reject_session)
    result = EnterpriseAppDiscoveryAccess().visibility(RequestContext("req", None, "account-1", "tenant-1"))
    if rbac_enabled:
        assert result == AppAccessFilter({"app-1"}, False)
        assert send.call_args_list == [
            call(
                "GET",
                endpoint,
                tenant_id="tenant-1",
                account_id="account-1",
                params=None,
                json=None,
                timeout=ANY,
            )
            for endpoint in ("/rbac/my-permissions", "/rbac/apps/whitelist/resources")
        ]
    else:
        assert result == AppAccessFilter.unrestricted()
        send.assert_not_called()
