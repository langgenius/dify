"""Authenticated controller integration test for OAuth data source sync."""

from unittest.mock import MagicMock, patch

from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from models.source import DataSourceOauthBinding
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)


def test_sync_successful(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    binding = DataSourceOauthBinding(
        tenant_id=tenant.id,
        access_token="test-access-token",
        provider="notion",
        source_info={"workspace_name": "Workspace", "workspace_icon": None, "workspace_id": tenant.id, "pages": []},
        disabled=False,
    )
    db_session_with_containers.add(binding)
    db_session_with_containers.commit()

    provider = MagicMock()
    with patch(
        "controllers.console.auth.data_source_oauth.get_oauth_providers",
        return_value={"notion": provider},
    ):
        response = test_client_with_containers.get(
            f"/console/api/oauth/data-source/notion/{binding.id}/sync",
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert response.status_code == 200
    assert response.get_json() == {"result": "success"}
    provider.sync_data_source.assert_called_once_with(binding.id)
