from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest

from services.knowledge_fs.data_facade import KnowledgeFSDataFacade
from services.knowledge_fs.product_dto import (
    KnowledgeFSDocumentResponse,
    KnowledgeFSDocumentRevisionResponse,
    KnowledgeFSLogicalDocumentResponse,
)
from services.knowledge_fs.product_remote import KnowledgeFSProductResourceNotFoundError


def logical_document(*, active: KnowledgeFSDocumentRevisionResponse | None):
    return KnowledgeFSLogicalDocumentResponse(
        active=active,
        active_revision=active.revision if active else None,
        created_at=datetime.now(UTC),
        enabled=True,
        id="logical-1",
        knowledge_space_id="space-1",
        row_version=1,
        status="ready",
        title="Document",
        updated_at=datetime.now(UTC),
        user_metadata={},
    )


def revision() -> KnowledgeFSDocumentRevisionResponse:
    return KnowledgeFSDocumentRevisionResponse(
        activated_at=datetime.now(UTC),
        content_hash="a" * 64,
        created_at=datetime.now(UTC),
        document_asset_id="asset-1",
        document_asset_version=2,
        document_id="logical-1",
        knowledge_space_id="space-1",
        mime_type="text/markdown",
        revision=3,
        size_bytes=4,
        state="active",
    )


def asset() -> KnowledgeFSDocumentResponse:
    return KnowledgeFSDocumentResponse(
        id="asset-1",
        knowledge_space_id="space-1",
        filename="page.md",
        metadata={},
        mime_type="text/markdown",
        object_key="tenant/spaces/space-1/documents/page.md",
        parser_status="parsed",
        sha256="a" * 64,
        size_bytes=4,
        version=2,
        created_at=datetime.now(UTC),
    )


def test_prepare_logical_document_download_resolves_active_asset() -> None:
    facade = MagicMock(spec=KnowledgeFSDataFacade)
    facade.get_logical_document.return_value = logical_document(active=revision())
    facade.get_document.return_value = asset()

    result = KnowledgeFSDataFacade.prepare_logical_document_download(
        facade,
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        document_id="logical-1",
    )

    assert result.document_id == "logical-1"
    assert result.object_key == "tenant/spaces/space-1/documents/page.md"
    facade.get_document.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        document_id="asset-1",
    )


def test_prepare_logical_document_download_rejects_document_without_active_revision() -> None:
    facade = MagicMock(spec=KnowledgeFSDataFacade)
    facade.get_logical_document.return_value = logical_document(active=None)

    with pytest.raises(KnowledgeFSProductResourceNotFoundError):
        KnowledgeFSDataFacade.prepare_logical_document_download(
            facade,
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            document_id="logical-1",
        )
