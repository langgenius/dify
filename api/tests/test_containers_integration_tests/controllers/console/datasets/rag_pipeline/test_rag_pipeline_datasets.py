"""Testcontainers integration tests for rag_pipeline_datasets controller endpoints."""

from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

import services
from controllers.console import console_ns
from controllers.console.datasets.error import DatasetNameDuplicateError
from controllers.console.datasets.rag_pipeline.rag_pipeline_datasets import (
    CreateEmptyRagPipelineDatasetApi,
    CreateRagPipelineDatasetApi,
)
from models.dataset import Dataset, DatasetPermissionEnum, DatasetRuntimeMode, Pipeline
from services.entities.dsl_entities import ImportStatus
from tests.test_containers_integration_tests.controllers.console.helpers import unwrap


class TestCreateRagPipelineDatasetApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

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
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_post_success(self, app: Flask, db_session_with_containers: Session) -> None:
        api = CreateEmptyRagPipelineDatasetApi()
        method = unwrap(api.post)

        user = MagicMock(is_dataset_editor=True)
        tenant_id = str(uuid4())
        account_id = str(uuid4())
        pipeline = Pipeline(
            tenant_id=tenant_id,
            name="Pipeline dataset",
            description="",
            created_by=account_id,
        )
        db_session_with_containers.add(pipeline)
        db_session_with_containers.flush()
        dataset = Dataset(
            tenant_id=tenant_id,
            name="Pipeline dataset",
            description="",
            permission=DatasetPermissionEnum.ONLY_ME,
            provider="vendor",
            runtime_mode=DatasetRuntimeMode.RAG_PIPELINE,
            icon_info={"icon": "📙", "icon_background": "#FFF4ED", "icon_type": "emoji"},
            created_by=account_id,
            pipeline_id=pipeline.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()
        db_session_with_containers.expire_all()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.DatasetService.create_empty_rag_pipeline_dataset",
                return_value=dataset,
            ),
        ):
            response, status = method(api, tenant_id, user)

        assert status == 201
        assert response["id"] == dataset.id
        assert response["name"] == "Pipeline dataset"
        assert response["pipeline_id"] == pipeline.id
        assert response["runtime_mode"] == "rag_pipeline"
        assert response["icon_info"] == {
            "icon": "📙",
            "icon_background": "#FFF4ED",
            "icon_type": "emoji",
            "icon_url": None,
        }

    def test_post_forbidden_non_editor(self, app: Flask) -> None:
        api = CreateEmptyRagPipelineDatasetApi()
        method = unwrap(api.post)

        user = MagicMock(is_dataset_editor=False)

        with app.test_request_context("/"):
            with pytest.raises(Forbidden):
                method(api, "tenant-1", user)
