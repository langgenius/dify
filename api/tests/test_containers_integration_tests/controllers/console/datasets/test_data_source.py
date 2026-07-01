"""Testcontainers integration tests for controllers.console.datasets.data_source endpoints."""

from __future__ import annotations

import inspect
from collections.abc import Iterator
from datetime import UTC, datetime
from unittest.mock import MagicMock, PropertyMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.console.datasets import data_source
from controllers.console.datasets.data_source import (
    DataSourceApi,
    DataSourceNotionDatasetSyncApi,
    DataSourceNotionDocumentSyncApi,
    DataSourceNotionIndexingEstimateApi,
    DataSourceNotionListApi,
    DataSourceNotionPreviewApi,
)
from core.rag.index_processor.constant.index_type import IndexStructureType
from models import Account, DataSourceOauthBinding
from models.dataset import Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus


@pytest.fixture
def current_user() -> Account:
    account = Account(name="Test User", email="u1@example.com")
    account.id = "u1"
    return account


@pytest.fixture
def mock_engine() -> Iterator[None]:
    with patch.object(
        type(data_source.db),
        "engine",
        new_callable=PropertyMock,
        return_value=MagicMock(),
    ):
        yield


class TestDataSourceApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_get_success(self, app: Flask) -> None:
        api = DataSourceApi()
        method = inspect.unwrap(api.get)

        binding = DataSourceOauthBinding(
            tenant_id="tenant-1",
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
        )
        binding.id = "b1"
        binding.created_at = datetime(2026, 5, 25, 1, 2, 3, tzinfo=UTC)
        binding.disabled = False

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.data_source.db.session.scalars",
                return_value=MagicMock(all=lambda: [binding]),
            ),
        ):
            response, status = method(api, "tenant-1")

        assert status == 200
        assert response["data"][0] == {
            "id": "b1",
            "provider": "notion",
            "created_at": 1779670923,
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

    def test_get_no_bindings(self, app: Flask) -> None:
        api = DataSourceApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.data_source.db.session.scalars",
                return_value=MagicMock(all=lambda: []),
            ),
        ):
            response, status = method(api, "tenant-1")

        assert status == 200
        assert response["data"] == []

    def test_patch_enable_binding(self, app: Flask, mock_engine: None) -> None:
        api = DataSourceApi()
        method = inspect.unwrap(api.patch)

        binding = MagicMock(id="b1", disabled=True)

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.data_source.sessionmaker") as mock_session_class,
            patch("controllers.console.datasets.data_source.db.session.add"),
            patch("controllers.console.datasets.data_source.db.session.commit"),
        ):
            mock_session = MagicMock()
            mock_session_class.return_value.begin.return_value.__enter__.return_value = mock_session
            mock_session.execute.return_value.scalar_one_or_none.return_value = binding

            response, status = method(api, "tenant-1", "b1", "enable")

        assert status == 200
        assert binding.disabled is False

    def test_patch_disable_binding(self, app: Flask, mock_engine: None) -> None:
        api = DataSourceApi()
        method = inspect.unwrap(api.patch)

        binding = MagicMock(id="b1", disabled=False)

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.data_source.sessionmaker") as mock_session_class,
            patch("controllers.console.datasets.data_source.db.session.add"),
            patch("controllers.console.datasets.data_source.db.session.commit"),
        ):
            mock_session = MagicMock()
            mock_session_class.return_value.begin.return_value.__enter__.return_value = mock_session
            mock_session.execute.return_value.scalar_one_or_none.return_value = binding

            response, status = method(api, "tenant-1", "b1", "disable")

        assert status == 200
        assert binding.disabled is True

    def test_patch_binding_not_found(self, app: Flask, mock_engine: None) -> None:
        api = DataSourceApi()
        method = inspect.unwrap(api.patch)

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.data_source.sessionmaker") as mock_session_class,
        ):
            mock_session = MagicMock()
            mock_session_class.return_value.begin.return_value.__enter__.return_value = mock_session
            mock_session.execute.return_value.scalar_one_or_none.return_value = None

            with pytest.raises(NotFound):
                method(api, "tenant-1", "b1", "enable")

    def test_patch_enable_already_enabled(self, app: Flask, mock_engine: None) -> None:
        api = DataSourceApi()
        method = inspect.unwrap(api.patch)

        binding = MagicMock(id="b1", disabled=False)

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.data_source.sessionmaker") as mock_session_class,
        ):
            mock_session = MagicMock()
            mock_session_class.return_value.begin.return_value.__enter__.return_value = mock_session
            mock_session.execute.return_value.scalar_one_or_none.return_value = binding

            with pytest.raises(ValueError):
                method(api, "tenant-1", "b1", "enable")

    def test_patch_disable_already_disabled(self, app: Flask, mock_engine: None) -> None:
        api = DataSourceApi()
        method = inspect.unwrap(api.patch)

        binding = MagicMock(id="b1", disabled=True)

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.data_source.sessionmaker") as mock_session_class,
        ):
            mock_session = MagicMock()
            mock_session_class.return_value.begin.return_value.__enter__.return_value = mock_session
            mock_session.execute.return_value.scalar_one_or_none.return_value = binding

            with pytest.raises(ValueError):
                method(api, "tenant-1", "b1", "disable")


class TestDataSourceNotionListApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_get_credential_not_found(self, app: Flask, current_user: Account) -> None:
        api = DataSourceNotionListApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/?credential_id=c1"),
            patch(
                "controllers.console.datasets.data_source.DatasourceProviderService.get_datasource_credentials",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "tenant-1", current_user)

    def test_get_success_no_dataset_id(self, app: Flask, current_user: Account, mock_engine: None) -> None:
        api = DataSourceNotionListApi()
        method = inspect.unwrap(api.get)

        page = MagicMock(
            page_id="p1",
            page_name="Page 1",
            type="page",
            parent_id="parent",
            page_icon=None,
        )

        online_document_message = MagicMock(
            result=[
                MagicMock(
                    workspace_id="w1",
                    workspace_name="My Workspace",
                    workspace_icon="icon",
                    pages=[page],
                )
            ]
        )

        with (
            app.test_request_context("/?credential_id=c1"),
            patch(
                "controllers.console.datasets.data_source.DatasourceProviderService.get_datasource_credentials",
                return_value={"token": "t"},
            ),
            patch(
                "core.datasource.datasource_manager.DatasourceManager.get_datasource_runtime",
                return_value=MagicMock(
                    get_online_document_pages=lambda **kw: iter([online_document_message]),
                    datasource_provider_type=lambda: None,
                ),
            ),
        ):
            response, status = method(api, "tenant-1", current_user)

        assert status == 200

    def test_get_success_with_dataset_id(
        self, app: Flask, current_user: Account, mock_engine: None, db_session_with_containers: Session
    ) -> None:
        api = DataSourceNotionListApi()
        method = inspect.unwrap(api.get)
        tenant_id = str(uuid4())
        dataset_id = str(uuid4())

        page = MagicMock(
            page_id="p1",
            page_name="Page 1",
            type="page",
            parent_id="parent",
            page_icon=None,
        )

        online_document_message = MagicMock(
            result=[
                MagicMock(
                    workspace_id="w1",
                    workspace_name="My Workspace",
                    workspace_icon="icon",
                    pages=[page],
                )
            ]
        )

        dataset = MagicMock(data_source_type="notion_import")
        document = Document(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            position=1,
            data_source_type=DataSourceType.NOTION_IMPORT,
            data_source_info='{"notion_page_id": "p1"}',
            batch=f"batch-{uuid4()}",
            name="Notion Page",
            created_from=DocumentCreatedFrom.WEB,
            created_by=str(uuid4()),
            indexing_status=IndexingStatus.COMPLETED,
            enabled=True,
        )
        db_session_with_containers.add(document)
        db_session_with_containers.commit()

        with (
            app.test_request_context(f"/?credential_id=c1&dataset_id={dataset_id}"),
            patch(
                "controllers.console.datasets.data_source.DatasourceProviderService.get_datasource_credentials",
                return_value={"token": "t"},
            ),
            patch(
                "controllers.console.datasets.data_source.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "core.datasource.datasource_manager.DatasourceManager.get_datasource_runtime",
                return_value=MagicMock(
                    get_online_document_pages=lambda **kw: iter([online_document_message]),
                    datasource_provider_type=lambda: None,
                ),
            ),
        ):
            response, status = method(api, tenant_id, current_user)

        assert status == 200

    def test_get_invalid_dataset_type(self, app: Flask, current_user: Account, mock_engine: None) -> None:
        api = DataSourceNotionListApi()
        method = inspect.unwrap(api.get)

        dataset = MagicMock(data_source_type="other_type")

        with (
            app.test_request_context("/?credential_id=c1&dataset_id=ds1"),
            patch(
                "controllers.console.datasets.data_source.DatasourceProviderService.get_datasource_credentials",
                return_value={"token": "t"},
            ),
            patch(
                "controllers.console.datasets.data_source.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch("controllers.console.datasets.data_source.sessionmaker"),
        ):
            with pytest.raises(ValueError):
                method(api, "tenant-1", current_user)


class TestDataSourceNotionPreviewApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_get_preview_success(self, app: Flask) -> None:
        api = DataSourceNotionPreviewApi()
        method = inspect.unwrap(api.get)

        extractor = MagicMock(extract=lambda: [MagicMock(page_content="hello")])

        with (
            app.test_request_context("/?credential_id=c1"),
            patch(
                "controllers.console.datasets.data_source.DatasourceProviderService.get_datasource_credentials",
                return_value={"integration_secret": "t"},
            ),
            patch(
                "controllers.console.datasets.data_source.NotionExtractor",
                return_value=extractor,
            ),
        ):
            response, status = method(api, "tenant-1", "p1", "page")

        assert status == 200


class TestDataSourceNotionIndexingEstimateApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_post_indexing_estimate_success(self, app: Flask) -> None:
        api = DataSourceNotionIndexingEstimateApi()
        method = inspect.unwrap(api.post)

        empty_rules: dict[str, object] = {}
        payload: dict[str, object] = {
            "notion_info_list": [
                {
                    "workspace_id": "w1",
                    "credential_id": "c1",
                    "pages": [{"page_id": "p1", "type": "page"}],
                }
            ],
            "process_rule": {"rules": empty_rules},
            "doc_form": IndexStructureType.PARAGRAPH_INDEX,
            "doc_language": "English",
        }

        with (
            app.test_request_context("/", method="POST", json=payload, headers={"Content-Type": "application/json"}),
            patch(
                "controllers.console.datasets.data_source.DocumentService.estimate_args_validate",
            ),
            patch(
                "controllers.console.datasets.data_source.IndexingRunner.indexing_estimate",
                return_value=MagicMock(model_dump=lambda: {"total_pages": 1}),
            ),
        ):
            response, status = method(api, "tenant-1")

        assert status == 200


class TestDataSourceNotionDatasetSyncApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_get_success(self, app: Flask) -> None:
        api = DataSourceNotionDatasetSyncApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.data_source.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.data_source.DocumentService.get_document_by_dataset_id",
                return_value=[MagicMock(id="d1")],
            ),
            patch(
                "controllers.console.datasets.data_source.document_indexing_sync_task.delay",
                return_value=None,
            ),
        ):
            response, status = method(api, "ds-1")

        assert status == 200

    def test_get_dataset_not_found(self, app: Flask) -> None:
        api = DataSourceNotionDatasetSyncApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.data_source.DatasetService.get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "ds-1")


class TestDataSourceNotionDocumentSyncApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_get_success(self, app: Flask) -> None:
        api = DataSourceNotionDocumentSyncApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.data_source.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.data_source.DocumentService.get_document",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.data_source.document_indexing_sync_task.delay",
                return_value=None,
            ),
        ):
            response, status = method(api, "ds-1", "doc-1")

        assert status == 200

    def test_get_document_not_found(self, app: Flask) -> None:
        api = DataSourceNotionDocumentSyncApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.data_source.DatasetService.get_dataset",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.data_source.DocumentService.get_document",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "ds-1", "doc-1")
