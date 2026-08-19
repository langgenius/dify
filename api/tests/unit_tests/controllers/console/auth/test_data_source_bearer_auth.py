from __future__ import annotations

from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import create_autospec, patch
from uuid import UUID

import pytest
from pydantic import ValidationError

from controllers.console.auth.data_source_bearer_auth import (
    ApiKeyAuthBindingPayload,
    ApiKeyAuthDataSource,
    ApiKeyAuthDataSourceBinding,
    ApiKeyAuthDataSourceBindingDelete,
)
from controllers.console.auth.error import (
    DataSourceApiKeyAuthCredentialsRejectedRequestError,
    DataSourceApiKeyAuthProviderNotSupportedError,
    DataSourceApiKeyAuthProviderUnavailableRequestError,
    InvalidDataSourceApiKeyAuthCredentialsRequestError,
)
from libs.exception import BaseHTTPException
from machinery.context import RequestContext
from machinery.errors import ActiveWorkspaceRequiredError
from services.auth.data_source_api_key_auth_service import DataSourceApiKeyAuthService
from services.auth.errors import (
    DataSourceApiKeyAuthCredentialValidationError,
    DataSourceApiKeyAuthProviderUnavailableError,
    InvalidDataSourceApiKeyAuthCredentialsError,
    UnsupportedDataSourceApiKeyAuthProviderError,
)
from services.entities.data_source_api_key_auth_entities import (
    DataSourceApiKeyAuthBindingCreate,
    DataSourceApiKeyAuthBindingRecord,
    DataSourceApiKeyAuthCredentials,
)


def _request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="tenant-1",
    )


def _application_services(service: DataSourceApiKeyAuthService) -> SimpleNamespace:
    return SimpleNamespace(data_source_api_key_auth=service)


def test_list_data_source_auth_passes_context_and_serializes_application_result() -> None:
    api = ApiKeyAuthDataSource()
    method = unwrap(api.get)
    request_context = _request_context()
    service = create_autospec(DataSourceApiKeyAuthService, instance=True, spec_set=True)
    service.list_bindings.return_value = (
        DataSourceApiKeyAuthBindingRecord(
            id="binding-1",
            category="api_key",
            provider="custom",
            disabled=False,
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
            updated_at=datetime(2026, 1, 2, tzinfo=UTC),
        ),
    )

    with patch(
        "controllers.console.auth.data_source_bearer_auth.application_services",
        return_value=_application_services(service),
    ):
        result = method(api, request_context)

    service.list_bindings.assert_called_once_with(request_context)
    assert result == {
        "sources": [
            {
                "id": "binding-1",
                "category": "api_key",
                "provider": "custom",
                "disabled": False,
                "created_at": 1767225600,
                "updated_at": 1767312000,
            }
        ]
    }


def test_create_data_source_auth_binding_passes_context_and_command() -> None:
    api = ApiKeyAuthDataSourceBinding()
    method = unwrap(api.post)
    payload = {
        "category": "api_key",
        "provider": "custom",
        "credentials": {
            "auth_type": "api_key",
            "config": {"api_key": "secret", "base_url": "https://example.com"},
        },
    }
    request_context = _request_context()
    req_data = ApiKeyAuthBindingPayload.model_validate(payload)
    service = create_autospec(DataSourceApiKeyAuthService, instance=True, spec_set=True)

    with patch(
        "controllers.console.auth.data_source_bearer_auth.application_services",
        return_value=_application_services(service),
    ):
        result, status = method(api, req_data, request_context)

    service.create_binding.assert_called_once_with(
        request_context,
        DataSourceApiKeyAuthBindingCreate(
            category="api_key",
            provider="custom",
            credentials=DataSourceApiKeyAuthCredentials(
                "api_key",
                "secret",
                {"base_url": "https://example.com"},
            ),
        ),
    )
    assert result == {"result": "success"}
    assert status == 200


def test_create_data_source_auth_binding_maps_unsupported_provider_to_bad_request() -> None:
    api = ApiKeyAuthDataSourceBinding()
    method = unwrap(api.post)
    request_context = _request_context()
    req_data = ApiKeyAuthBindingPayload(
        category="api_key",
        provider="unsupported",
        credentials={"auth_type": "api_key", "config": {"api_key": "secret"}},
    )
    service = create_autospec(DataSourceApiKeyAuthService, instance=True, spec_set=True)
    service.create_binding.side_effect = UnsupportedDataSourceApiKeyAuthProviderError(req_data.provider)

    with (
        patch(
            "controllers.console.auth.data_source_bearer_auth.application_services",
            return_value=_application_services(service),
        ),
        pytest.raises(DataSourceApiKeyAuthProviderNotSupportedError) as exc_info,
    ):
        method(api, req_data, request_context)

    assert exc_info.value.code == 400


@pytest.mark.parametrize(
    ("service_error", "request_error", "expected_status"),
    [
        (
            InvalidDataSourceApiKeyAuthCredentialsError("Invalid auth type"),
            InvalidDataSourceApiKeyAuthCredentialsRequestError,
            400,
        ),
        (
            DataSourceApiKeyAuthCredentialValidationError("Credentials rejected"),
            DataSourceApiKeyAuthCredentialsRejectedRequestError,
            400,
        ),
        (
            DataSourceApiKeyAuthProviderUnavailableError("firecrawl"),
            DataSourceApiKeyAuthProviderUnavailableRequestError,
            502,
        ),
    ],
)
def test_create_data_source_auth_binding_maps_domain_errors(
    service_error: Exception,
    request_error: type[BaseHTTPException],
    expected_status: int,
) -> None:
    api = ApiKeyAuthDataSourceBinding()
    method = unwrap(api.post)
    request_context = _request_context()
    req_data = ApiKeyAuthBindingPayload(
        category="api_key",
        provider="firecrawl",
        credentials={"auth_type": "bearer", "config": {"api_key": "secret"}},
    )
    service = create_autospec(DataSourceApiKeyAuthService, instance=True, spec_set=True)
    service.create_binding.side_effect = service_error

    with (
        patch(
            "controllers.console.auth.data_source_bearer_auth.application_services",
            return_value=_application_services(service),
        ),
        pytest.raises(request_error) as exc_info,
    ):
        method(api, req_data, request_context)

    assert exc_info.value.code == expected_status


@pytest.mark.parametrize(
    "payload",
    [
        {"category": "", "provider": "firecrawl", "credentials": {"auth_type": "bearer", "config": {"api_key": "key"}}},
        {"category": "api_key", "provider": "", "credentials": {"auth_type": "bearer", "config": {"api_key": "key"}}},
        {"category": "api_key", "provider": "firecrawl", "credentials": {"config": {"api_key": "key"}}},
        {"category": "api_key", "provider": "firecrawl", "credentials": {"auth_type": "bearer", "config": {}}},
        {"category": "api_key", "provider": "firecrawl", "credentials": {"auth_type": "bearer", "config": "invalid"}},
    ],
)
def test_api_key_auth_binding_payload_rejects_invalid_structure(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        ApiKeyAuthBindingPayload.model_validate(payload)


def test_create_data_source_auth_binding_preserves_admission_invariant_error() -> None:
    api = ApiKeyAuthDataSourceBinding()
    method = unwrap(api.post)
    request_context = _request_context()
    req_data = ApiKeyAuthBindingPayload(
        category="api_key",
        provider="firecrawl",
        credentials={"auth_type": "bearer", "config": {"api_key": "secret"}},
    )
    service = create_autospec(DataSourceApiKeyAuthService, instance=True, spec_set=True)
    service.create_binding.side_effect = ActiveWorkspaceRequiredError()

    with (
        patch(
            "controllers.console.auth.data_source_bearer_auth.application_services",
            return_value=_application_services(service),
        ),
        pytest.raises(ActiveWorkspaceRequiredError),
    ):
        method(api, req_data, request_context)


def test_delete_data_source_auth_binding_passes_context_and_binding_id() -> None:
    api = ApiKeyAuthDataSourceBindingDelete()
    method = unwrap(api.delete)
    request_context = _request_context()
    binding_id = UUID("31a00aeb-0865-4dd2-952a-5e0de34c57cc")
    service = create_autospec(DataSourceApiKeyAuthService, instance=True, spec_set=True)

    with patch(
        "controllers.console.auth.data_source_bearer_auth.application_services",
        return_value=_application_services(service),
    ):
        result, status = method(api, request_context, binding_id)

    service.delete_binding.assert_called_once_with(request_context, str(binding_id))
    assert result == ""
    assert status == 204
