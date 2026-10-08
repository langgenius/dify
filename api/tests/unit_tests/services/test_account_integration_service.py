from __future__ import annotations

from datetime import datetime

from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.account import AccountIntegrate
from repositories.account_integration_repository import SQLAlchemyAccountIntegrationRepository
from services.account_integration_service import AccountIntegrationService
from tests.unit_tests.model_factories import make_account


def test_list_merges_configured_providers_with_persisted_integrations(
    sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture
) -> None:
    created_at = datetime(2026, 1, 1)
    with sqlite_session_factory.begin() as session:
        session.add(make_account())
        for provider in ("github", "ignored"):
            integration = AccountIntegrate(
                account_id="account-1", provider=provider, open_id=f"{provider}-user", encrypted_token=""
            )
            integration.created_at = created_at
            session.add(integration)
    integrations = SQLAlchemyAccountIntegrationRepository(sqlite_session_factory)
    lookup = mocker.spy(integrations, "list_for_account")
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
    lookup.assert_called_once_with("account-1")
