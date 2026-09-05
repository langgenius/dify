from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from inspect import unwrap
from typing import TYPE_CHECKING, cast
from uuid import UUID

import pytest
from flask import Flask
from flask.testing import FlaskClient
from flask_restx import Api

from controllers.common.errors import NotFoundError
from controllers.console import console_ns
from controllers.console.app.error import ProviderNotInitializeError

# Importing the module registers only the resources under test on console_ns.
from controllers.console.datasets import data_source as data_source_controller
from controllers.console.datasets.error import IndexingEstimateError
from core.entities.knowledge_entities import IndexingEstimate
from core.rag.extractor.entity.datasource_type import NotionPageType
from core.rbac import RBACPermission, RBACResourceScope
from enums import DeploymentEdition
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from services.data_source.binding_application_service import (
    BindingMutationResult,
    DataSourceBindingApplicationService,
)
from services.data_source.notion_import_application_service import NotionImportApplicationService
from services.entities.data_source.notion_import import (
    AuthorizedNotionPage,
    NotionPageIcon,
    NotionWorkspace,
)
from services.entities.data_source.oauth import DataSourceBindingSummary
from services.entities.knowledge_entities.indexing_estimate import (
    NewSourcesEstimateCommand,
    NotionEstimateSource,
)
from services.knowledge.dataset_access import DatasetAccessRecord, DatasetAccessService, DatasetAccessSnapshot
from services.knowledge.document_sync import DocumentSyncApplicationService, SyncDocumentRecord
from services.knowledge.indexing.estimate import (
    DatasetEstimateRecord,
    EstimateDocumentRecord,
    EstimateSourceNotFoundError,
    IndexingEstimateCredentialUnavailableError,
    IndexingEstimateExecutionError,
    IndexingEstimateProviderUnavailableError,
)
from services.knowledge.resource_scope import DatasetRef, DocumentRef

if TYPE_CHECKING:
    from models import Account

TENANT_ID = "11111111-1111-1111-1111-111111111111"
ACCOUNT_ID = "22222222-2222-2222-2222-222222222222"
BINDING_ID = "33333333-3333-3333-3333-333333333333"
DATASET_ID = "44444444-4444-4444-4444-444444444444"
DOCUMENT_ID = "55555555-5555-5555-5555-555555555555"
PAGE_ID = "66666666-6666-6666-6666-666666666666"
FOREIGN_DATASET_ID = "77777777-7777-7777-7777-777777777777"


@dataclass
class RecordingBindingStore:
    bindings: tuple[DataSourceBindingSummary, ...] = ()
    mutations: list[tuple[str, str, bool]] = field(default_factory=list)
    mutation_result: BindingMutationResult = "updated"

    def list_enabled_bindings(self, *, workspace_id: str) -> tuple[DataSourceBindingSummary, ...]:
        assert workspace_id == TENANT_ID
        return self.bindings

    def change_disabled_state(
        self,
        *,
        workspace_id: str,
        binding_id: str,
        disabled: bool,
    ) -> BindingMutationResult:
        self.mutations.append((workspace_id, binding_id, disabled))
        return self.mutation_result


@dataclass
class DatasetCatalog:
    record: DatasetAccessRecord

    def get_access_snapshot(
        self,
        *,
        workspace_id: str,
        dataset_id: str,
        actor_id: str,
    ) -> DatasetAccessSnapshot | None:
        assert actor_id == ACCOUNT_ID
        if workspace_id != self.record.workspace_id or dataset_id != self.record.id:
            return None
        return DatasetAccessSnapshot(dataset=self.record, actor_has_partial_access=False)

    def get_estimate_record(self, dataset_ref: DatasetRef) -> DatasetEstimateRecord | None:
        if dataset_ref != DatasetRef(self.record.workspace_id, self.record.id):
            return None
        return DatasetEstimateRecord(
            id=self.record.id,
            workspace_id=self.record.workspace_id,
            indexing_technique="economy",
        )

    def is_notion_dataset(self, dataset_ref: DatasetRef) -> bool:
        return dataset_ref == DatasetRef(self.record.workspace_id, self.record.id)


class OwnerWorkspaceRoles:
    def get_legacy_role(self, *, workspace_id: str, account_id: str) -> str | None:
        assert workspace_id == TENANT_ID
        assert account_id == ACCOUNT_ID
        return "owner"


@dataclass
class KnowledgeDocuments:
    bound_page_ids: frozenset[str] = frozenset()
    active_refs: tuple[DocumentRef, ...] = ()

    def list_bound_notion_page_ids(self, dataset_ref: DatasetRef) -> frozenset[str]:
        assert dataset_ref == DatasetRef(TENANT_ID, DATASET_ID)
        return self.bound_page_ids

    def list_active_notion_refs(self, dataset_ref: DatasetRef) -> tuple[DocumentRef, ...]:
        assert dataset_ref == DatasetRef(TENANT_ID, DATASET_ID)
        return self.active_refs

    def get_estimate_document(self, document_ref: DocumentRef) -> EstimateDocumentRecord | None:
        if document_ref.document_id != DOCUMENT_ID:
            return None
        return EstimateDocumentRecord(
            id=DOCUMENT_ID,
            workspace_id=TENANT_ID,
            dataset_id=DATASET_ID,
            data_source_type="notion_import",
            data_source_info=None,
            indexing_status="waiting",
            doc_form="text_model",
            doc_language="English",
            dataset_process_rule_id=None,
        )

    def list_estimate_documents_by_batch(
        self, dataset_ref: DatasetRef, batch: str
    ) -> tuple[EstimateDocumentRecord, ...]:
        document = self.get_estimate_document(dataset_ref.document(DOCUMENT_ID))
        if document is None or batch != "batch":
            return ()
        return (document,)

    def get_sync_document(self, document_ref: DocumentRef) -> SyncDocumentRecord | None:
        if document_ref.document_id != DOCUMENT_ID:
            return None
        return SyncDocumentRecord(id=DOCUMENT_ID, data_source_type="notion_import")


@dataclass
class RecordingNotionSource:
    workspaces: tuple[NotionWorkspace, ...]
    list_calls: list[tuple[str, str, str]] = field(default_factory=list)
    preview_calls: list[tuple[str, str, str, str, str]] = field(default_factory=list)

    def list_authorized_pages(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
    ) -> tuple[NotionWorkspace, ...]:
        self.list_calls.append((workspace_id, actor_id, credential_id))
        return self.workspaces

    def preview_page(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        page_id: str,
        page_type: str,
    ) -> str:
        self.preview_calls.append((workspace_id, actor_id, credential_id, page_id, page_type))
        return "preview text"


@dataclass
class RecordingEstimateService:
    calls: list[tuple[RequestContext, NewSourcesEstimateCommand]] = field(default_factory=list)
    error: Exception | None = None

    def estimate_new_sources(self, context: RequestContext, command: NewSourcesEstimateCommand) -> IndexingEstimate:
        self.calls.append((context, command))
        if self.error is not None:
            raise self.error
        return IndexingEstimate(total_segments=3, preview=[])


@dataclass
class RecordingDispatcher:
    calls: list[tuple[str, str]] = field(default_factory=list)

    def dispatch(self, *, dataset_id: str, document_id: str) -> None:
        self.calls.append((dataset_id, document_id))


@dataclass(frozen=True)
class DataSourceApplicationServices:
    bindings: DataSourceBindingApplicationService
    notion_imports: NotionImportApplicationService


@dataclass(frozen=True)
class KnowledgeApplicationServices:
    document_sync: DocumentSyncApplicationService
    indexing_estimates: RecordingEstimateService


@dataclass(frozen=True)
class ApplicationServiceRegistry:
    data_sources: DataSourceApplicationServices
    knowledge: KnowledgeApplicationServices


@dataclass(frozen=True)
class ControllerCollaborators:
    client: FlaskClient
    account: AdmittedAccount
    bindings: RecordingBindingStore
    notion_source: RecordingNotionSource
    estimates: RecordingEstimateService
    dispatcher: RecordingDispatcher


@dataclass
class AdmittedAccount:
    id: str
    role: str
    status: str


@pytest.fixture
def collaborators(
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> ControllerCollaborators:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        LOGIN_DISABLED=True,
        RBAC_ENABLED=False,
        CONSOLE_API_URL="https://console-api.example.com",
    )
    app = Flask(__name__)
    app.config.update(TESTING=False, PROPAGATE_EXCEPTIONS=False)
    Api(app).add_namespace(console_ns, path="/console/api")

    account = AdmittedAccount(id=ACCOUNT_ID, role="owner", status="active")
    account_with_tenant = AccountWithTenant(account=cast("Account", account), tenant_id=TENANT_ID)
    monkeypatch.setattr(
        "controllers.console.flask_admission.current_account_with_tenant",
        lambda: account_with_tenant,
    )
    monkeypatch.setattr(
        "controllers.console.wraps.current_account_with_tenant",
        lambda: account_with_tenant,
    )

    dataset = DatasetAccessRecord(
        id=DATASET_ID,
        workspace_id=TENANT_ID,
        maintainer_id=ACCOUNT_ID,
        permission="only_me",
    )
    dataset_catalog = DatasetCatalog(dataset)
    dataset_access = DatasetAccessService(
        datasets=dataset_catalog,
        workspace_roles=OwnerWorkspaceRoles(),
        legacy_permissions_enabled=True,
    )
    documents = KnowledgeDocuments(
        bound_page_ids=frozenset({PAGE_ID}),
        active_refs=(DatasetRef(TENANT_ID, DATASET_ID).document(DOCUMENT_ID),),
    )
    bindings = RecordingBindingStore()
    notion_source = RecordingNotionSource(
        workspaces=(
            NotionWorkspace(
                workspace_id="notion-workspace-1",
                workspace_name="One",
                workspace_icon=None,
                pages=(
                    AuthorizedNotionPage(
                        page_id=PAGE_ID,
                        page_name="Page one",
                        page_icon=NotionPageIcon(type="emoji", emoji="📄"),
                        parent_id=None,
                        page_type=NotionPageType.PAGE,
                    ),
                ),
            ),
            NotionWorkspace(
                workspace_id="notion-workspace-2",
                workspace_name="Two",
                workspace_icon=None,
                pages=(),
            ),
        )
    )
    estimates = RecordingEstimateService()
    dispatcher = RecordingDispatcher()
    app.extensions["application_services"] = ApplicationServiceRegistry(
        data_sources=DataSourceApplicationServices(
            bindings=DataSourceBindingApplicationService(bindings=bindings),
            notion_imports=NotionImportApplicationService(
                dataset_access=dataset_access,
                datasets=dataset_catalog,
                documents=documents,
                source=notion_source,
            ),
        ),
        knowledge=KnowledgeApplicationServices(
            document_sync=DocumentSyncApplicationService(
                dataset_access=dataset_access,
                documents=documents,
                dispatcher=dispatcher,
            ),
            indexing_estimates=estimates,
        ),
    )
    return ControllerCollaborators(
        client=app.test_client(),
        account=account,
        bindings=bindings,
        notion_source=notion_source,
        estimates=estimates,
        dispatcher=dispatcher,
    )


def test_integration_collection_only_exposes_get(collaborators: ControllerCollaborators) -> None:
    client = collaborators.client
    assert client.get("/console/api/data-source/integrates").status_code == 200
    assert client.patch("/console/api/data-source/integrates").status_code == 405


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/console/api/data-source/integrates"),
        ("patch", f"/console/api/data-source/integrates/{BINDING_ID}/enable"),
    ],
)
def test_integration_management_rejects_non_admin_role(
    collaborators: ControllerCollaborators,
    method: str,
    path: str,
) -> None:
    collaborators.account.role = "editor"

    assert collaborators.client.open(path, method=method.upper()).status_code == 403


def test_integration_management_enforces_workspace_credential_permission(
    collaborators: ControllerCollaborators,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_overrides(RBAC_ENABLED=True)
    calls: list[dict[str, object]] = []

    def record_access(**requirement: object) -> None:
        calls.append(requirement)

    monkeypatch.setattr("controllers.console.flask_admission.enforce_rbac_access", record_access)

    list_response = collaborators.client.get("/console/api/data-source/integrates")
    mutation_response = collaborators.client.patch(f"/console/api/data-source/integrates/{BINDING_ID}/enable")

    assert list_response.status_code == 200
    assert mutation_response.status_code == 200
    assert calls == [
        {
            "tenant_id": TENANT_ID,
            "account_id": ACCOUNT_ID,
            "resource_type": RBACResourceScope.WORKSPACE,
            "scene": RBACPermission.CREDENTIAL_MANAGE,
            "resource_required": False,
            "path_args": {},
        },
        {
            "tenant_id": TENANT_ID,
            "account_id": ACCOUNT_ID,
            "resource_type": RBACResourceScope.WORKSPACE,
            "scene": RBACPermission.CREDENTIAL_MANAGE,
            "resource_required": False,
            "path_args": {
                "binding_id": UUID(BINDING_ID),
                "action": "enable",
            },
        },
    ]


def test_integration_item_only_exposes_patch_and_rejects_unknown_action(
    collaborators: ControllerCollaborators,
) -> None:
    client = collaborators.client
    item_path = f"/console/api/data-source/integrates/{BINDING_ID}/enable"
    assert client.get(item_path).status_code == 405
    assert client.patch(item_path).status_code == 200
    assert collaborators.bindings.mutations == [(TENANT_ID, BINDING_ID, False)]
    invalid = client.patch(f"/console/api/data-source/integrates/{BINDING_ID}/remove")
    assert invalid.status_code == 400
    assert invalid.get_json()["code"] == "invalid_action"
    assert len(collaborators.bindings.mutations) == 1


def test_integration_list_serializes_application_result_and_http_link(
    collaborators: ControllerCollaborators,
) -> None:
    collaborators.bindings.bindings = (
        DataSourceBindingSummary(
            id=BINDING_ID,
            provider="notion",
            created_at=datetime(2026, 5, 25, 1, 2, 3, tzinfo=UTC),
            disabled=False,
            source_info={
                "workspace_name": "Workspace",
                "workspace_id": "workspace-1",
                "workspace_icon": None,
                "pages": [],
                "total": 0,
            },
        ),
    )

    response = collaborators.client.get("/console/api/data-source/integrates")

    assert response.status_code == 200
    assert response.get_json()["data"][0] == {
        "id": BINDING_ID,
        "provider": "notion",
        "created_at": 1779670923,
        "is_bound": True,
        "disabled": False,
        "source_info": {
            "workspace_name": "Workspace",
            "workspace_id": "workspace-1",
            "workspace_icon": None,
            "pages": [],
            "total": 0,
        },
        "link": "https://console-api.example.com/console/api/oauth/data-source/notion",
    }


def test_notion_list_preserves_workspace_groups_and_bound_state(collaborators: ControllerCollaborators) -> None:
    response = collaborators.client.get(
        "/console/api/notion/pre-import/pages",
        query_string={"credential_id": "credential-1", "dataset_id": DATASET_ID},
    )

    assert response.status_code == 200
    payload = response.get_json()["notion_info"]
    assert [workspace["workspace_id"] for workspace in payload] == [
        "notion-workspace-1",
        "notion-workspace-2",
    ]
    assert payload[0]["pages"][0]["is_bound"] is True
    assert payload[0]["pages"][0]["type"] == "page"
    assert "page_type" not in payload[0]["pages"][0]
    assert collaborators.notion_source.list_calls == [(TENANT_ID, ACCOUNT_ID, "credential-1")]


def test_notion_preview_validates_page_type_and_delegates(collaborators: ControllerCollaborators) -> None:
    response = collaborators.client.get(
        f"/console/api/notion/pages/{PAGE_ID}/page/preview",
        query_string={"credential_id": "credential-1"},
    )
    invalid = collaborators.client.get(
        f"/console/api/notion/pages/{PAGE_ID}/collection/preview",
        query_string={"credential_id": "credential-1"},
    )

    assert response.status_code == 200
    assert response.get_json() == {"content": "preview text"}
    assert invalid.status_code == 400
    assert collaborators.notion_source.preview_calls == [(TENANT_ID, ACCOUNT_ID, "credential-1", PAGE_ID, "page")]


def test_notion_estimate_maps_nested_payload_to_shared_command(collaborators: ControllerCollaborators) -> None:
    response = collaborators.client.post(
        "/console/api/datasets/notion-indexing-estimate",
        json={
            "notion_info_list": [
                {
                    "workspace_id": "notion-workspace-1",
                    "credential_id": "credential-1",
                    "pages": [{"page_id": PAGE_ID, "type": "page"}],
                }
            ],
            "process_rule": {"mode": "automatic"},
            "doc_form": "text_model",
            "doc_language": "English",
        },
    )

    assert response.status_code == 200
    assert response.get_json()["total_segments"] == 3
    context, command = collaborators.estimates.calls[0]
    assert context.active_workspace_id == TENANT_ID
    assert context.account_id == ACCOUNT_ID
    assert command.process_rule == {"mode": "automatic"}
    source = command.sources[0]
    assert isinstance(source, NotionEstimateSource)
    assert source.credential_id == "credential-1"
    assert source.page_id == PAGE_ID


@pytest.mark.parametrize(
    ("error", "expected_http_error"),
    [
        (IndexingEstimateCredentialUnavailableError(), NotFoundError),
        (EstimateSourceNotFoundError("page-1"), NotFoundError),
        (IndexingEstimateProviderUnavailableError(), ProviderNotInitializeError),
        (IndexingEstimateExecutionError(), IndexingEstimateError),
    ],
)
def test_notion_estimate_maps_application_errors(
    error: Exception,
    expected_http_error: type[Exception],
    collaborators: ControllerCollaborators,
) -> None:
    collaborators.estimates.error = error
    api = data_source_controller.DataSourceNotionIndexingEstimateApi()
    method = unwrap(api.post)
    payload = data_source_controller.NotionEstimatePayload.model_validate(
        {
            "notion_info_list": [
                {
                    "workspace_id": "notion-workspace",
                    "credential_id": "credential-1",
                    "pages": [{"page_id": "page-1", "type": "page"}],
                }
            ],
            "process_rule": {"mode": "automatic"},
        }
    )
    context = RequestContext("request-1", None, "account-1", "workspace-1")

    with collaborators.client.application.app_context(), pytest.raises(expected_http_error):
        method(api, payload, context)


def test_sync_routes_dispatch_only_application_selected_documents(collaborators: ControllerCollaborators) -> None:
    dataset_response = collaborators.client.get(f"/console/api/datasets/{DATASET_ID}/notion/sync")
    document_response = collaborators.client.get(
        f"/console/api/datasets/{DATASET_ID}/documents/{DOCUMENT_ID}/notion/sync"
    )

    assert dataset_response.status_code == 200
    assert document_response.status_code == 200
    assert collaborators.dispatcher.calls == [(DATASET_ID, DOCUMENT_ID), (DATASET_ID, DOCUMENT_ID)]


def test_sync_route_does_not_dispatch_cross_workspace_dataset(collaborators: ControllerCollaborators) -> None:
    response = collaborators.client.get(f"/console/api/datasets/{FOREIGN_DATASET_ID}/notion/sync")

    assert response.status_code == 404
    assert response.get_json()["code"] == "not_found"
    assert collaborators.dispatcher.calls == []
