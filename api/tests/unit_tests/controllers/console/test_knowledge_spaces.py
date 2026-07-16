from __future__ import annotations

from datetime import UTC, datetime
from inspect import unwrap
from unittest.mock import MagicMock

import pytest
from flask import Flask
from pydantic import ValidationError
from werkzeug.exceptions import BadGateway, Conflict, Forbidden, ServiceUnavailable

from clients.knowledge_fs.generated.models import KnowledgeSpace, KnowledgeSpaceList
from controllers.console.knowledge_spaces.spaces import CreateKnowledgeSpacePayload, KnowledgeSpaceListApi
from services.knowledge_space_service import (
    KnowledgeFSConfigurationError,
    KnowledgeFSUpstreamError,
)


def _space() -> KnowledgeSpace:
    timestamp = datetime(2026, 7, 15, 8, 0, tzinfo=UTC)
    return KnowledgeSpace(
        id="space-1",
        tenant_id="tenant-dev",
        name="Product docs",
        revision=1,
        slug="product-docs",
        created_at=timestamp,
        updated_at=timestamp,
    )


def test_create_payload_accepts_server_generated_slug() -> None:
    payload = CreateKnowledgeSpacePayload.model_validate(
        {
            "idempotency_key": "create-product-docs",
            "name": "Product docs",
        }
    )

    assert payload.idempotency_key == "create-product-docs"
    assert payload.name == "Product docs"


def test_create_payload_requires_idempotency_key() -> None:
    with pytest.raises(ValidationError, match="idempotency_key"):
        CreateKnowledgeSpacePayload.model_validate({"name": "Product docs"})


def test_list_returns_disabled_contract_without_kfs_configuration(
    app: Flask,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.create_knowledge_space_service",
        lambda: None,
    )
    method = unwrap(KnowledgeSpaceListApi.get)

    with app.test_request_context("/console/api/knowledge-spaces"):
        response = method(KnowledgeSpaceListApi())

    assert response == {"enabled": False, "data": [], "next_cursor": None}


def test_list_enforces_workspace_level_dataset_read_rbac(app: Flask, monkeypatch) -> None:
    method = KnowledgeSpaceListApi.get
    for _ in range(3):
        method = method.__wrapped__

    monkeypatch.setattr("controllers.common.wraps.dify_config.RBAC_ENABLED", True)
    monkeypatch.setattr(
        "controllers.common.wraps.current_account_with_tenant",
        lambda: (MagicMock(id="account-1"), "tenant-1"),
    )
    enforce = MagicMock(side_effect=Forbidden())
    monkeypatch.setattr("controllers.common.wraps.enforce_rbac_access", enforce)

    with app.test_request_context("/console/api/knowledge-spaces"):
        with pytest.raises(Forbidden):
            method(KnowledgeSpaceListApi())

    assert enforce.call_args.kwargs["resource_required"] is False


def test_list_proxies_current_dify_tenant(app: Flask, monkeypatch) -> None:
    service = MagicMock()
    service.list_knowledge_spaces.return_value = KnowledgeSpaceList(
        items=[_space()],
        next_cursor="product-docs",
    )
    account = MagicMock(id="account-1")
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.create_knowledge_space_service",
        lambda: service,
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.current_account_with_tenant",
        lambda: (account, "tenant-1"),
    )
    method = unwrap(KnowledgeSpaceListApi.get)

    with app.test_request_context(
        "/console/api/knowledge-spaces",
        query_string={"limit": "20", "cursor": "previous-space"},
    ):
        response = method(KnowledgeSpaceListApi())

    service.list_knowledge_spaces.assert_called_once_with(
        limit=20,
        cursor="previous-space",
        tenant_id="tenant-1",
    )
    assert response["enabled"] is True
    assert response["data"][0]["id"] == "space-1"
    assert response["data"][0]["description"] is None
    assert response["next_cursor"] == "product-docs"


def test_list_reports_partial_kfs_configuration_as_unavailable(app: Flask, monkeypatch) -> None:
    def raise_configuration_error():
        raise KnowledgeFSConfigurationError("missing token")

    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.create_knowledge_space_service",
        raise_configuration_error,
    )
    method = unwrap(KnowledgeSpaceListApi.get)

    with app.test_request_context("/console/api/knowledge-spaces"):
        with pytest.raises(ServiceUnavailable):
            method(KnowledgeSpaceListApi())


def test_create_proxies_validated_payload_and_current_request_context(app: Flask, monkeypatch) -> None:
    service = MagicMock()
    service.create_knowledge_space.return_value = _space()
    account = MagicMock(id="account-1", is_dataset_editor=True)
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.create_knowledge_space_service",
        lambda: service,
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.current_account_with_tenant",
        lambda: (account, "tenant-1"),
    )
    method = unwrap(KnowledgeSpaceListApi.post)

    with app.test_request_context(
        "/console/api/knowledge-spaces",
        method="POST",
        json={
            "idempotency_key": "create-product-docs",
            "name": "Product docs",
            "description": "New RAG knowledge base",
        },
    ):
        response, status = method(KnowledgeSpaceListApi())

    service.create_knowledge_space.assert_called_once_with(
        idempotency_key="create-product-docs",
        name="Product docs",
        description="New RAG knowledge base",
        tenant_id="tenant-1",
    )
    assert status == 201
    assert response["id"] == "space-1"
    assert response["description"] is None
    assert response["created_at"] == "2026-07-15T08:00:00Z"


def test_create_preserves_safe_kfs_status(app: Flask, monkeypatch) -> None:
    service = MagicMock()
    service.create_knowledge_space.side_effect = KnowledgeFSUpstreamError(
        "KnowledgeFS returned HTTP 409",
        status_code=409,
    )
    account = MagicMock(id="account-1", is_dataset_editor=True)
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.create_knowledge_space_service",
        lambda: service,
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.current_account_with_tenant",
        lambda: (account, "tenant-1"),
    )
    method = unwrap(KnowledgeSpaceListApi.post)

    with app.test_request_context(
        "/console/api/knowledge-spaces",
        method="POST",
        json={"idempotency_key": "create-product-docs", "name": "Product docs"},
    ):
        with pytest.raises(Conflict, match="KnowledgeFS request failed"):
            method(KnowledgeSpaceListApi())


def test_list_normalizes_malformed_kfs_success_response(app: Flask, monkeypatch) -> None:
    space = _space()
    space.id = 123  # type: ignore[assignment]
    service = MagicMock()
    service.list_knowledge_spaces.return_value = KnowledgeSpaceList(items=[space])
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.create_knowledge_space_service",
        lambda: service,
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.current_account_with_tenant",
        lambda: (MagicMock(id="account-1"), "tenant-1"),
    )
    method = unwrap(KnowledgeSpaceListApi.get)

    with app.test_request_context("/console/api/knowledge-spaces"):
        with pytest.raises(BadGateway, match="KnowledgeFS returned an invalid response"):
            method(KnowledgeSpaceListApi())


def test_create_reports_static_tenant_mismatch_as_unavailable(app: Flask, monkeypatch) -> None:
    service = MagicMock()
    service.create_knowledge_space.side_effect = KnowledgeFSConfigurationError(
        "KNOWLEDGE_FS_STATIC_TENANT_ID does not match the current Dify workspace"
    )
    account = MagicMock(id="account-1", is_dataset_editor=True)
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.create_knowledge_space_service",
        lambda: service,
    )
    monkeypatch.setattr(
        "controllers.console.knowledge_spaces.spaces.current_account_with_tenant",
        lambda: (account, "tenant-1"),
    )
    method = unwrap(KnowledgeSpaceListApi.post)

    with app.test_request_context(
        "/console/api/knowledge-spaces",
        method="POST",
        json={"idempotency_key": "create-product-docs", "name": "Product docs"},
    ):
        with pytest.raises(ServiceUnavailable, match="KnowledgeFS integration is misconfigured"):
            method(KnowledgeSpaceListApi())
