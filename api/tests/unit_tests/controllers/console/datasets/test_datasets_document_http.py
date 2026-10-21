"""HTTP contract tests for Console document endpoints."""

from collections.abc import Callable
from dataclasses import dataclass, field
from importlib import import_module
from typing import cast
from uuid import uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from flask_restx import Api

from controllers.console import api as console_api
from controllers.console import console_ns
from enums import DeploymentEdition
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account, TenantAccountRole
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess
from services.knowledge.documents.application import (
    DatasetCreatorAccess,
    DatasetDocumentApplicationService,
    DocumentArchivedError,
    DocumentDatasetRepository,
    DocumentInvalidActionError,
    DocumentLifecycleCache,
    DocumentModelConfigurationGateway,
    DocumentOperations,
    DocumentRepository,
    DocumentUploads,
)
from services.knowledge.documents.contracts import (
    DocumentCreationGateway,
    DocumentPersistenceError,
    DocumentPersistenceInvalidStateError,
    DocumentPersistenceNotFoundError,
    DocumentState,
)
from services.knowledge.indexing.locks import KnowledgeIndexingLock
from services.knowledge.resource_scope import DatasetRef, DocumentRef


@dataclass
class DocumentErrorService:
    calls: list[tuple[RequestContext, str, str]] = field(default_factory=list)
    retry_calls: list[tuple[RequestContext, str, list[str]]] = field(default_factory=list)
    sync_calls: list[tuple[RequestContext, str, str]] = field(default_factory=list)

    def delete_document(self, context: RequestContext, *, dataset_id: str, document_id: str) -> None:
        self.calls.append((context, dataset_id, document_id))
        raise DocumentArchivedError()

    def sync_website(self, context: RequestContext, *, dataset_id: str, document_id: str) -> None:
        self.sync_calls.append((context, dataset_id, document_id))
        raise DocumentInvalidActionError("Document is being synced, please try again later.")

    def retry_documents(self, context: RequestContext, *, dataset_id: str, document_ids: list[str]) -> None:
        self.retry_calls.append((context, dataset_id, document_ids))
        raise DocumentInvalidActionError("Document is being retried, please try again later.")


@dataclass
class FailingWebsiteDocumentRepository:
    error: DocumentPersistenceError | None = None
    calls: list[tuple[DocumentRef, str]] = field(default_factory=list)

    def get_state(self, ref: DocumentRef) -> DocumentState:
        return DocumentState(ref.document_id, False, "completed", False, "website_crawl", "text_model", False)

    def sync_website(self, ref: DocumentRef, *, generation: str) -> None:
        self.calls.append((ref, generation))
        if self.error is None:
            raise AssertionError("A persistence failure must be configured before the request.")
        raise self.error


@dataclass
class RecordingLifecycleCache:
    marked: list[tuple[str, str]] = field(default_factory=list)
    cleared: list[tuple[str, str]] = field(default_factory=list)

    def try_mark_syncing(self, document_id: str, *, token: str) -> bool:
        self.marked.append((document_id, token))
        return True

    def clear_syncing(self, document_id: str, *, token: str) -> None:
        self.cleared.append((document_id, token))


class StaticDatasetAccess:
    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset:
        return AccessibleDataset(dataset_id, context.active_workspace_id)


class UnusedDependency:
    """Constructor dependency outside the website-sync use case under test."""


@dataclass(frozen=True)
class KnowledgeServices:
    documents: DocumentErrorService | DatasetDocumentApplicationService


@dataclass(frozen=True)
class ApplicationServices:
    knowledge: KnowledgeServices


def _document_client(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    documents: DocumentErrorService | DatasetDocumentApplicationService,
) -> FlaskClient:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, LOGIN_DISABLED=True, RBAC_ENABLED=False)
    app = Flask(__name__)
    app.config.update(TESTING=False, PROPAGATE_EXCEPTIONS=False)
    api = Api(app)
    api.error_handlers = console_api.error_handlers.copy()
    api.add_namespace(console_ns, path="/console/api")

    account = Account(name="Owner", email="document-owner@example.com")
    account.id = "account-1"
    account.role = TenantAccountRole.OWNER
    identity = AccountWithTenant(account=account, tenant_id="tenant-1")
    monkeypatch.setattr("controllers.console.flask_admission.current_account_with_tenant", lambda: identity)
    monkeypatch.setattr("controllers.console.wraps.current_account_with_tenant", lambda: identity)
    monkeypatch.setattr("controllers.console.wraps.check_knowledge_rate_limit", lambda: None)
    datasets_document_controller = import_module("controllers.console.datasets.datasets_document")
    monkeypatch.setattr(datasets_document_controller, "check_knowledge_rate_limit", lambda: None)

    app.extensions["application_services"] = ApplicationServices(KnowledgeServices(documents))
    return app.test_client()


@pytest.fixture
def document_error_route(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> tuple[FlaskClient, DocumentErrorService]:
    documents = DocumentErrorService()
    return _document_client(monkeypatch, config_overrides, documents), documents


@pytest.fixture
def document_application_route(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> tuple[FlaskClient, FailingWebsiteDocumentRepository, RecordingLifecycleCache]:
    repository = FailingWebsiteDocumentRepository()
    lifecycle_cache = RecordingLifecycleCache()
    unused = UnusedDependency()
    service = DatasetDocumentApplicationService(
        dataset_access=cast(DatasetAccess, StaticDatasetAccess()),
        datasets=cast(DocumentDatasetRepository, unused),
        documents=cast(DocumentRepository, repository),
        operations=cast(DocumentOperations, unused),
        uploads=cast(DocumentUploads, unused),
        indexing_locks=cast(KnowledgeIndexingLock, unused),
        lifecycle_cache=cast(DocumentLifecycleCache, lifecycle_cache),
        model_configuration=cast(DocumentModelConfigurationGateway, unused),
        creation=cast(DocumentCreationGateway, unused),
        creator_access=cast(DatasetCreatorAccess, unused),
    )
    return _document_client(monkeypatch, config_overrides, service), repository, lifecycle_cache


def test_delete_archived_document_returns_domain_403(
    document_error_route: tuple[FlaskClient, DocumentErrorService],
) -> None:
    client, documents = document_error_route
    dataset_id = str(uuid4())
    document_id = str(uuid4())

    response = client.delete(f"/console/api/datasets/{dataset_id}/documents/{document_id}")

    assert response.status_code == 403
    assert response.get_json() == {
        "code": "archived_document_immutable",
        "message": "The archived document is not editable.",
        "status": 403,
    }
    [(context, called_dataset_id, called_document_id)] = documents.calls
    assert context.account_id == "account-1"
    assert context.active_workspace_id == "tenant-1"
    assert called_dataset_id == dataset_id
    assert called_document_id == document_id


def test_busy_website_sync_returns_documented_invalid_action(
    document_error_route: tuple[FlaskClient, DocumentErrorService],
) -> None:
    client, documents = document_error_route
    dataset_id = str(uuid4())
    document_id = str(uuid4())

    response = client.get(f"/console/api/datasets/{dataset_id}/documents/{document_id}/website-sync")

    assert response.status_code == 400
    assert response.get_json() == {
        "code": "invalid_action",
        "message": "Document is being synced, please try again later.",
        "status": 400,
    }
    [(context, called_dataset_id, called_document_id)] = documents.sync_calls
    assert context.account_id == "account-1"
    assert context.active_workspace_id == "tenant-1"
    assert called_dataset_id == dataset_id
    assert called_document_id == document_id


@pytest.mark.parametrize(
    ("repository_error", "expected_status", "expected_body"),
    [
        (
            DocumentPersistenceNotFoundError("Document not found."),
            404,
            {"code": "not_found", "message": "Document not found.", "status": 404},
        ),
        (
            DocumentPersistenceInvalidStateError("Document is not a website document."),
            400,
            {
                "code": "invalid_action",
                "message": "Document is not a website document.",
                "status": 400,
            },
        ),
    ],
)
def test_website_sync_maps_locked_repository_failures_and_clears_its_marker(
    document_application_route: tuple[FlaskClient, FailingWebsiteDocumentRepository, RecordingLifecycleCache],
    repository_error: DocumentPersistenceError,
    expected_status: int,
    expected_body: dict[str, object],
) -> None:
    client, repository, lifecycle_cache = document_application_route
    repository.error = repository_error
    dataset_id = str(uuid4())
    document_id = str(uuid4())

    response = client.get(f"/console/api/datasets/{dataset_id}/documents/{document_id}/website-sync")

    assert response.status_code == expected_status
    assert response.get_json() == expected_body
    [(ref, generation)] = repository.calls
    assert ref == DatasetRef("tenant-1", dataset_id).document(document_id)
    assert lifecycle_cache.marked == [(document_id, generation)]
    assert lifecycle_cache.cleared == [(document_id, generation)]


def test_busy_document_retry_returns_documented_invalid_action(
    document_error_route: tuple[FlaskClient, DocumentErrorService],
) -> None:
    client, documents = document_error_route
    dataset_id = str(uuid4())
    document_id = str(uuid4())

    response = client.post(
        f"/console/api/datasets/{dataset_id}/retry",
        json={"document_ids": [document_id]},
    )

    assert response.status_code == 400
    assert response.get_json() == {
        "code": "invalid_action",
        "message": "Document is being retried, please try again later.",
        "status": 400,
    }
    [(context, called_dataset_id, called_document_ids)] = documents.retry_calls
    assert context.account_id == "account-1"
    assert context.active_workspace_id == "tenant-1"
    assert called_dataset_id == dataset_id
    assert called_document_ids == [document_id]
