from __future__ import annotations

from datetime import datetime
from unittest.mock import Mock

from machinery.context import RequestContext
from services.account_integration_service import AccountIntegrationService
from services.account_ports import AccountIntegrationRepository
from services.entities.account_entities import AccountIntegrationSnapshot


def test_list_merges_configured_providers_with_persisted_integrations() -> None:
    created_at = datetime(2026, 1, 1)
    integrations = Mock(spec=AccountIntegrationRepository)
    integrations.list_for_account.return_value = [
        AccountIntegrationSnapshot(provider="github", created_at=created_at),
        AccountIntegrationSnapshot(provider="ignored", created_at=created_at),
    ]
    service = AccountIntegrationService(
        integrations=integrations,
        providers=("github", "google"),
    )
    context = RequestContext(
        request_id="request-1",
        trace_id=None,
        account_id="account-1",
        active_workspace_id="workspace-1",
    )

    result = service.list(context)

    assert [(item.provider, item.created_at, item.is_bound) for item in result] == [
        ("github", created_at, True),
        ("google", None, False),
    ]
    integrations.list_for_account.assert_called_once_with("account-1")
