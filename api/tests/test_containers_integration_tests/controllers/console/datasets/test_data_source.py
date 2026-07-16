"""Integration coverage for Notion page bindings backed by persisted documents."""

from inspect import unwrap
from unittest.mock import MagicMock, patch
from uuid import uuid4

from flask import Flask
from sqlalchemy.orm import Session

from controllers.console.datasets.data_source import DataSourceNotionListApi
from models import Account
from models.dataset import Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus


def test_notion_page_is_marked_bound_from_persisted_document(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    account = Account(name="Test User", email="user@example.com")
    account.id = str(uuid4())
    document = Document(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.NOTION_IMPORT,
        data_source_info='{"notion_page_id": "page-1"}',
        batch=f"batch-{uuid4()}",
        name="Notion Page",
        created_from=DocumentCreatedFrom.WEB,
        created_by=str(uuid4()),
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

    with (
        flask_app_with_containers.test_request_context(f"/?credential_id=c1&dataset_id={dataset_id}"),
        patch(
            "controllers.console.datasets.data_source.DatasourceProviderService.get_datasource_credentials",
            return_value={"token": "token"},
        ),
        patch(
            "controllers.console.datasets.data_source.DatasetService.get_dataset",
            return_value=MagicMock(data_source_type="notion_import"),
        ),
        patch(
            "core.datasource.datasource_manager.DatasourceManager.get_datasource_runtime",
            return_value=runtime,
        ),
    ):
        response, status = unwrap(DataSourceNotionListApi().get)(
            DataSourceNotionListApi(),
            db_session_with_containers,
            tenant_id,
            account,
        )

    assert status == 200
    assert response["notion_info"][0]["pages"][0]["is_bound"] is True
