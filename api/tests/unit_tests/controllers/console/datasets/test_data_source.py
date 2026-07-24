from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from werkzeug.exceptions import NotFound

from controllers.console.datasets import data_source
from controllers.console.datasets.data_source import (
    DataSourceApi,
    DataSourceNotionApi,
    DataSourceNotionDatasetSyncApi,
    DataSourceNotionDocumentSyncApi,
    DataSourceNotionListApi,
)


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture
def tenant_ctx():
    return (MagicMock(id="u1"), "tenant-1")


@pytest.fixture
def patch_tenant(tenant_ctx):
    with patch(
        "controllers.console.datasets.data_source.current_account_with_tenant",
        return_value=tenant_ctx,
    ):
        yield


@pytest.fixture
def mock_engine():
    with patch.object(
        type(data_source.db),
        "engine",
        new_callable=PropertyMock,
        return_value=MagicMock(),
    ):
        yield


class TestDataSourceApi:
    def test_get_success(self, app, patch_tenant):
        api = DataSourceApi()
        method = unwrap(api.get)

        binding = MagicMock(
            id="b1",
            provider="notion",
            created_at="now",
            disabled=False,
            source_info={},
        )

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.data_source.db.session.scalars",
                return_value=MagicMock(all=lambda: [binding]),
            ),
        ):
            response, status = method(api)

        assert status == 200
        assert response["data"][0]["is_bound"] is True

    def test_get_no_bindings(self, app, patch_tenant):
        api = DataSourceApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.data_source.db.session.scalars",
                return_value=MagicMock(all=lambda: []),
            ),
        ):
            response, status = method(api)

        assert status == 200
        assert response["data"] == []

    def test_patch_enable_binding(self, app, patch_tenant, mock_engine):
        api = DataSourceApi()
        method = unwrap(api.patch)

        binding = MagicMock(id="b1", disabled=True)

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.data_source.Session") as mock_session_class,
            patch("controllers.console.datasets.data_source.db.session.add"),
            patch("controllers.console.datasets.data_source.db.session.commit"),
        ):
            mock_session = MagicMock()
            mock_session_class.return_value.__enter__.return_value = mock_session
            mock_session.execute.return_value.scalar_one_or_none.return_value = binding

            response, status = method(api, "b1", "enable")

        assert status == 200
        assert binding.disabled is False

    def test_patch_disable_binding(self, app, patch_tenant, mock_engine):
        api = DataSourceApi()
        method = unwrap(api.patch)

        binding = MagicMock(id="b1", disabled=False)

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.data_source.Session") as mock_session_class,
            patch("controllers.console.datasets.data_source.db.session.add"),
            patch("controllers.console.datasets.data_source.db.session.commit"),
        ):
            mock_session = MagicMock()
            mock_session_class.return_value.__enter__.return_value = mock_session
            mock_session.execute.return_value.scalar_one_or_none.return_value = binding

            response, status = method(api, "b1", "disable")

        assert status == 200
        assert binding.disabled is True

    def test_patch_binding_not_found(self, app, patch_tenant, mock_engine):
        api = DataSourceApi()
        method = unwrap(api.patch)

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.data_source.Session") as mock_session_class,
        ):
            mock_session = MagicMock()
            mock_session_class.return_value.__enter__.return_value = mock_session
            mock_session.execute.return_value.scalar_one_or_none.return_value = None

            with pytest.raises(NotFound):
                method(api, "b1", "enable")

    def test_patch_enable_already_enabled(self, app, patch_tenant, mock_engine):
        api = DataSourceApi()
        method = unwrap(api.patch)

        binding = MagicMock(id="b1", disabled=False)

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.data_source.Session") as mock_session_class,
        ):
            mock_session = MagicMock()
            mock_session_class.return_value.__enter__.return_value = mock_session
            mock_session.execute.return_value.scalar_one_or_none.return_value = binding

            with pytest.raises(ValueError):
                method(api, "b1", "enable")

    def test_patch_disable_already_disabled(self, app, patch_tenant, mock_engine):
        api = DataSourceApi()
        method = unwrap(api.patch)

        binding = MagicMock(id="b1", disabled=True)

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.data_source.Session") as mock_session_class,
        ):
            mock_session = MagicMock()
            mock_session_class.return_value.__enter__.return_value = mock_session
            mock_session.execute.return_value.scalar_one_or_none.return_value = binding

            with pytest.raises(ValueError):
                method(api, "b1", "disable")


class TestDataSourceNotionListApi:
    def test_get_credential_not_found(self, app, patch_tenant):
        api = DataSourceNotionListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?credential_id=c1"),
            patch(
                "controllers.console.datasets.data_source.DatasourceProviderService.get_datasource_credentials",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api)

    def test_get_success_no_dataset_id(self, app, patch_tenant, mock_engine):
        api = DataSourceNotionListApi()
        method = unwrap(api.get)

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
            response, status = method(api)

        assert status == 200

    def test_get_success_with_dataset_id(self, app, patch_tenant, mock_engine):
        api = DataSourceNotionListApi()
        method = unwrap(api.get)

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
        document = MagicMock(data_source_info='{"notion_page_id": "p1"}')

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
            patch("controllers.console.datasets.data_source.Session") as mock_session_class,
            patch(
                "core.datasource.datasource_manager.DatasourceManager.get_datasource_runtime",
                return_value=MagicMock(
                    get_online_document_pages=lambda **kw: iter([online_document_message]),
                    datasource_provider_type=lambda: None,
                ),
            ),
        ):
            mock_session = MagicMock()
            mock_session_class.return_value.__enter__.return_value = mock_session
            mock_session.scalars.return_value.all.return_value = [document]

            response, status = method(api)

        assert status == 200

    def test_get_invalid_dataset_type(self, app, patch_tenant, mock_engine):
        api = DataSourceNotionListApi()
        method = unwrap(api.get)

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
            patch("controllers.console.datasets.data_source.Session"),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestDataSourceNotionApi:
    def test_get_preview_success(self, app, patch_tenant):
        api = DataSourceNotionApi()
        method = unwrap(api.get)

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
            response, status = method(api, "p1", "page")

        assert status == 200

    def test_post_indexing_estimate_success(self, app, patch_tenant):
        api = DataSourceNotionApi()
        method = unwrap(api.post)

        payload = {
            "notion_info_list": [
                {
                    "workspace_id": "w1",
                    "credential_id": "c1",
                    "pages": [{"page_id": "p1", "type": "page"}],
                }
            ],
            "process_rule": {"rules": {}},
            "doc_form": "text_model",
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
            response, status = method(api)

        assert status == 200


class TestDataSourceNotionDatasetSyncApi:
    def test_get_success(self, app, patch_tenant):
        api = DataSourceNotionDatasetSyncApi()
        method = unwrap(api.get)

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

    def test_get_dataset_not_found(self, app, patch_tenant):
        api = DataSourceNotionDatasetSyncApi()
        method = unwrap(api.get)

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
    def test_get_success(self, app, patch_tenant):
        api = DataSourceNotionDocumentSyncApi()
        method = unwrap(api.get)

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

    def test_get_document_not_found(self, app, patch_tenant):
        api = DataSourceNotionDocumentSyncApi()
        method = unwrap(api.get)

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
