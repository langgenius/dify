"""Integration coverage for Notion page bindings backed by persisted documents."""

from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from controllers.console.datasets.data_source import DataSourceNotionListApi, DataSourceNotionListQuery
from machinery.context import RequestContext
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.workspace_member_query_repository import WorkspaceMemberQueryRepository
from services.data_source.credential_gateway import ActorDatasourceCredentialResolver
from services.data_source.notion_import_adapters import PluginNotionSourceGateway
from services.data_source.notion_import_application_service import NotionImportApplicationService
from services.knowledge.dataset_access import DatasetAccessService


def test_notion_page_is_marked_bound_from_persisted_document(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    account = Account(name="Test User", email="user@example.com")
    account.id = str(uuid4())
    tenant = Tenant(id=tenant_id, name="Workspace")
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Notion dataset",
        created_by=account.id,
        data_source_type=DataSourceType.NOTION_IMPORT,
    )
    db_session_with_containers.add_all(
        [
            account,
            tenant,
            TenantAccountJoin(tenant_id=tenant_id, account_id=account.id, role=TenantAccountRole.OWNER, current=True),
            dataset,
        ]
    )
    document = Document(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.NOTION_IMPORT,
        data_source_info='{"notion_page_id": "page-1"}',
        batch=f"batch-{uuid4()}",
        name="Notion Page",
        created_from=DocumentCreatedFrom.WEB,
        created_by=account.id,
        indexing_status=IndexingStatus.COMPLETED,
        enabled=True,
    )
    db_session_with_containers.add(document)
    db_session_with_containers.commit()
    runtime = MagicMock(
        get_online_document_pages=lambda **_kwargs: iter(
            [
                MagicMock(
                    result=[
                        MagicMock(
                            workspace_id="workspace-1",
                            workspace_name="Workspace",
                            workspace_icon=None,
                            pages=[
                                MagicMock(
                                    page_id="page-1",
                                    page_name="Page",
                                    type="page",
                                    parent_id="parent",
                                    page_icon=None,
                                )
                            ],
                        )
                    ]
                )
            ]
        ),
        datasource_provider_type=lambda: None,
    )

    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    datasets = SQLAlchemyDatasetRepository(session_factory=sessions)
    credentials = MagicMock(spec=ActorDatasourceCredentialResolver)
    credentials.resolve.return_value = {"token": "token"}
    notion_imports = NotionImportApplicationService(
        dataset_access=DatasetAccessService(
            datasets=datasets,
            workspace_roles=WorkspaceMemberQueryRepository(session_factory=sessions),
            legacy_permissions_enabled=True,
        ),
        datasets=datasets,
        documents=SQLAlchemyDocumentRepository(session_factory=sessions),
        source=PluginNotionSourceGateway(credentials=credentials, runtime_loader=MagicMock(return_value=runtime)),
    )
    context = RequestContext(
        request_id="notion-binding-test", trace_id=None, account_id=account.id, active_workspace_id=tenant_id
    )

    with (
        flask_app_with_containers.test_request_context(f"/?credential_id=c1&dataset_id={dataset_id}"),
        patch(
            "controllers.console.datasets.data_source.application_services",
            return_value=SimpleNamespace(data_sources=SimpleNamespace(notion_imports=notion_imports)),
        ),
    ):
        response, status = unwrap(DataSourceNotionListApi.get)(
            DataSourceNotionListApi(),
            DataSourceNotionListQuery(credential_id="c1", dataset_id=dataset_id),
            context,
        )

    assert status == 200
    assert response["notion_info"][0]["pages"][0]["is_bound"] is True
    credentials.resolve.assert_called_once_with(
        workspace_id=tenant_id,
        actor_id=account.id,
        credential_id="c1",
        provider="notion_datasource",
        plugin_id="langgenius/notion_datasource",
    )
