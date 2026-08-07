from __future__ import annotations

from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import ANY, PropertyMock, patch

from controllers.console import console_ns
from controllers.console.auth.data_source_bearer_auth import (
    ApiKeyAuthDataSource,
    ApiKeyAuthDataSourceBinding,
    ApiKeyAuthDataSourceBindingDelete,
)


def _payload_patch(payload: dict):
    return patch.object(
        type(console_ns),
        "payload",
        new_callable=PropertyMock,
        return_value=payload,
    )


def test_list_data_source_auth_uses_injected_tenant_id() -> None:
    api = ApiKeyAuthDataSource()
    method = unwrap(api.get)
    binding = SimpleNamespace(
        id="binding-1",
        category="api_key",
        provider="custom",
        disabled=False,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 1, 2, tzinfo=UTC),
    )

    with (
        patch("controllers.console.auth.data_source_bearer_auth.db"),
        patch(
            "controllers.console.auth.data_source_bearer_auth.ApiKeyAuthService.get_provider_auth_list",
            return_value=[binding],
        ) as get_provider_auth_list,
    ):
        result = method(api, "tenant-1")

    get_provider_auth_list.assert_called_once_with("tenant-1", session=ANY)
    assert result["sources"][0]["id"] == "binding-1"
    assert result["sources"][0]["provider"] == "custom"


def test_create_data_source_auth_binding_uses_injected_tenant_id() -> None:
    api = ApiKeyAuthDataSourceBinding()
    method = unwrap(api.post)
    payload = {
        "category": "api_key",
        "provider": "custom",
        "credentials": {"auth_type": "api_key", "config": {"api_key": "secret"}},
    }

    with (
        _payload_patch(payload),
        patch("controllers.console.auth.data_source_bearer_auth.db"),
        patch("controllers.console.auth.data_source_bearer_auth.ApiKeyAuthService.validate_api_key_auth_args"),
        patch("controllers.console.auth.data_source_bearer_auth.ApiKeyAuthService.create_provider_auth") as create_auth,
    ):
        result, status = method(api, "tenant-1")

    create_auth.assert_called_once_with("tenant-1", payload, session=ANY)
    assert result == {"result": "success"}
    assert status == 200


def test_delete_data_source_auth_binding_uses_injected_tenant_id() -> None:
    api = ApiKeyAuthDataSourceBindingDelete()
    method = unwrap(api.delete)

    with (
        patch("controllers.console.auth.data_source_bearer_auth.db"),
        patch(
            "controllers.console.auth.data_source_bearer_auth.ApiKeyAuthService.delete_provider_auth"
        ) as delete_provider_auth,
    ):
        result, status = method(api, "tenant-1", "binding-1")

    delete_provider_auth.assert_called_once_with("tenant-1", "binding-1", session=ANY)
    assert result == ""
    assert status == 204
