from __future__ import annotations

from datetime import UTC, datetime
from inspect import unwrap
from unittest.mock import MagicMock

import pytest
from flask import Flask
from pydantic import ValidationError
from werkzeug.exceptions import Conflict, Forbidden, ServiceUnavailable

from clients.knowledge_fs import (
    KnowledgeFSConfigurationError,
    KnowledgeFSHTTPError,
    KnowledgeSpace,
    KnowledgeSpaceList,
)
from controllers.console.knowledge_spaces.spaces import CreateKnowledgeSpacePayload, KnowledgeSpaceListApi


def _space() -> KnowledgeSpace:
    timestamp = datetime(2026, 7, 15, 8, 0, tzinfo=UTC)
    return KnowledgeSpace(
        id="space-1",
        tenant_id="tenant-dev",
        name="Product docs",
        slug="product-docs",
        description="New RAG knowledge base",
        created_at=timestamp,
        updated_at=timestamp,
    )


def test_create_payload_rejects_slug_longer_than_kfs_contract() -> None:
    with pytest.raises(ValidationError):
        CreateKnowledgeSpacePayload.model_validate(
            {
                "name": "Product docs",
                "slug": "a" * 161,
            }
        )


def test_create_payload_rejects_blank_name() -> None:
    with pytest.raises(ValidationError, match="name must not be blank"):
        CreateKnowledgeSpacePayload.model_validate(
            {
                "name": " \t ",
                "slug": "product-docs",
            }
        )


def test_create_payload_trims_name_before_forwarding_to_kfs() -> None:
    payload = CreateKnowledgeSpacePayload.model_validate(
        {
            "name": "  Product docs \t",
            "slug": "product-docs",
        }
    )

    assert payload.name == "Product docs"


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

    assert response == {"enabled": False, "data": [], "has_more": False, "next_cursor": None}


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


def test_list_proxies_current_dify_tenant_and_user(app: Flask, monkeypatch) -> None:
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
        user_id="account-1",
    )
    assert response["enabled"] is True
    assert response["data"][0]["id"] == "space-1"
    assert response["has_more"] is True
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
            "name": "Product docs",
            "slug": "product-docs",
            "description": "New RAG knowledge base",
        },
    ):
        response, status = method(KnowledgeSpaceListApi())

    service.create_knowledge_space.assert_called_once_with(
        name="Product docs",
        slug="product-docs",
        description="New RAG knowledge base",
        tenant_id="tenant-1",
        user_id="account-1",
    )
    assert status == 201
    assert response["id"] == "space-1"
    assert response["created_at"] == "2026-07-15T08:00:00Z"


def test_create_translates_kfs_slug_conflict(app: Flask, monkeypatch) -> None:
    service = MagicMock()
    service.create_knowledge_space.side_effect = KnowledgeFSHTTPError(
        status_code=409,
        detail="Tenant slug conflict",
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
        json={"name": "Product docs", "slug": "product-docs"},
    ):
        with pytest.raises(Conflict):
            method(KnowledgeSpaceListApi())
