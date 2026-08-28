from http import HTTPStatus
from inspect import unwrap
from unittest.mock import MagicMock, create_autospec, patch
from uuid import UUID

from flask import Flask

from controllers.console.auth.data_source_oauth import (
    OAuthDataSource,
    OAuthDataSourceBinding,
    OAuthDataSourceCallback,
    OAuthDataSourceSync,
)
from extensions.ext_application_services import ApplicationServices
from machinery.context import RequestContext
from services.data_source_oauth_service import (
    DataSourceOAuthError,
    InvalidDataSourceOAuthCodeError,
    InvalidDataSourceOAuthProviderError,
)
from services.entities.data_source_oauth_entities import DataSourceOAuthCallback


def _request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id=None,
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


def _services(service: MagicMock) -> MagicMock:
    services = create_autospec(ApplicationServices, instance=True, spec_set=True)
    services.resolve_data_source_oauth.return_value = service
    return services


def test_get_delegates_to_application_service_and_serializes_response() -> None:
    service = MagicMock()
    service.start_authorization.return_value = "https://notion.example/authorize"
    context = _request_context()

    with patch(
        "controllers.console.auth.data_source_oauth.application_services",
        return_value=_services(service),
    ):
        result = unwrap(OAuthDataSource.get)(OAuthDataSource(), context, "notion")

    assert result == ({"data": "https://notion.example/authorize"}, HTTPStatus.OK)
    service.start_authorization.assert_called_once_with(context)


def test_get_maps_unknown_provider_to_bad_request() -> None:
    service = MagicMock()
    services = _services(service)
    services.resolve_data_source_oauth.side_effect = InvalidDataSourceOAuthProviderError

    with patch(
        "controllers.console.auth.data_source_oauth.application_services",
        return_value=services,
    ):
        result = unwrap(OAuthDataSource.get)(OAuthDataSource(), _request_context(), "unknown")

    assert result == ({"error": "Invalid provider"}, HTTPStatus.BAD_REQUEST)


def test_callback_parses_query_and_returns_flask_redirect() -> None:
    app = Flask(__name__)
    service = MagicMock()
    service.complete_callback.return_value = DataSourceOAuthCallback(provider="notion", code="code-1", error=None)

    with (
        app.test_request_context("/?code=code-1"),
        patch(
            "controllers.console.auth.data_source_oauth.dify_config.CONSOLE_WEB_URL",
            "https://console.example/root?lang=en#top",
        ),
        patch(
            "controllers.console.auth.data_source_oauth.application_services",
            return_value=_services(service),
        ),
    ):
        response = OAuthDataSourceCallback().get("notion")

    assert response.status_code == HTTPStatus.FOUND
    assert response.location == "https://console.example/root?lang=en&type=notion&code=code-1#top"
    service.complete_callback.assert_called_once_with(code="code-1", error=None)


def test_binding_parses_query_and_delegates_with_request_context() -> None:
    app = Flask(__name__)
    service = MagicMock()
    context = _request_context()

    with (
        app.test_request_context("/?code=code-1"),
        patch(
            "controllers.console.auth.data_source_oauth.application_services",
            return_value=_services(service),
        ),
    ):
        result = unwrap(OAuthDataSourceBinding.get)(OAuthDataSourceBinding(), context, "notion")

    assert result == ({"result": "success"}, HTTPStatus.OK)
    service.bind.assert_called_once_with(context, code="code-1")


def test_binding_maps_invalid_code_to_bad_request() -> None:
    app = Flask(__name__)
    service = MagicMock()

    with (
        app.test_request_context("/?code="),
        patch(
            "controllers.console.auth.data_source_oauth.application_services",
            return_value=_services(service),
        ),
    ):
        result = unwrap(OAuthDataSourceBinding.get)(OAuthDataSourceBinding(), _request_context(), "notion")

    assert result == ({"error": "Invalid code"}, HTTPStatus.BAD_REQUEST)
    service.bind.assert_not_called()


def test_binding_maps_application_code_error_to_bad_request() -> None:
    app = Flask(__name__)
    service = MagicMock()
    service.bind.side_effect = InvalidDataSourceOAuthCodeError

    with (
        app.test_request_context("/?code=code-1"),
        patch(
            "controllers.console.auth.data_source_oauth.application_services",
            return_value=_services(service),
        ),
    ):
        result = unwrap(OAuthDataSourceBinding.get)(OAuthDataSourceBinding(), _request_context(), "notion")

    assert result == ({"error": "Invalid code"}, HTTPStatus.BAD_REQUEST)


def test_sync_converts_route_uuid_and_delegates() -> None:
    service = MagicMock()
    context = _request_context()
    binding_id = UUID("11111111-1111-1111-1111-111111111111")

    with patch(
        "controllers.console.auth.data_source_oauth.application_services",
        return_value=_services(service),
    ):
        result = unwrap(OAuthDataSourceSync.get)(OAuthDataSourceSync(), context, "notion", binding_id)

    assert result == ({"result": "success"}, HTTPStatus.OK)
    service.sync.assert_called_once_with(context, binding_id=str(binding_id))


def test_sync_hides_provider_failure_details() -> None:
    service = MagicMock()
    service.sync.side_effect = DataSourceOAuthError("provider details")
    binding_id = UUID("11111111-1111-1111-1111-111111111111")

    with (
        patch(
            "controllers.console.auth.data_source_oauth.application_services",
            return_value=_services(service),
        ),
        patch("controllers.console.auth.data_source_oauth.logger.exception") as log_exception,
    ):
        result = unwrap(OAuthDataSourceSync.get)(OAuthDataSourceSync(), _request_context(), "notion", binding_id)

    assert result == ({"error": "OAuth data source process failed"}, HTTPStatus.BAD_REQUEST)
    log_exception.assert_called_once()
