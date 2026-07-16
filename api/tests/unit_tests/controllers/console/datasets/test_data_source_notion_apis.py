"""Unit tests for controllers.console.datasets.data_source Notion endpoints."""

from __future__ import annotations

import inspect
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.console.datasets.data_source import (
    DataSourceNotionDatasetSyncApi,
    DataSourceNotionDocumentSyncApi,
    DataSourceNotionIndexingEstimateApi,
    DataSourceNotionPreviewApi,
)
from core.rag.index_processor.constant.index_type import IndexStructureType
from models import Account


@pytest.fixture
def current_user() -> Account:
    account = Account(name="Test User", email="u1@example.com")
    account.id = "u1"
    return account


class TestDataSourceNotionPreviewApi:
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
