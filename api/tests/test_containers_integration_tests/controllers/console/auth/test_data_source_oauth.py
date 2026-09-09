"""Controller integration tests for console OAuth data source routes."""

from unittest.mock import MagicMock, create_autospec, patch

from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from extensions.ext_application_services import ApplicationServices
from models.source import DataSourceOauthBinding
from services.data_source_oauth_service import InvalidDataSourceOAuthProviderError
from services.entities.data_source_oauth_entities import DataSourceOAuthCallback
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)


def _services(service: MagicMock) -> MagicMock:
    services = create_autospec(ApplicationServices, instance=True, spec_set=True)
    services.resolve_data_source_oauth.return_value = service
    return services


def test_get_oauth_url_successful(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    tenant_id = tenant.id
    current_tenant_id = account.current_tenant_id
    service = MagicMock()
    service.start_authorization.return_value = "http://oauth.provider/auth"

    with patch(
        "controllers.console.auth.data_source_oauth.application_services",
        return_value=_services(service),
    ):
        response = test_client_with_containers.get(
            "/console/api/oauth/data-source/notion",
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert tenant_id == current_tenant_id
    assert response.status_code == 200
    assert response.get_json() == {"data": "http://oauth.provider/auth"}
    service.start_authorization.assert_called_once()


def test_get_oauth_url_invalid_provider(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, _tenant = create_console_account_and_tenant(db_session_with_containers)

    service = MagicMock()
    services = _services(service)
    services.resolve_data_source_oauth.side_effect = InvalidDataSourceOAuthProviderError
    with patch(
        "controllers.console.auth.data_source_oauth.application_services",
        return_value=services,
    ):
        response = test_client_with_containers.get(
            "/console/api/oauth/data-source/unknown_provider",
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert response.status_code == 400
    assert response.get_json() == {"error": "Invalid provider"}


def test_oauth_callback_successful(test_client_with_containers: FlaskClient) -> None:
    service = MagicMock()
    service.complete_callback.return_value = DataSourceOAuthCallback(provider="notion", code="mock_code", error=None)
    with patch(
        "controllers.console.auth.data_source_oauth.application_services",
        return_value=_services(service),
    ):
        response = test_client_with_containers.get("/console/api/oauth/data-source/callback/notion?code=mock_code")

    assert response.status_code == 302
    assert "code=mock_code" in response.location


def test_oauth_callback_missing_code(test_client_with_containers: FlaskClient) -> None:
    service = MagicMock()
    service.complete_callback.return_value = DataSourceOAuthCallback(
        provider="notion", code=None, error="Access denied"
    )
    with patch(
        "controllers.console.auth.data_source_oauth.application_services",
        return_value=_services(service),
    ):
        response = test_client_with_containers.get("/console/api/oauth/data-source/callback/notion")

    assert response.status_code == 302
    assert "error=Access%20denied" in response.location


def test_oauth_callback_invalid_provider(test_client_with_containers: FlaskClient) -> None:
    service = MagicMock()
    services = _services(service)
    services.resolve_data_source_oauth.side_effect = InvalidDataSourceOAuthProviderError
    with patch(
        "controllers.console.auth.data_source_oauth.application_services",
        return_value=services,
    ):
        response = test_client_with_containers.get("/console/api/oauth/data-source/callback/invalid?code=mock_code")

    assert response.status_code == 400
    assert response.get_json() == {"error": "Invalid provider"}


def test_get_binding_successful(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, _tenant = create_console_account_and_tenant(db_session_with_containers)
    service = MagicMock()
    with patch(
        "controllers.console.auth.data_source_oauth.application_services",
        return_value=_services(service),
    ):
        response = test_client_with_containers.get(
            "/console/api/oauth/data-source/binding/notion?code=auth_code_123",
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert response.status_code == 200
    assert response.get_json() == {"result": "success"}
    service.bind.assert_called_once()


def test_get_binding_missing_code(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, _tenant = create_console_account_and_tenant(db_session_with_containers)
    service = MagicMock()
    with patch(
        "controllers.console.auth.data_source_oauth.application_services",
        return_value=_services(service),
    ):
        response = test_client_with_containers.get(
            "/console/api/oauth/data-source/binding/notion?code=",
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert response.status_code == 400
    assert response.get_json() == {"error": "Invalid code"}


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

    service = MagicMock()
    with patch(
        "controllers.console.auth.data_source_oauth.application_services",
        return_value=_services(service),
    ):
        response = test_client_with_containers.get(
            f"/console/api/oauth/data-source/notion/{binding.id}/sync",
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert response.status_code == 200
    assert response.get_json() == {"result": "success"}
    service.sync.assert_called_once()
