"""HTTP and persistence contracts for console datasource endpoints."""

from __future__ import annotations

import json
from collections.abc import Generator
from dataclasses import dataclass, field
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from controllers.console.datasets import data_source
from core.datasource.datasource_manager import DatasourceManager
from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
    OnlineDocumentInfo,
    OnlineDocumentPage,
    OnlineDocumentPagesMessage,
)
from core.entities.knowledge_entities import IndexingEstimate, PreviewDetail
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.models.document import Document as RagDocument
from models import DataSourceOauthBinding
from models.dataset import Dataset, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from services.datasource_provider_service import DatasourceProviderService
from tests.test_containers_integration_tests.controllers.console.helpers import (
    AuthenticatedConsoleClient,
    ConsoleAccountFactory,
)
from tests.test_containers_integration_tests.helpers import DatabaseState


@dataclass
class _RuntimeState:
    credentials: dict[str, object] = field(default_factory=dict)


class _OnlineDocumentRuntime:
    def __init__(self, messages: list[OnlineDocumentPagesMessage]) -> None:
        self.runtime = _RuntimeState()
        self._messages = messages

    def datasource_provider_type(self) -> DatasourceProviderType:
        return DatasourceProviderType.ONLINE_DOCUMENT

    def get_online_document_pages(self, **_: object) -> Generator[OnlineDocumentPagesMessage, None, None]:
        yield from self._messages


@dataclass
class _TaskRecorder:
    calls: list[tuple[str, str]] = field(default_factory=list)

    def delay(self, dataset_id: str, document_id: str) -> None:
        self.calls.append((dataset_id, document_id))


def _set_credentials(monkeypatch: pytest.MonkeyPatch, credentials: dict[str, object] | None) -> None:
    monkeypatch.setattr(
        DatasourceProviderService,
        "get_datasource_credentials",
        lambda _self, **_kwargs: credentials,
    )


def _set_online_document_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    message = OnlineDocumentPagesMessage(
        result=[
            OnlineDocumentInfo(
                workspace_id="workspace-1",
                workspace_name="Workspace",
                workspace_icon="workspace-icon",
                total=1,
                pages=[
                    OnlineDocumentPage(
                        page_id="page-1",
                        page_name="Page One",
                        page_icon=None,
                        type="page",
                        last_edited_time="2026-01-01T00:00:00Z",
                        parent_id="parent-1",
                    )
                ],
            )
        ]
    )
    runtime = _OnlineDocumentRuntime([message])
    monkeypatch.setattr(DatasourceManager, "get_datasource_runtime", lambda **_kwargs: runtime)


def _create_binding(
    session: Session,
    *,
    tenant_id: str,
    disabled: bool = False,
) -> DataSourceOauthBinding:
    binding = DataSourceOauthBinding(
        tenant_id=tenant_id,
        access_token="token",
        provider="notion",
        source_info={
            "workspace_name": "Workspace",
            "workspace_id": "workspace-1",
            "workspace_icon": None,
            "total": 1,
            "pages": [
                {
                    "page_id": "page-1",
                    "page_name": "Page",
                    "page_icon": {"type": "emoji", "emoji": "P", "url": None},
                    "parent_id": "parent-1",
                    "type": "page",
                }
            ],
        },
        disabled=disabled,
    )
    session.add(binding)
    session.commit()
    return binding


def _create_dataset(
    session: Session,
    client: AuthenticatedConsoleClient,
    *,
    data_source_type: DataSourceType = DataSourceType.NOTION_IMPORT,
) -> Dataset:
    dataset = Dataset(
        tenant_id=client.tenant.id,
        name=f"Datasource Dataset {uuid4()}",
        description="Datasource controller integration dataset",
        data_source_type=data_source_type,
        indexing_technique=IndexTechniqueType.ECONOMY,
        created_by=client.account.id,
        permission="only_me",
        provider="vendor",
    )
    session.add(dataset)
    session.commit()
    return dataset


def _create_document(
    session: Session,
    client: AuthenticatedConsoleClient,
    dataset: Dataset,
    *,
    enabled: bool = True,
) -> Document:
    document = Document(
        tenant_id=client.tenant.id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.NOTION_IMPORT,
        data_source_info=json.dumps({"notion_page_id": "page-1"}),
        batch=f"batch-{uuid4()}",
        name="Notion Page",
        created_from=DocumentCreatedFrom.WEB,
        created_by=client.account.id,
        indexing_status=IndexingStatus.COMPLETED,
        enabled=enabled,
        archived=False,
    )
    session.add(document)
    session.commit()
    return document


class TestDataSourceApi:
    def test_get_returns_persisted_binding_contract(
        self,
        authenticated_console_client: AuthenticatedConsoleClient,
        console_account_factory: ConsoleAccountFactory,
        transactional_db_session: Session,
    ) -> None:
        binding = _create_binding(transactional_db_session, tenant_id=authenticated_console_client.tenant.id)
        _foreign_account, foreign_tenant = console_account_factory()
        _create_binding(transactional_db_session, tenant_id=foreign_tenant.id)
        binding_id = binding.id
        binding_created_at = int(binding.created_at.timestamp())

        response = authenticated_console_client.client.get(
            "/console/api/data-source/integrates",
            headers=authenticated_console_client.headers,
        )

        assert response.status_code == 200
        assert response.json == {
            "data": [
                {
                    "id": binding_id,
                    "provider": "notion",
                    "created_at": binding_created_at,
                    "is_bound": True,
                    "disabled": False,
                    "source_info": {
                        "workspace_name": "Workspace",
                        "workspace_id": "workspace-1",
                        "workspace_icon": None,
                        "pages": [
                            {
                                "page_name": "Page",
                                "page_id": "page-1",
                                "page_icon": {"type": "emoji", "url": None, "emoji": "P"},
                                "parent_id": "parent-1",
                                "type": "page",
                            }
                        ],
                        "total": 1,
                    },
                    "link": "http://localhost/console/api/oauth/data-source/notion",
                }
            ]
        }

    def test_get_without_bindings_returns_empty_collection(
        self,
        authenticated_console_client: AuthenticatedConsoleClient,
        console_account_factory: ConsoleAccountFactory,
        transactional_db_session: Session,
    ) -> None:
        _foreign_account, foreign_tenant = console_account_factory()
        _create_binding(transactional_db_session, tenant_id=foreign_tenant.id)

        response = authenticated_console_client.client.get(
            "/console/api/data-source/integrates",
            headers=authenticated_console_client.headers,
        )

        assert response.status_code == 200
        assert response.json == {"data": []}

    @pytest.mark.parametrize(("initially_disabled", "action"), [(True, "enable"), (False, "disable")])
    def test_patch_persists_binding_state_change(
        self,
        initially_disabled: bool,
        action: str,
        authenticated_console_client: AuthenticatedConsoleClient,
        transactional_db_session: Session,
        database_state: DatabaseState,
    ) -> None:
        binding = _create_binding(
            transactional_db_session,
            tenant_id=authenticated_console_client.tenant.id,
            disabled=initially_disabled,
        )

        response = authenticated_console_client.client.patch(
            f"/console/api/data-source/integrates/{binding.id}/{action}",
            headers=authenticated_console_client.headers,
        )

        assert response.status_code == 200
        assert response.json == {"result": "success"}
        persisted = database_state.one(DataSourceOauthBinding, DataSourceOauthBinding.id == binding.id)
        assert persisted.disabled is (not initially_disabled)

    @pytest.mark.parametrize(("disabled", "action"), [(False, "enable"), (True, "disable")])
    def test_patch_rejects_missing_foreign_and_noop_bindings(
        self,
        disabled: bool,
        action: str,
        authenticated_console_client: AuthenticatedConsoleClient,
        console_account_factory: ConsoleAccountFactory,
        transactional_db_session: Session,
        database_state: DatabaseState,
    ) -> None:
        _foreign_account, foreign_tenant = console_account_factory()
        foreign_binding = _create_binding(transactional_db_session, tenant_id=foreign_tenant.id, disabled=disabled)
        own_binding = _create_binding(
            transactional_db_session,
            tenant_id=authenticated_console_client.tenant.id,
            disabled=disabled,
        )

        foreign_response = authenticated_console_client.client.patch(
            f"/console/api/data-source/integrates/{foreign_binding.id}/{action}",
            headers=authenticated_console_client.headers,
        )
        noop_response = authenticated_console_client.client.patch(
            f"/console/api/data-source/integrates/{own_binding.id}/{action}",
            headers=authenticated_console_client.headers,
        )

        assert foreign_response.status_code == 404
        assert noop_response.status_code == 400
        persisted = database_state.one(DataSourceOauthBinding, DataSourceOauthBinding.id == own_binding.id)
        assert persisted.disabled is disabled


class TestDataSourceNotionListApi:
    def test_get_reports_bound_state_from_persisted_document(
        self,
        authenticated_console_client: AuthenticatedConsoleClient,
        transactional_db_session: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _set_credentials(monkeypatch, {"integration_secret": "secret"})
        _set_online_document_runtime(monkeypatch)

        unbound_response = authenticated_console_client.client.get(
            "/console/api/notion/pre-import/pages?credential_id=credential-1",
            headers=authenticated_console_client.headers,
        )
        dataset = _create_dataset(transactional_db_session, authenticated_console_client)
        _create_document(transactional_db_session, authenticated_console_client, dataset)
        bound_response = authenticated_console_client.client.get(
            f"/console/api/notion/pre-import/pages?credential_id=credential-1&dataset_id={dataset.id}",
            headers=authenticated_console_client.headers,
        )

        assert unbound_response.status_code == 200
        assert bound_response.status_code == 200
        assert unbound_response.json == {
            "notion_info": [
                {
                    "workspace_id": "workspace-1",
                    "workspace_name": "Workspace",
                    "workspace_icon": "workspace-icon",
                    "pages": [
                        {
                            "page_id": "page-1",
                            "page_name": "Page One",
                            "page_icon": None,
                            "type": "page",
                            "parent_id": "parent-1",
                            "is_bound": False,
                        }
                    ],
                }
            ]
        }
        assert bound_response.json == {
            "notion_info": [
                {
                    "workspace_id": "workspace-1",
                    "workspace_name": "Workspace",
                    "workspace_icon": "workspace-icon",
                    "pages": [
                        {
                            "page_id": "page-1",
                            "page_name": "Page One",
                            "page_icon": None,
                            "type": "page",
                            "parent_id": "parent-1",
                            "is_bound": True,
                        }
                    ],
                }
            ]
        }

    def test_get_rejects_missing_credentials_and_invalid_datasets(
        self,
        authenticated_console_client: AuthenticatedConsoleClient,
        console_account_factory: ConsoleAccountFactory,
        transactional_db_session: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _set_credentials(monkeypatch, None)
        missing_credential = authenticated_console_client.client.get(
            "/console/api/notion/pre-import/pages?credential_id=missing",
            headers=authenticated_console_client.headers,
        )

        _set_credentials(monkeypatch, {"integration_secret": "secret"})
        missing_dataset = authenticated_console_client.client.get(
            f"/console/api/notion/pre-import/pages?credential_id=credential-1&dataset_id={uuid4()}",
            headers=authenticated_console_client.headers,
        )
        wrong_type = _create_dataset(
            transactional_db_session,
            authenticated_console_client,
            data_source_type=DataSourceType.UPLOAD_FILE,
        )
        wrong_type_response = authenticated_console_client.client.get(
            f"/console/api/notion/pre-import/pages?credential_id=credential-1&dataset_id={wrong_type.id}",
            headers=authenticated_console_client.headers,
        )
        foreign_account, foreign_tenant = console_account_factory()
        foreign_client = AuthenticatedConsoleClient(
            client=authenticated_console_client.client,
            headers=authenticated_console_client.headers,
            account=foreign_account,
            tenant=foreign_tenant,
        )
        foreign_dataset = _create_dataset(transactional_db_session, foreign_client)
        foreign_response = authenticated_console_client.client.get(
            f"/console/api/notion/pre-import/pages?credential_id=credential-1&dataset_id={foreign_dataset.id}",
            headers=authenticated_console_client.headers,
        )

        assert missing_credential.status_code == 404
        assert missing_dataset.status_code == 404
        assert wrong_type_response.status_code == 400
        assert foreign_response.status_code == 404


class TestDataSourceNotionPreviewApi:
    def test_get_returns_extracted_content_and_rejects_missing_credentials(
        self,
        authenticated_console_client: AuthenticatedConsoleClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        page_id = uuid4()

        class FakeNotionExtractor:
            def __init__(self, **kwargs: object) -> None:
                assert kwargs["notion_obj_id"] == str(page_id)
                assert kwargs["notion_access_token"] == "secret"

            def extract(self) -> list[RagDocument]:
                return [RagDocument(page_content="first"), RagDocument(page_content="second")]

        _set_credentials(monkeypatch, {"integration_secret": "secret"})
        monkeypatch.setattr(data_source, "NotionExtractor", FakeNotionExtractor)
        response = authenticated_console_client.client.get(
            f"/console/api/notion/pages/{page_id}/page/preview?credential_id=credential-1",
            headers=authenticated_console_client.headers,
        )

        _set_credentials(monkeypatch, None)
        missing_credential = authenticated_console_client.client.get(
            f"/console/api/notion/pages/{page_id}/page/preview?credential_id=missing",
            headers=authenticated_console_client.headers,
        )

        assert response.status_code == 200
        assert response.json == {"content": "first\nsecond"}
        assert missing_credential.status_code == 404


class TestDataSourceNotionIndexingEstimateApi:
    def test_post_validates_payload_and_returns_indexing_contract(
        self,
        authenticated_console_client: AuthenticatedConsoleClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        observed: dict[str, object] = {}

        def indexing_estimate(_self: object, **kwargs: object) -> IndexingEstimate:
            observed.update(kwargs)
            return IndexingEstimate(total_segments=1, preview=[PreviewDetail(content="preview")])

        monkeypatch.setattr(data_source.IndexingRunner, "indexing_estimate", indexing_estimate)
        response = authenticated_console_client.client.post(
            "/console/api/datasets/notion-indexing-estimate",
            headers=authenticated_console_client.headers,
            json={
                "notion_info_list": [
                    {
                        "workspace_id": "workspace-1",
                        "credential_id": "credential-1",
                        "pages": [{"page_id": "page-1", "type": "page"}],
                    }
                ],
                "process_rule": {"mode": "automatic"},
                "doc_form": IndexStructureType.PARAGRAPH_INDEX,
                "doc_language": "English",
            },
        )

        assert response.status_code == 200
        assert response.json == {
            "total_segments": 1,
            "preview": [{"content": "preview", "summary": None, "child_chunks": None}],
            "qa_preview": None,
        }
        assert observed["tenant_id"] == authenticated_console_client.tenant.id
        extract_settings = observed["extract_settings"]
        assert isinstance(extract_settings, list)
        assert extract_settings[0].notion_info.notion_obj_id == "page-1"


class TestDataSourceNotionDatasetSyncApi:
    def test_get_dispatches_only_persisted_enabled_documents(
        self,
        authenticated_console_client: AuthenticatedConsoleClient,
        transactional_db_session: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        dataset = _create_dataset(transactional_db_session, authenticated_console_client)
        enabled_document = _create_document(transactional_db_session, authenticated_console_client, dataset)
        _create_document(transactional_db_session, authenticated_console_client, dataset, enabled=False)
        task = _TaskRecorder()
        monkeypatch.setattr(data_source, "document_indexing_sync_task", task)

        response = authenticated_console_client.client.get(
            f"/console/api/datasets/{dataset.id}/notion/sync",
            headers=authenticated_console_client.headers,
        )
        missing = authenticated_console_client.client.get(
            f"/console/api/datasets/{uuid4()}/notion/sync",
            headers=authenticated_console_client.headers,
        )

        assert response.status_code == 200
        assert response.json == {"result": "success"}
        assert task.calls == [(dataset.id, enabled_document.id)]
        assert missing.status_code == 404


class TestDataSourceNotionDocumentSyncApi:
    def test_get_dispatches_persisted_document_and_rejects_missing_resources(
        self,
        authenticated_console_client: AuthenticatedConsoleClient,
        transactional_db_session: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        dataset = _create_dataset(transactional_db_session, authenticated_console_client)
        document = _create_document(transactional_db_session, authenticated_console_client, dataset)
        task = _TaskRecorder()
        monkeypatch.setattr(data_source, "document_indexing_sync_task", task)

        response = authenticated_console_client.client.get(
            f"/console/api/datasets/{dataset.id}/documents/{document.id}/notion/sync",
            headers=authenticated_console_client.headers,
        )
        missing_document = authenticated_console_client.client.get(
            f"/console/api/datasets/{dataset.id}/documents/{uuid4()}/notion/sync",
            headers=authenticated_console_client.headers,
        )
        missing_dataset = authenticated_console_client.client.get(
            f"/console/api/datasets/{uuid4()}/documents/{uuid4()}/notion/sync",
            headers=authenticated_console_client.headers,
        )

        assert response.status_code == 200
        assert response.json == {"result": "success"}
        assert task.calls == [(dataset.id, document.id)]
        assert missing_document.status_code == 404
        assert missing_dataset.status_code == 404
