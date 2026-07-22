"""Controller integration tests for console OAuth data source routes."""

from unittest.mock import MagicMock, patch

from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from models.source import DataSourceOauthBinding
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)


def test_get_oauth_url_successful(
    container_transaction: Session,
    container_client: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(container_transaction)
    tenant_id = tenant.id
    current_tenant_id = account.current_tenant_id
    provider = MagicMock()
    provider.get_authorization_url.return_value = "http://oauth.provider/auth"

    with (
        patch("controllers.console.auth.data_source_oauth.get_oauth_providers", return_value={"notion": provider}),
        patch("controllers.console.auth.data_source_oauth.dify_config.NOTION_INTEGRATION_TYPE", None),
    ):
        response = container_client.get(
            "/console/api/oauth/data-source/notion",
            headers=authenticate_console_client(container_client, account),
        )

    assert tenant_id == current_tenant_id
    assert response.status_code == 200
    assert response.get_json() == {"data": "http://oauth.provider/auth"}
    provider.get_authorization_url.assert_called_once_with()


def test_get_oauth_url_internal_integration_saves_configured_secret(
    container_transaction: Session,
    container_client: FlaskClient,
) -> None:
    account, _tenant = create_console_account_and_tenant(container_transaction)
    provider = MagicMock()

    with (
        patch("controllers.console.auth.data_source_oauth.get_oauth_providers", return_value={"notion": provider}),
        patch("controllers.console.auth.data_source_oauth.dify_config.NOTION_INTEGRATION_TYPE", "internal"),
        patch("controllers.console.auth.data_source_oauth.dify_config.NOTION_INTERNAL_SECRET", "internal-secret"),
    ):
        response = container_client.get(
            "/console/api/oauth/data-source/notion",
            headers=authenticate_console_client(container_client, account),
        )

    assert response.status_code == 200
    assert response.get_json() == {"data": "internal"}
    provider.save_internal_access_token.assert_called_once_with("internal-secret")
    provider.get_authorization_url.assert_not_called()


def test_get_oauth_url_invalid_provider(
    container_transaction: Session,
    container_client: FlaskClient,
) -> None:
    account, _tenant = create_console_account_and_tenant(container_transaction)

    with patch("controllers.console.auth.data_source_oauth.get_oauth_providers", return_value={"notion": MagicMock()}):
        response = container_client.get(
            "/console/api/oauth/data-source/unknown_provider",
            headers=authenticate_console_client(container_client, account),
        )

    assert response.status_code == 400
    assert response.get_json() == {"error": "Invalid provider"}


def test_oauth_callback_successful(container_client: FlaskClient) -> None:
    with patch("controllers.console.auth.data_source_oauth.get_oauth_providers", return_value={"notion": MagicMock()}):
        response = container_client.get("/console/api/oauth/data-source/callback/notion?code=mock_code")

    assert response.status_code == 302
    assert "code=mock_code" in response.location


def test_oauth_callback_missing_code(container_client: FlaskClient) -> None:
    with patch("controllers.console.auth.data_source_oauth.get_oauth_providers", return_value={"notion": MagicMock()}):
        response = container_client.get("/console/api/oauth/data-source/callback/notion")

    assert response.status_code == 302
    assert "error=Access%20denied" in response.location


def test_oauth_callback_invalid_provider(container_client: FlaskClient) -> None:
    with patch("controllers.console.auth.data_source_oauth.get_oauth_providers", return_value={"notion": MagicMock()}):
        response = container_client.get("/console/api/oauth/data-source/callback/invalid?code=mock_code")

    assert response.status_code == 400
    assert response.get_json() == {"error": "Invalid provider"}


def test_get_binding_successful(container_client: FlaskClient) -> None:
    provider = MagicMock()
    with patch("controllers.console.auth.data_source_oauth.get_oauth_providers", return_value={"notion": provider}):
        response = container_client.get("/console/api/oauth/data-source/binding/notion?code=auth_code_123")

    assert response.status_code == 200
    assert response.get_json() == {"result": "success"}
    provider.get_access_token.assert_called_once_with("auth_code_123")


def test_get_binding_missing_code(container_client: FlaskClient) -> None:
    with patch("controllers.console.auth.data_source_oauth.get_oauth_providers", return_value={"notion": MagicMock()}):
        response = container_client.get("/console/api/oauth/data-source/binding/notion?code=")

    assert response.status_code == 400
    assert response.get_json() == {"error": "Invalid code"}


def test_sync_successful(
    container_transaction: Session,
    container_client: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(container_transaction)
    binding = DataSourceOauthBinding(
        tenant_id=tenant.id,
        access_token="test-access-token",
        provider="notion",
        source_info={"workspace_name": "Workspace", "workspace_icon": None, "workspace_id": tenant.id, "pages": []},
        disabled=False,
    )
    container_transaction.add(binding)
    container_transaction.commit()

    provider = MagicMock()
    with patch("controllers.console.auth.data_source_oauth.get_oauth_providers", return_value={"notion": provider}):
        response = container_client.get(
            f"/console/api/oauth/data-source/notion/{binding.id}/sync",
            headers=authenticate_console_client(container_client, account),
        )

    assert response.status_code == 200
    assert response.get_json() == {"result": "success"}
    provider.sync_data_source.assert_called_once_with(binding.id)
