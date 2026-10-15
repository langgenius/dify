from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal, override

import pytest

from services.knowledge_fs.data_facade import KnowledgeFSDataFacade
from services.knowledge_fs.product_dto import (
    KnowledgeFSDocumentResponse,
    KnowledgeFSDocumentRevisionListResponse,
    KnowledgeFSDocumentRevisionResponse,
    KnowledgeFSLogicalDocumentResponse,
)
from services.knowledge_fs.product_remote import KnowledgeFSProductResourceNotFoundError


def logical_document(
    *,
    active: KnowledgeFSDocumentRevisionResponse | None,
    status: Literal["deleting", "failed", "pending", "ready"] = "ready",
) -> KnowledgeFSLogicalDocumentResponse:
    return KnowledgeFSLogicalDocumentResponse(
        active=active,
        active_revision=active.revision if active else None,
        created_at=datetime.now(UTC),
        enabled=True,
        id="logical-1",
        knowledge_space_id="space-1",
        row_version=1,
        status=status,
        title="Document",
        updated_at=datetime.now(UTC),
        user_metadata={},
    )


def revision(
    *, state: Literal["active", "candidate", "failed", "superseded"] = "active"
) -> KnowledgeFSDocumentRevisionResponse:
    return KnowledgeFSDocumentRevisionResponse(
        activated_at=datetime.now(UTC) if state == "active" else None,
        content_hash="a" * 64,
        created_at=datetime.now(UTC),
        document_asset_id="asset-1",
        document_asset_version=2,
        document_id="logical-1",
        knowledge_space_id="space-1",
        mime_type="text/markdown",
        revision=3,
        size_bytes=4,
        state=state,
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


class FakeDownloadFacade(KnowledgeFSDataFacade):
    """Serves canned facade reads and records the calls download preparation makes."""

    def __init__(
        self,
        *,
        logical: KnowledgeFSLogicalDocumentResponse,
        revisions: KnowledgeFSDocumentRevisionListResponse | None = None,
        document: KnowledgeFSDocumentResponse | None = None,
    ) -> None:
        self._logical = logical
        self._revisions = revisions
        self._document = document
        self.get_logical_document_calls: list[dict[str, object]] = []
        self.list_document_revisions_calls: list[dict[str, object]] = []
        self.get_document_calls: list[dict[str, object]] = []

    @override
    def get_logical_document(
        self, *, tenant_id: str, account_id: str, control_space_id: str, document_id: str
    ) -> KnowledgeFSLogicalDocumentResponse:
        self.get_logical_document_calls.append(
            {
                "tenant_id": tenant_id,
                "account_id": account_id,
                "control_space_id": control_space_id,
                "document_id": document_id,
            }
        )
        return self._logical

    @override
    def list_document_revisions(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        document_id: str,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> KnowledgeFSDocumentRevisionListResponse:
        self.list_document_revisions_calls.append(
            {
                "tenant_id": tenant_id,
                "account_id": account_id,
                "control_space_id": control_space_id,
                "document_id": document_id,
                "cursor": cursor,
                "limit": limit,
            }
        )
        assert self._revisions is not None
        return self._revisions

    @override
    def get_document(
        self, *, tenant_id: str, account_id: str, control_space_id: str, document_id: str
    ) -> KnowledgeFSDocumentResponse:
        self.get_document_calls.append(
            {
                "tenant_id": tenant_id,
                "account_id": account_id,
                "control_space_id": control_space_id,
                "document_id": document_id,
            }
        )
        assert self._document is not None
        return self._document


def test_prepare_logical_document_download_resolves_active_asset() -> None:
    facade = FakeDownloadFacade(logical=logical_document(active=revision()), document=asset())

    result = facade.prepare_logical_document_download(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        document_id="logical-1",
    )

    assert result.document_id == "logical-1"
    assert result.object_key == "tenant/spaces/space-1/documents/page.md"
    assert facade.list_document_revisions_calls == []
    assert facade.get_document_calls == [
        {
            "tenant_id": "tenant-1",
            "account_id": "account-1",
            "control_space_id": "control-1",
            "document_id": "asset-1",
        }
    ]


def test_prepare_logical_document_download_resolves_latest_failed_revision_without_active_revision() -> None:
    facade = FakeDownloadFacade(
        logical=logical_document(active=None, status="failed"),
        revisions=KnowledgeFSDocumentRevisionListResponse(data=[revision(state="failed")]),
        document=asset(),
    )

    result = facade.prepare_logical_document_download(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        document_id="logical-1",
    )

    assert result.document_id == "logical-1"
    assert result.object_key == "tenant/spaces/space-1/documents/page.md"
    assert facade.list_document_revisions_calls == [
        {
            "tenant_id": "tenant-1",
            "account_id": "account-1",
            "control_space_id": "control-1",
            "document_id": "logical-1",
            "cursor": None,
            "limit": 1,
        }
    ]


def test_prepare_logical_document_download_rejects_document_without_visible_revision() -> None:
    facade = FakeDownloadFacade(
        logical=logical_document(active=None, status="failed"),
        revisions=KnowledgeFSDocumentRevisionListResponse(data=[]),
    )

    with pytest.raises(KnowledgeFSProductResourceNotFoundError):
        facade.prepare_logical_document_download(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            document_id="logical-1",
        )


def test_prepare_logical_document_download_rejects_latest_candidate_revision() -> None:
    facade = FakeDownloadFacade(
        logical=logical_document(active=None, status="failed"),
        revisions=KnowledgeFSDocumentRevisionListResponse(data=[revision(state="candidate")]),
    )

    with pytest.raises(KnowledgeFSProductResourceNotFoundError):
        facade.prepare_logical_document_download(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            document_id="logical-1",
        )

    assert facade.get_document_calls == []


def test_prepare_logical_document_download_rejects_pending_document_without_active_revision() -> None:
    facade = FakeDownloadFacade(logical=logical_document(active=None, status="pending"))

    with pytest.raises(KnowledgeFSProductResourceNotFoundError):
        facade.prepare_logical_document_download(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            document_id="logical-1",
        )

    assert facade.list_document_revisions_calls == []
    assert facade.get_document_calls == []
