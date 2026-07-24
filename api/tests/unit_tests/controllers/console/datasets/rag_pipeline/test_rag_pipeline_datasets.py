from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden

import services
from controllers.console import console_ns
from controllers.console.datasets.error import DatasetNameDuplicateError
from controllers.console.datasets.rag_pipeline.rag_pipeline_datasets import (
    CreateEmptyRagPipelineDatasetApi,
    CreateRagPipelineDatasetApi,
)


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestCreateRagPipelineDatasetApi:
    def _valid_payload(self):
        return {"yaml_content": "name: test"}

    def test_post_success(self, app):
        api = CreateRagPipelineDatasetApi()
        method = unwrap(api.post)

        payload = self._valid_payload()
        user = MagicMock(is_dataset_editor=True)
        import_info = {"dataset_id": "ds-1"}

        mock_service = MagicMock()
        mock_service.create_rag_pipeline_dataset.return_value = import_info

        mock_session_ctx = MagicMock()
        mock_session_ctx.__enter__.return_value = MagicMock()
        mock_session_ctx.__exit__.return_value = None

        fake_db = MagicMock()
        fake_db.engine = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.db",
                fake_db,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.Session",
                return_value=mock_session_ctx,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.RagPipelineDslService",
                return_value=mock_service,
            ),
        ):
            response, status = method(api)

        assert status == 201
        assert response == import_info

    def test_post_forbidden_non_editor(self, app):
        api = CreateRagPipelineDatasetApi()
        method = unwrap(api.post)

        payload = self._valid_payload()
        user = MagicMock(is_dataset_editor=False)

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api)

    def test_post_dataset_name_duplicate(self, app):
        api = CreateRagPipelineDatasetApi()
        method = unwrap(api.post)

        payload = self._valid_payload()
        user = MagicMock(is_dataset_editor=True)

        mock_service = MagicMock()
        mock_service.create_rag_pipeline_dataset.side_effect = services.errors.dataset.DatasetNameDuplicateError()

        mock_session_ctx = MagicMock()
        mock_session_ctx.__enter__.return_value = MagicMock()
        mock_session_ctx.__exit__.return_value = None

        fake_db = MagicMock()
        fake_db.engine = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.db",
                fake_db,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.Session",
                return_value=mock_session_ctx,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.RagPipelineDslService",
                return_value=mock_service,
            ),
        ):
            with pytest.raises(DatasetNameDuplicateError):
                method(api)

    def test_post_invalid_payload(self, app):
        api = CreateRagPipelineDatasetApi()
        method = unwrap(api.post)

        payload = {}
        user = MagicMock(is_dataset_editor=True)

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestCreateEmptyRagPipelineDatasetApi:
    def test_post_success(self, app):
        api = CreateEmptyRagPipelineDatasetApi()
        method = unwrap(api.post)

        user = MagicMock(is_dataset_editor=True)
        dataset = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.DatasetService.create_empty_rag_pipeline_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.marshal",
                return_value={"id": "ds-1"},
            ),
        ):
            response, status = method(api)

        assert status == 201
        assert response == {"id": "ds-1"}

    def test_post_forbidden_non_editor(self, app):
        api = CreateEmptyRagPipelineDatasetApi()
        method = unwrap(api.post)

        user = MagicMock(is_dataset_editor=False)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api)
