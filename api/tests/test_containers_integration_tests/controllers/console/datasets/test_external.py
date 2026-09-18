"""Integration tests for console external knowledge API endpoints."""

from __future__ import annotations

import json

from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from models.dataset import ExternalKnowledgeApis
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)


def _create_external_api(
    db_session: Session,
    *,
    tenant_id: str,
    account_id: str,
    name: str,
) -> ExternalKnowledgeApis:
    external_api = ExternalKnowledgeApis(
        tenant_id=tenant_id,
        created_by=account_id,
        updated_by=account_id,
        name=name,
        description=f"{name} description",
        settings=json.dumps(
            {
                "endpoint": "https://example.com",
                "api_key": "test-api-key",
            }
        ),
    )
    db_session.add(external_api)
    db_session.commit()
    return external_api


def test_external_api_template_list_filters_paginates_and_scopes_to_authenticated_tenant(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    """Exercise the real list route, including query parsing, DB lookup, and tenant isolation."""
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    foreign_account, foreign_tenant = create_console_account_and_tenant(db_session_with_containers)
    account_id = account.id
    tenant_id = tenant.id
    foreign_account_id = foreign_account.id
    foreign_tenant_id = foreign_tenant.id
    headers = authenticate_console_client(test_client_with_containers, account)

    _create_external_api(
        db_session_with_containers,
        tenant_id=tenant_id,
        account_id=account_id,
        name="Alpha Primary",
    )
    _create_external_api(
        db_session_with_containers,
        tenant_id=tenant_id,
        account_id=account_id,
        name="Alpha Secondary",
    )
    _create_external_api(
        db_session_with_containers,
        tenant_id=tenant_id,
        account_id=account_id,
        name="Beta Unmatched",
    )
    _create_external_api(
        db_session_with_containers,
        tenant_id=foreign_tenant_id,
        account_id=foreign_account_id,
        name="Alpha Foreign",
    )

    response = test_client_with_containers.get(
        "/console/api/datasets/external-knowledge-api?page=1&limit=1&keyword=Alpha",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json is not None
    assert response.json["page"] == 1
    assert response.json["limit"] == 1
    assert response.json["total"] == 2
    assert response.json["has_more"] is True
    assert len(response.json["data"]) == 1

    first_page_item = response.json["data"][0]
    assert first_page_item["tenant_id"] == tenant_id
    assert first_page_item["name"] in {"Alpha Primary", "Alpha Secondary"}
    assert first_page_item["settings"] == {
        "endpoint": "https://example.com",
        "api_key": "test-api-key",
    }
    assert first_page_item["dataset_bindings"] == []

    second_response = test_client_with_containers.get(
        "/console/api/datasets/external-knowledge-api?page=2&limit=1&keyword=Alpha",
        headers=headers,
    )

    assert second_response.status_code == 200
    assert second_response.json is not None
    assert second_response.json["page"] == 2
    assert second_response.json["limit"] == 1
    assert second_response.json["total"] == 2
    assert len(second_response.json["data"]) == 1

    second_page_item = second_response.json["data"][0]
    assert second_page_item["name"] in {"Alpha Primary", "Alpha Secondary"}
    assert second_response.json["data"][0]["tenant_id"] == tenant_id
