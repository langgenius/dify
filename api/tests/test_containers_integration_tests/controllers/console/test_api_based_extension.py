"""Integration tests for console API-based extension endpoints using testcontainers."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from constants import HIDDEN_VALUE
from libs.rsa import generate_key_pair
from models import Tenant
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)


def _masked_api_key(api_key: str) -> str:
    if len(api_key) <= 8:
        return api_key[0] + "******" + api_key[-1]
    return api_key[:3] + "******" + api_key[-3:]


@pytest.fixture
def api_extension_client(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> tuple[FlaskClient, dict[str, str], Tenant]:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    tenant.encrypt_public_key = generate_key_pair(tenant.id)
    db_session_with_containers.commit()

    headers = authenticate_console_client(test_client_with_containers, account)
    return test_client_with_containers, headers, tenant


@pytest.fixture(autouse=True)
def mock_api_based_extension_ping():
    with patch("services.api_based_extension_service.APIBasedExtensionRequestor") as requestor:
        requestor.return_value.request.return_value = {"result": "pong"}
        yield requestor


def test_create_response_masks_plaintext_api_key(
    api_extension_client: tuple[FlaskClient, dict[str, str], Tenant],
) -> None:
    client, headers, _ = api_extension_client
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


def test_update_response_masks_new_plaintext_api_key(
    api_extension_client: tuple[FlaskClient, dict[str, str], Tenant],
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


def test_update_response_masks_existing_plaintext_api_key_when_hidden_value_is_submitted(
    api_extension_client: tuple[FlaskClient, dict[str, str], Tenant],
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
