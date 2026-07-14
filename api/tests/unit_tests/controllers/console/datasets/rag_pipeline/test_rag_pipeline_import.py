"""Unit tests for rag_pipeline_import controller endpoints."""

from __future__ import annotations

from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console import console_ns
from controllers.console.datasets.rag_pipeline import rag_pipeline_import as module
from controllers.console.datasets.rag_pipeline.rag_pipeline_import import (
    RagPipelineExportApi,
    RagPipelineImportApi,
    RagPipelineImportCheckDependenciesApi,
    RagPipelineImportConfirmApi,
)
from core.plugin.entities.plugin import PluginDependency, PluginDependencyType
from models.dataset import Pipeline
from services.entities.dsl_entities import CheckDependenciesResult, ImportStatus
from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineImportInfo


@pytest.fixture(autouse=True)
def _route_database_to_sqlite(monkeypatch: pytest.MonkeyPatch, sqlite_engine) -> None:
    monkeypatch.setattr(module, "db", SimpleNamespace(engine=sqlite_engine))


class TestRagPipelineImportApi:
    def _payload(self, mode: str = "create") -> dict[str, str]:
        return {
            "mode": mode,
            "yaml_content": "content",
            "name": "Test",
        }

    def test_post_success_200(self, app: Flask) -> None:
        api = RagPipelineImportApi()
        method = unwrap(api.post)

        payload = self._payload()
        user = MagicMock()
        result = RagPipelineImportInfo(
            id="import-1",
            status=ImportStatus.COMPLETED,
            pipeline_id="pipeline-1",
            dataset_id="dataset-1",
            current_dsl_version="0.1.0",
            imported_dsl_version="0.1.0",
        )

        service = MagicMock()
        service.import_rag_pipeline.return_value = result

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, user)

        assert status == 200
        assert response == {
            "id": "import-1",
            "status": "completed",
            "pipeline_id": "pipeline-1",
            "dataset_id": "dataset-1",
            "current_dsl_version": "0.1.0",
            "imported_dsl_version": "0.1.0",
            "error": "",
        }

    def test_post_failed_400(self, app: Flask) -> None:
        api = RagPipelineImportApi()
        method = unwrap(api.post)

        payload = self._payload()
        user = MagicMock()
        result = RagPipelineImportInfo(
            id="import-1",
            status=ImportStatus.FAILED,
            current_dsl_version="0.1.0",
            imported_dsl_version="",
            error="bad dsl",
        )

        service = MagicMock()
        service.import_rag_pipeline.return_value = result

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, user)

        assert status == 400
        assert response["status"] == "failed"
        assert response["error"] == "bad dsl"
        assert response["pipeline_id"] is None
        assert response["dataset_id"] is None

    def test_post_pending_202(self, app: Flask) -> None:
        api = RagPipelineImportApi()
        method = unwrap(api.post)

        payload = self._payload()
        user = MagicMock()
        result = RagPipelineImportInfo(
            id="import-1",
            status=ImportStatus.PENDING,
            pipeline_id="pipeline-1",
            dataset_id="dataset-1",
            current_dsl_version="0.1.0",
            imported_dsl_version="0.2.0",
        )

        service = MagicMock()
        service.import_rag_pipeline.return_value = result

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, user)

        assert status == 202
        assert response["status"] == "pending"
        assert response["pipeline_id"] == "pipeline-1"
        assert response["dataset_id"] == "dataset-1"


class TestRagPipelineImportConfirmApi:
    def test_confirm_success(self, app: Flask) -> None:
        api = RagPipelineImportConfirmApi()
        method = unwrap(api.post)

        user = MagicMock()
        result = RagPipelineImportInfo(
            id="import-1",
            status=ImportStatus.COMPLETED,
            pipeline_id="pipeline-1",
            dataset_id="dataset-1",
            current_dsl_version="0.1.0",
            imported_dsl_version="0.1.0",
        )

        service = MagicMock()
        service.confirm_import.return_value = result

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, user, "import-1")

        assert status == 200
        assert response["status"] == "completed"
        assert response["pipeline_id"] == "pipeline-1"

    def test_confirm_failed(self, app: Flask) -> None:
        api = RagPipelineImportConfirmApi()
        method = unwrap(api.post)

        user = MagicMock()
        result = RagPipelineImportInfo(
            id="import-1",
            status=ImportStatus.FAILED,
            current_dsl_version="0.1.0",
            imported_dsl_version="",
            error="missing dependency",
        )

        service = MagicMock()
        service.confirm_import.return_value = result

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, user, "import-1")

        assert status == 400
        assert response["status"] == "failed"
        assert response["error"] == "missing dependency"


class TestRagPipelineImportCheckDependenciesApi:
    def test_get_success(self, app: Flask) -> None:
        api = RagPipelineImportCheckDependenciesApi()
        method = unwrap(api.get)

        pipeline = MagicMock(spec=Pipeline)
        result = CheckDependenciesResult()

        service = MagicMock()
        service.check_dependencies.return_value = result

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, pipeline)

        assert status == 200
        assert response == {"leaked_dependencies": []}

    def test_get_serializes_leaked_dependencies(self, app: Flask) -> None:
        api = RagPipelineImportCheckDependenciesApi()
        method = unwrap(api.get)

        pipeline = MagicMock(spec=Pipeline)
        dependency = PluginDependency(
            type=PluginDependencyType.Marketplace,
            value=PluginDependency.Marketplace(
                marketplace_plugin_unique_identifier="langgenius/example:0.1.0",
                version="0.1.0",
            ),
            current_identifier="langgenius/example:0.0.1",
        )
        service = MagicMock()
        service.check_dependencies.return_value = CheckDependenciesResult(leaked_dependencies=[dependency])

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, pipeline)

        assert status == 200
        assert response == {
            "leaked_dependencies": [
                {
                    "type": "marketplace",
                    "value": {
                        "marketplace_plugin_unique_identifier": "langgenius/example:0.1.0",
                        "version": "0.1.0",
                    },
                    "current_identifier": "langgenius/example:0.0.1",
                }
            ]
        }


class TestRagPipelineExportApi:
    def test_get_with_include_secret(self, app: Flask) -> None:
        api = RagPipelineExportApi()
        method = unwrap(api.get)

        pipeline = MagicMock(spec=Pipeline)
        service = MagicMock()
        service.export_rag_pipeline_dsl.return_value = "yaml: data"

        with (
            app.test_request_context("/?include_secret=true"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, pipeline)

        assert status == 200
        assert response == {"data": "yaml: data"}
