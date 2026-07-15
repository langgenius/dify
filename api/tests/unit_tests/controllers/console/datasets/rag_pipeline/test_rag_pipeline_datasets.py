"""Unit tests for rag_pipeline_datasets controller endpoints."""

from __future__ import annotations

from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

import services
from controllers.console import console_ns
from controllers.console.datasets.error import DatasetNameDuplicateError
from controllers.console.datasets.rag_pipeline.rag_pipeline_datasets import (
    CreateEmptyRagPipelineDatasetApi,
    CreateRagPipelineDatasetApi,
)
from services.entities.dsl_entities import ImportStatus


class TestCreateRagPipelineDatasetApi:
    def _valid_payload(self) -> dict[str, str]:
        return {"yaml_content": "name: test"}

    def test_post_success(self, app: Flask) -> None:
        api = CreateRagPipelineDatasetApi()
        method = unwrap(api.post)

        payload = self._valid_payload()
        user = MagicMock(is_dataset_editor=True)
        import_info = {
            "id": "import-1",
            "status": ImportStatus.COMPLETED,
            "dataset_id": "ds-1",
            "pipeline_id": "pipeline-1",
            "current_dsl_version": "0.1.0",
            "imported_dsl_version": "0.1.0",
            "error": "",
        }

        mock_service = MagicMock()
        mock_service.create_rag_pipeline_dataset.return_value = import_info

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.RagPipelineDslService",
                return_value=mock_service,
            ),
        ):
            response, status = method(api, "tenant-1", user)

        assert status == 201
        assert response == {
            "id": "import-1",
            "status": "completed",
            "dataset_id": "ds-1",
            "pipeline_id": "pipeline-1",
            "current_dsl_version": "0.1.0",
            "imported_dsl_version": "0.1.0",
            "error": "",
        }

    def test_post_forbidden_non_editor(self, app: Flask) -> None:
        api = CreateRagPipelineDatasetApi()
        method = unwrap(api.post)

        payload = self._valid_payload()
        user = MagicMock(is_dataset_editor=False)

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            with pytest.raises(Forbidden):
                method(api, "tenant-1", user)

    def test_post_dataset_name_duplicate(self, app: Flask) -> None:
        api = CreateRagPipelineDatasetApi()
        method = unwrap(api.post)

        payload = self._valid_payload()
        user = MagicMock(is_dataset_editor=True)

        mock_service = MagicMock()
        mock_service.create_rag_pipeline_dataset.side_effect = services.errors.dataset.DatasetNameDuplicateError()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.RagPipelineDslService",
                return_value=mock_service,
            ),
        ):
            with pytest.raises(DatasetNameDuplicateError):
                method(api, "tenant-1", user)

    def test_post_invalid_payload(self, app: Flask) -> None:
        api = CreateRagPipelineDatasetApi()
        method = unwrap(api.post)

        payload: dict[str, str] = {}
        user = MagicMock(is_dataset_editor=True)

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            with pytest.raises(ValueError):
                method(api, "tenant-1", user)


class TestCreateEmptyRagPipelineDatasetApi:
    def test_post_forbidden_non_editor(self, app: Flask) -> None:
        api = CreateEmptyRagPipelineDatasetApi()
        method = unwrap(api.post)

        user = MagicMock(is_dataset_editor=False)

        with app.test_request_context("/"):
            with pytest.raises(Forbidden):
                method(api, "tenant-1", user)
