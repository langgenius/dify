"""Integration tests for console API-based extension endpoints using testcontainers."""

from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import patch

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from constants import HIDDEN_VALUE
from libs.rsa import generate_key_pair
from models.api_based_extension import APIBasedExtension
from services.api_based_extension_service import APIBasedExtensionService
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)
from tests.test_containers_integration_tests.helpers import DatabaseState


def _masked_api_key(api_key: str) -> str:
    if len(api_key) <= 8:
        return api_key[0] + "******" + api_key[-1]
    return api_key[:3] + "******" + api_key[-3:]


@pytest.fixture
def api_extension_client(
    transactional_db_session: Session,
    test_client_with_containers: FlaskClient,
) -> tuple[FlaskClient, dict[str, str], str]:
    account, tenant = create_console_account_and_tenant(transactional_db_session)
    tenant_id = tenant.id
    tenant.encrypt_public_key = generate_key_pair(tenant.id)
    transactional_db_session.commit()

    headers = authenticate_console_client(test_client_with_containers, account)
    return test_client_with_containers, headers, tenant_id


@pytest.fixture(autouse=True)
def mock_api_based_extension_ping() -> Iterator[object]:
    with patch("services.api_based_extension_service.APIBasedExtensionRequestor") as requestor:
        requestor.return_value.request.return_value = {"result": "pong"}
        yield requestor


def test_create_response_masks_plaintext_api_key(
    api_extension_client: tuple[FlaskClient, dict[str, str], str],
    database_state: DatabaseState,
) -> None:
    client, headers, tenant_id = api_extension_client
    api_key = "plain-secret-12345"

    response = client.post(
        "/console/api/api-based-extension",
        headers=headers,
        json={
            "name": "Docs API",
            "api_endpoint": "https://docs.example.com/hook",
            "api_key": api_key,
        },
    )

    assert response.status_code == 201
    assert response.json is not None
    assert response.json["api_key"] == _masked_api_key(api_key)
    extension = database_state.one(APIBasedExtension, APIBasedExtension.id == response.json["id"])
    assert extension.tenant_id == tenant_id


@pytest.mark.requires_redis
def test_list_scopes_api_based_extensions_to_authenticated_tenant(
    transactional_db_session: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(transactional_db_session)
    account_headers = authenticate_console_client(test_client_with_containers, account)
    tenant.encrypt_public_key = generate_key_pair(tenant.id)
    _foreign_account, foreign_tenant = create_console_account_and_tenant(transactional_db_session)
    foreign_tenant_id = foreign_tenant.id
    foreign_tenant.encrypt_public_key = generate_key_pair(foreign_tenant.id)
    transactional_db_session.commit()

    tenant_api_key = "tenant-secret-12345"
    own_extension = APIBasedExtensionService.save(
        APIBasedExtension(
            tenant_id=tenant.id,
            name="Tenant API",
            api_endpoint="https://tenant.example.com/hook",
            api_key=tenant_api_key,
        ),
        session=transactional_db_session,
    )
    APIBasedExtensionService.save(
        APIBasedExtension(
            tenant_id=foreign_tenant_id,
            name="Foreign API",
            api_endpoint="https://foreign.example.com/hook",
            api_key="foreign-secret-12345",
        ),
        session=transactional_db_session,
    )

    response = test_client_with_containers.get(
        "/console/api/api-based-extension",
        headers=account_headers,
    )

    assert response.status_code == 200
    assert response.json is not None
    assert response.json == [
        {
            "id": own_extension.id,
            "name": "Tenant API",
            "api_endpoint": "https://tenant.example.com/hook",
            "api_key": _masked_api_key(tenant_api_key),
            "created_at": int(own_extension.created_at.timestamp()),
        }
    ]


@pytest.mark.requires_redis
def test_update_response_masks_new_plaintext_api_key(
    api_extension_client: tuple[FlaskClient, dict[str, str], str],
    database_state: DatabaseState,
) -> None:
    client, headers, _ = api_extension_client
    new_api_key = "new-secret-67890"
    create_response = client.post(
        "/console/api/api-based-extension",
        headers=headers,
        json={
            "name": "Docs API",
            "api_endpoint": "https://docs.example.com/hook",
            "api_key": "old-secret-12345",
        },
    )
    assert create_response.json is not None

    update_response = client.post(
        f"/console/api/api-based-extension/{create_response.json['id']}",
        headers=headers,
        json={
            "name": "Docs API Updated",
            "api_endpoint": "https://docs.example.com/v2",
            "api_key": new_api_key,
        },
    )

    assert update_response.status_code == 200
    assert update_response.json is not None
    assert update_response.json["api_key"] == _masked_api_key(new_api_key)
    extension = database_state.one(APIBasedExtension, APIBasedExtension.id == create_response.json["id"])
    assert extension.name == "Docs API Updated"
    assert extension.api_endpoint == "https://docs.example.com/v2"


@pytest.mark.requires_redis
def test_update_response_masks_existing_plaintext_api_key_when_hidden_value_is_submitted(
    api_extension_client: tuple[FlaskClient, dict[str, str], str],
    database_state: DatabaseState,
) -> None:
    client, headers, _ = api_extension_client
    existing_api_key = "old-secret-12345"
    create_response = client.post(
        "/console/api/api-based-extension",
        headers=headers,
        json={
            "name": "Docs API",
            "api_endpoint": "https://docs.example.com/hook",
            "api_key": existing_api_key,
        },
    )
    assert create_response.json is not None

    update_response = client.post(
        f"/console/api/api-based-extension/{create_response.json['id']}",
        headers=headers,
        json={
            "name": "Docs API Updated",
            "api_endpoint": "https://docs.example.com/v2",
            "api_key": HIDDEN_VALUE,
        },
    )

    assert update_response.status_code == 200
    assert update_response.json is not None
    assert update_response.json["api_key"] == _masked_api_key(existing_api_key)
    extension = database_state.one(APIBasedExtension, APIBasedExtension.id == create_response.json["id"])
    assert extension.name == "Docs API Updated"
    assert extension.api_endpoint == "https://docs.example.com/v2"


def test_code_based_extension_returns_requested_module(
    transactional_db_session: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, _tenant = create_console_account_and_tenant(transactional_db_session)
    headers = authenticate_console_client(test_client_with_containers, account)

    response = test_client_with_containers.get(
        "/console/api/code-based-extension?module=moderation",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json is not None
    assert response.json["module"] == "moderation"
    assert isinstance(response.json["data"], list)
    assert all({"name", "label", "form_schema"} <= item.keys() for item in response.json["data"])


@pytest.mark.requires_redis
def test_get_api_based_extension_detail(
    api_extension_client: tuple[FlaskClient, dict[str, str], str],
    transactional_db_session: Session,
    database_state: DatabaseState,
) -> None:
    client, headers, tenant_id = api_extension_client
    api_key = "detail-secret-12345"
    extension = APIBasedExtensionService.save(
        APIBasedExtension(
            tenant_id=tenant_id,
            name="Detail API",
            api_endpoint="https://detail.example.com/hook",
            api_key=api_key,
        ),
        session=transactional_db_session,
    )

    response = client.get(f"/console/api/api-based-extension/{extension.id}", headers=headers)

    assert response.status_code == 200
    assert response.get_json() == {
        "id": extension.id,
        "name": "Detail API",
        "api_endpoint": "https://detail.example.com/hook",
        "api_key": _masked_api_key(api_key),
        "created_at": int(extension.created_at.timestamp()),
    }
    persisted = database_state.one(APIBasedExtension, APIBasedExtension.id == extension.id)
    assert persisted.tenant_id == tenant_id


@pytest.mark.requires_redis
def test_delete_api_based_extension_detail(
    api_extension_client: tuple[FlaskClient, dict[str, str], str],
    database_state: DatabaseState,
) -> None:
    client, headers, _tenant_id = api_extension_client
    create_response = client.post(
        "/console/api/api-based-extension",
        headers=headers,
        json={
            "name": "Delete API",
            "api_endpoint": "https://delete.example.com/hook",
            "api_key": "delete-secret-12345",
        },
    )
    extension_id = create_response.get_json()["id"]

    response = client.delete(f"/console/api/api-based-extension/{extension_id}", headers=headers)

    assert response.status_code == 204
    assert database_state.count(APIBasedExtension, APIBasedExtension.id == extension_id) == 0
