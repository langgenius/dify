"""Controller integration tests for API key data source auth routes."""

import json
from unittest.mock import patch

import httpx
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from libs.rsa import generate_key_pair
from models.source import DataSourceApiKeyAuthBinding
from services.auth.jina.jina import JinaAuth
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)
from tests.test_containers_integration_tests.helpers import DatabaseState


def test_get_api_key_auth_data_source(
    container_transaction: Session,
    container_client: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(container_transaction)
    foreign_account, foreign_tenant = create_console_account_and_tenant(container_transaction)
    binding = DataSourceApiKeyAuthBinding(
        tenant_id=tenant.id,
        category="api_key",
        provider="custom_provider",
        credentials=json.dumps({"auth_type": "api_key", "config": {"api_key": "encrypted"}}),
        disabled=False,
    )
    foreign_binding = DataSourceApiKeyAuthBinding(
        tenant_id=foreign_tenant.id,
        category="api_key",
        provider="foreign_provider",
        credentials=json.dumps({"auth_type": "api_key", "config": {"api_key": "encrypted"}}),
        disabled=False,
    )
    container_transaction.add_all([binding, foreign_binding])
    container_transaction.commit()
    authenticate_console_client(container_client, foreign_account)

    response = container_client.get(
        "/console/api/api-key-auth/data-source",
        headers=authenticate_console_client(container_client, account),
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload is not None
    assert payload == {
        "sources": [
            {
                "id": binding.id,
                "category": "api_key",
                "provider": "custom_provider",
                "disabled": False,
                "created_at": int(binding.created_at.timestamp()),
                "updated_at": int(binding.updated_at.timestamp()),
            }
        ]
    }


def test_get_api_key_auth_data_source_empty(
    container_transaction: Session,
    container_client: FlaskClient,
) -> None:
    account, _tenant = create_console_account_and_tenant(container_transaction)
    _foreign_account, foreign_tenant = create_console_account_and_tenant(container_transaction)
    container_transaction.add(
        DataSourceApiKeyAuthBinding(
            tenant_id=foreign_tenant.id,
            category="api_key",
            provider="foreign_provider",
            credentials=json.dumps({"auth_type": "api_key", "config": {"api_key": "encrypted"}}),
            disabled=False,
        )
    )
    container_transaction.commit()

    response = container_client.get(
        "/console/api/api-key-auth/data-source",
        headers=authenticate_console_client(container_client, account),
    )

    assert response.status_code == 200
    assert response.get_json() == {"sources": []}


def test_create_binding_successful(
    container_transaction: Session,
    container_client: FlaskClient,
    container_state: DatabaseState,
) -> None:
    account, tenant = create_console_account_and_tenant(container_transaction)
    tenant_id = tenant.id
    tenant.encrypt_public_key = generate_key_pair(tenant_id)
    container_transaction.commit()
    payload = {
        "category": "api_key",
        "provider": "jinareader",
        "credentials": {"auth_type": "bearer", "config": {"api_key": "plain-secret"}},
    }

    with patch.object(JinaAuth, "_post_request", return_value=httpx.Response(200)) as request:
        response = container_client.post(
            "/console/api/api-key-auth/data-source/binding",
            json=payload,
            headers=authenticate_console_client(container_client, account),
        )

    assert response.status_code == 200
    assert response.get_json() == {"result": "success"}
    request.assert_called_once()
    binding = container_state.one(
        DataSourceApiKeyAuthBinding,
        DataSourceApiKeyAuthBinding.tenant_id == tenant_id,
        DataSourceApiKeyAuthBinding.provider == "jinareader",
    )
    assert binding.credentials is not None
    credentials = json.loads(binding.credentials)
    assert credentials["auth_type"] == "bearer"
    assert credentials["config"]["api_key"] != "plain-secret"


def test_create_binding_failure(
    container_transaction: Session,
    container_client: FlaskClient,
) -> None:
    account, _tenant = create_console_account_and_tenant(container_transaction)

    response = container_client.post(
        "/console/api/api-key-auth/data-source/binding",
        json={
            "category": "api_key",
            "provider": "unsupported",
            "credentials": {"auth_type": "bearer", "config": {"api_key": "plain-secret"}},
        },
        headers=authenticate_console_client(container_client, account),
    )

    assert response.status_code == 500
    payload = response.get_json()
    assert payload is not None
    assert payload["code"] == "auth_failed"
    assert payload["message"] == "Invalid provider"


def test_delete_binding_successful(
    container_transaction: Session,
    container_client: FlaskClient,
    container_state: DatabaseState,
) -> None:
    account, tenant = create_console_account_and_tenant(container_transaction)
    binding = DataSourceApiKeyAuthBinding(
        tenant_id=tenant.id,
        category="api_key",
        provider="custom_provider",
        credentials=json.dumps({"auth_type": "api_key", "config": {"api_key": "encrypted"}}),
        disabled=False,
    )
    container_transaction.add(binding)
    container_transaction.commit()

    response = container_client.delete(
        f"/console/api/api-key-auth/data-source/{binding.id}",
        headers=authenticate_console_client(container_client, account),
    )

    assert response.status_code == 204
    assert container_state.count(DataSourceApiKeyAuthBinding, DataSourceApiKeyAuthBinding.id == binding.id) == 0


def test_delete_binding_scopes_to_authenticated_tenant(
    container_transaction: Session,
    container_client: FlaskClient,
    container_state: DatabaseState,
) -> None:
    account, _tenant = create_console_account_and_tenant(container_transaction)
    foreign_account, foreign_tenant = create_console_account_and_tenant(container_transaction)
    foreign_binding = DataSourceApiKeyAuthBinding(
        tenant_id=foreign_tenant.id,
        category="api_key",
        provider="custom_provider",
        credentials=json.dumps({"auth_type": "api_key", "config": {"api_key": "encrypted"}}),
        disabled=False,
    )
    container_transaction.add(foreign_binding)
    container_transaction.commit()
    foreign_binding_id = foreign_binding.id
    authenticate_console_client(container_client, foreign_account)

    response = container_client.delete(
        f"/console/api/api-key-auth/data-source/{foreign_binding_id}",
        headers=authenticate_console_client(container_client, account),
    )

    assert response.status_code == 204
    assert (
        container_state.one(DataSourceApiKeyAuthBinding, DataSourceApiKeyAuthBinding.id == foreign_binding_id).id
        == foreign_binding_id
    )
