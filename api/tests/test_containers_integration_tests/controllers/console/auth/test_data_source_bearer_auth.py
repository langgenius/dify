"""Controller integration tests for API key data source auth routes."""

import json
from unittest.mock import patch

from flask.testing import FlaskClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.source import DataSourceApiKeyAuthBinding
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)


def test_get_api_key_auth_data_source(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    binding = DataSourceApiKeyAuthBinding(
        tenant_id=tenant.id,
        category="api_key",
        provider="custom_provider",
        credentials=json.dumps({"auth_type": "api_key", "config": {"api_key": "encrypted"}}),
        disabled=False,
    )
    db_session_with_containers.add(binding)
    db_session_with_containers.commit()

    response = test_client_with_containers.get(
        "/console/api/api-key-auth/data-source",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload is not None
    assert len(payload["sources"]) == 1
    assert payload["sources"][0]["provider"] == "custom_provider"


def test_get_api_key_auth_data_source_empty(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, _tenant = create_console_account_and_tenant(db_session_with_containers)

    response = test_client_with_containers.get(
        "/console/api/api-key-auth/data-source",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    assert response.get_json() == {"sources": []}


def test_create_binding_successful(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, _tenant = create_console_account_and_tenant(db_session_with_containers)

    with (
        patch("controllers.console.auth.data_source_bearer_auth.ApiKeyAuthService.validate_api_key_auth_args"),
        patch("controllers.console.auth.data_source_bearer_auth.ApiKeyAuthService.create_provider_auth"),
    ):
        response = test_client_with_containers.post(
            "/console/api/api-key-auth/data-source/binding",
            json={"category": "api_key", "provider": "custom", "credentials": {"key": "value"}},
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert response.status_code == 200
    assert response.get_json() == {"result": "success"}


def test_create_binding_failure(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, _tenant = create_console_account_and_tenant(db_session_with_containers)

    with (
        patch("controllers.console.auth.data_source_bearer_auth.ApiKeyAuthService.validate_api_key_auth_args"),
        patch(
            "controllers.console.auth.data_source_bearer_auth.ApiKeyAuthService.create_provider_auth",
            side_effect=ValueError("Invalid structure"),
        ),
    ):
        response = test_client_with_containers.post(
            "/console/api/api-key-auth/data-source/binding",
            json={"category": "api_key", "provider": "custom", "credentials": {"key": "value"}},
            headers=authenticate_console_client(test_client_with_containers, account),
        )

    assert response.status_code == 500
    payload = response.get_json()
    assert payload is not None
    assert payload["code"] == "auth_failed"
    assert payload["message"] == "Invalid structure"


def test_delete_binding_successful(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    binding = DataSourceApiKeyAuthBinding(
        tenant_id=tenant.id,
        category="api_key",
        provider="custom_provider",
        credentials=json.dumps({"auth_type": "api_key", "config": {"api_key": "encrypted"}}),
        disabled=False,
    )
    db_session_with_containers.add(binding)
    db_session_with_containers.commit()

    response = test_client_with_containers.delete(
        f"/console/api/api-key-auth/data-source/{binding.id}",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 204
    assert (
        db_session_with_containers.scalar(
            select(DataSourceApiKeyAuthBinding).where(DataSourceApiKeyAuthBinding.id == binding.id)
        )
        is None
    )
