"""Integration coverage for console app endpoints that require real persistence boundaries."""

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from models.model import AppMode
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
    create_console_app,
)


@pytest.mark.parametrize(
    "path_template",
    [
        "/console/api/apps/{app_id}/trace-config?tracing_provider=langfuse",
        "/console/api/apps/{app_id}/trace",
    ],
)
def test_trace_endpoints_hide_apps_from_other_tenants(
    container_session: Session,
    container_client: FlaskClient,
    path_template: str,
) -> None:
    account, _tenant = create_console_account_and_tenant(container_session)
    foreign_account, foreign_tenant = create_console_account_and_tenant(container_session)
    foreign_app = create_console_app(
        container_session,
        tenant_id=foreign_tenant.id,
        account_id=foreign_account.id,
        mode=AppMode.CHAT,
    )

    response = container_client.get(
        path_template.format(app_id=foreign_app.id),
        headers=authenticate_console_client(container_client, account),
    )

    assert response.status_code == 404
