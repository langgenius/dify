"""Integration tests for console external knowledge API endpoints."""

from __future__ import annotations

import json

import pytest
from sqlalchemy.orm import Session

from controllers.console.datasets import external as external_controller
from core.rag.datasource.retrieval_service import RetrievalService
from models.dataset import Dataset, DatasetQuery, ExternalKnowledgeApis, ExternalKnowledgeBindings
from tests.test_containers_integration_tests.controllers.console.helpers import (
    AuthenticatedConsoleClient,
    create_console_account_and_tenant,
)
from tests.test_containers_integration_tests.helpers import DatabaseState


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


def _external_api_contract(external_api: ExternalKnowledgeApis) -> dict[str, object]:
    return {
        "id": external_api.id,
        "tenant_id": external_api.tenant_id,
        "name": external_api.name,
        "description": external_api.description,
        "settings": external_api.settings_dict,
        "dataset_bindings": [],
        "created_by": external_api.created_by,
        "created_at": external_api.created_at.isoformat(),
    }


def test_external_api_template_list_filters_paginates_and_scopes_to_authenticated_tenant(
    transactional_db_session: Session,
    authenticated_console_client: AuthenticatedConsoleClient,
    database_state: DatabaseState,
) -> None:
    """Exercise the real list route, including query parsing, DB lookup, and tenant isolation."""
    account = authenticated_console_client.account
    tenant = authenticated_console_client.tenant
    test_client_with_containers = authenticated_console_client.client
    foreign_account, foreign_tenant = create_console_account_and_tenant(transactional_db_session)
    account_id = account.id
    tenant_id = tenant.id
    foreign_account_id = foreign_account.id
    foreign_tenant_id = foreign_tenant.id
    headers = authenticated_console_client.headers

    alpha_primary = _create_external_api(
        transactional_db_session,
        tenant_id=tenant_id,
        account_id=account_id,
        name="Alpha Primary",
    )
    alpha_secondary = _create_external_api(
        transactional_db_session,
        tenant_id=tenant_id,
        account_id=account_id,
        name="Alpha Secondary",
    )
    _create_external_api(
        transactional_db_session,
        tenant_id=tenant_id,
        account_id=account_id,
        name="Beta Unmatched",
    )
    _create_external_api(
        transactional_db_session,
        tenant_id=foreign_tenant_id,
        account_id=foreign_account_id,
        name="Alpha Foreign",
    )
    assert database_state.count(ExternalKnowledgeApis) == 4

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

    second_response = test_client_with_containers.get(
        "/console/api/datasets/external-knowledge-api?page=2&limit=1&keyword=Alpha",
        headers=headers,
    )

    assert second_response.status_code == 200
    assert second_response.json is not None
    assert second_response.json["page"] == 2
    assert second_response.json["limit"] == 1
    assert second_response.json["total"] == 2
    assert second_response.json["has_more"] is False
    assert len(second_response.json["data"]) == 1
    returned_by_name = {item["name"]: item for item in [*response.json["data"], *second_response.json["data"]]}
    assert returned_by_name == {
        "Alpha Primary": _external_api_contract(alpha_primary),
        "Alpha Secondary": _external_api_contract(alpha_secondary),
    }


def test_external_api_crud_and_dataset_binding_persist(
    transactional_db_session: Session,
    authenticated_console_client: AuthenticatedConsoleClient,
    database_state: DatabaseState,
) -> None:
    client = authenticated_console_client.client
    headers = authenticated_console_client.headers
    tenant_id = authenticated_console_client.tenant.id
    api_collection_url = "/console/api/datasets/external-knowledge-api"

    with database_state.expect_count_change(ExternalKnowledgeApis, before=0, after=1):
        create_response = client.post(
            api_collection_url,
            headers=headers,
            json={
                "name": "Primary External API",
                "settings": {"endpoint": "https://example.com", "api_key": "secret"},
            },
        )

    assert create_response.status_code == 201
    assert create_response.json is not None
    api_id = create_response.json["id"]
    assert create_response.json["tenant_id"] == tenant_id
    created_api = database_state.one(ExternalKnowledgeApis, ExternalKnowledgeApis.id == api_id)
    expected_detail = _external_api_contract(created_api)

    detail_response = client.get(f"{api_collection_url}/{api_id}", headers=headers)
    update_response = client.patch(
        f"{api_collection_url}/{api_id}",
        headers=headers,
        json={
            "name": "Renamed External API",
            "settings": {"endpoint": "https://example.org", "api_key": "updated-secret"},
        },
    )
    unused_response = client.get(f"{api_collection_url}/{api_id}/use-check", headers=headers)

    assert detail_response.status_code == 200
    assert detail_response.json is not None
    assert detail_response.json == expected_detail
    assert update_response.status_code == 200
    assert update_response.json is not None
    assert update_response.json["name"] == "Renamed External API"
    persisted_api = database_state.one(ExternalKnowledgeApis, ExternalKnowledgeApis.id == api_id)
    assert persisted_api.settings_dict == {"endpoint": "https://example.org", "api_key": "updated-secret"}
    assert unused_response.json == {"is_using": False, "count": 0}

    with database_state.expect_count_change(Dataset, Dataset.provider == "external", before=0, after=1):
        dataset_response = client.post(
            "/console/api/datasets/external",
            headers=headers,
            json={
                "external_knowledge_api_id": api_id,
                "external_knowledge_id": "knowledge-1",
                "name": "External Dataset",
                "description": "Created through the console API",
            },
        )

    assert dataset_response.status_code == 201
    assert dataset_response.json is not None
    dataset_id = dataset_response.json["id"]
    binding = database_state.one(ExternalKnowledgeBindings, ExternalKnowledgeBindings.dataset_id == dataset_id)
    assert binding.external_knowledge_api_id == api_id
    in_use_response = client.get(f"{api_collection_url}/{api_id}/use-check", headers=headers)
    assert in_use_response.json == {"is_using": True, "count": 1}

    unbound_api = _create_external_api(
        transactional_db_session,
        tenant_id=tenant_id,
        account_id=authenticated_console_client.account.id,
        name="Delete Me",
    )
    delete_response = client.delete(f"{api_collection_url}/{unbound_api.id}", headers=headers)

    assert delete_response.status_code == 204
    assert database_state.count(ExternalKnowledgeApis, ExternalKnowledgeApis.id == unbound_api.id) == 0


def test_external_api_detail_is_tenant_scoped(
    transactional_db_session: Session,
    authenticated_console_client: AuthenticatedConsoleClient,
) -> None:
    foreign_account, foreign_tenant = create_console_account_and_tenant(transactional_db_session)
    foreign_api = _create_external_api(
        transactional_db_session,
        tenant_id=foreign_tenant.id,
        account_id=foreign_account.id,
        name="Foreign API",
    )

    response = authenticated_console_client.client.get(
        f"/console/api/datasets/external-knowledge-api/{foreign_api.id}",
        headers=authenticated_console_client.headers,
    )

    assert response.status_code == 404


def test_external_hit_testing_uses_retrieval_contract_and_persists_query(
    transactional_db_session: Session,
    authenticated_console_client: AuthenticatedConsoleClient,
    database_state: DatabaseState,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = authenticated_console_client.account
    tenant = authenticated_console_client.tenant
    external_api = _create_external_api(
        transactional_db_session,
        tenant_id=tenant.id,
        account_id=account.id,
        name="Hit Testing API",
    )
    dataset = Dataset(
        tenant_id=tenant.id,
        name="Hit Testing Dataset",
        description="External hit testing",
        provider="external",
        permission="only_me",
        created_by=account.id,
        maintainer=account.id,
    )
    transactional_db_session.add(dataset)
    transactional_db_session.flush()
    transactional_db_session.add(
        ExternalKnowledgeBindings(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            external_knowledge_api_id=external_api.id,
            external_knowledge_id="knowledge-1",
            created_by=account.id,
        )
    )
    transactional_db_session.commit()
    monkeypatch.setattr(
        RetrievalService,
        "external_retrieve",
        lambda **_kwargs: [
            {
                "content": "Retrieved content",
                "title": "Retrieved title",
                "score": 0.91,
                "metadata": {"source": "external"},
            }
        ],
    )

    with database_state.expect_count_change(DatasetQuery, DatasetQuery.dataset_id == dataset.id, before=0, after=1):
        response = authenticated_console_client.client.post(
            f"/console/api/datasets/{dataset.id}/external-hit-testing",
            headers=authenticated_console_client.headers,
            json={"query": "What is persisted?"},
        )

    assert response.status_code == 200
    assert response.json == {
        "query": {"content": "What is persisted?"},
        "records": [
            {
                "content": "Retrieved content",
                "title": "Retrieved title",
                "score": 0.91,
                "metadata": {"source": "external"},
            }
        ],
    }


def test_bedrock_retrieval_serializes_external_service_response(
    authenticated_console_client: AuthenticatedConsoleClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        external_controller.ExternalDatasetTestService,
        "knowledge_retrieval",
        lambda *_args: {
            "records": [
                {
                    "content": "Bedrock content",
                    "title": "Bedrock title",
                    "score": 0.8,
                    "metadata": {"source": "bedrock"},
                }
            ]
        },
    )

    response = authenticated_console_client.client.post(
        "/console/api/test/retrieval",
        json={
            "retrieval_setting": {"top_k": 2, "score_threshold": 0.5},
            "query": "Bedrock query",
            "knowledge_id": "knowledge-1",
        },
    )

    assert response.status_code == 200
    assert response.json == {
        "records": [
            {
                "content": "Bedrock content",
                "title": "Bedrock title",
                "score": 0.8,
                "metadata": {"source": "bedrock"},
            }
        ]
    }
