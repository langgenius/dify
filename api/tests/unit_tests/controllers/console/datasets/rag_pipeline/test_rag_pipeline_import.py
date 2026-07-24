from unittest.mock import MagicMock, patch

from controllers.console import console_ns
from controllers.console.datasets.rag_pipeline.rag_pipeline_import import (
    RagPipelineExportApi,
    RagPipelineImportApi,
    RagPipelineImportCheckDependenciesApi,
    RagPipelineImportConfirmApi,
)
from models.dataset import Pipeline
from services.app_dsl_service import ImportStatus


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestRagPipelineImportApi:
    def _payload(self, mode="create"):
        return {
            "mode": mode,
            "yaml_content": "content",
            "name": "Test",
        }

    def test_post_success_200(self, app):
        api = RagPipelineImportApi()
        method = unwrap(api.post)

        payload = self._payload()

        user = MagicMock()
        result = MagicMock()
        result.status = "completed"
        result.model_dump.return_value = {"status": "success"}

        service = MagicMock()
        service.import_rag_pipeline.return_value = result

        fake_db = MagicMock()
        fake_db.engine = MagicMock()

        session_ctx = MagicMock()
        session_ctx.__enter__.return_value = MagicMock()
        session_ctx.__exit__.return_value = None

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.current_account_with_tenant",
                return_value=(user, "tenant"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.db",
                fake_db,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.Session",
                return_value=session_ctx,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api)

        assert status == 200
        assert response == {"status": "success"}

    def test_post_failed_400(self, app):
        api = RagPipelineImportApi()
        method = unwrap(api.post)

        payload = self._payload()

        user = MagicMock()
        result = MagicMock()
        result.status = ImportStatus.FAILED
        result.model_dump.return_value = {"status": "failed"}

        service = MagicMock()
        service.import_rag_pipeline.return_value = result

        fake_db = MagicMock()
        fake_db.engine = MagicMock()

        session_ctx = MagicMock()
        session_ctx.__enter__.return_value = MagicMock()
        session_ctx.__exit__.return_value = None

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.current_account_with_tenant",
                return_value=(user, "tenant"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.db",
                fake_db,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.Session",
                return_value=session_ctx,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api)

        assert status == 400
        assert response == {"status": "failed"}

    def test_post_pending_202(self, app):
        api = RagPipelineImportApi()
        method = unwrap(api.post)

        payload = self._payload()

        user = MagicMock()
        result = MagicMock()
        result.status = ImportStatus.PENDING
        result.model_dump.return_value = {"status": "pending"}

        service = MagicMock()
        service.import_rag_pipeline.return_value = result

        fake_db = MagicMock()
        fake_db.engine = MagicMock()

        session_ctx = MagicMock()
        session_ctx.__enter__.return_value = MagicMock()
        session_ctx.__exit__.return_value = None

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.current_account_with_tenant",
                return_value=(user, "tenant"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.db",
                fake_db,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.Session",
                return_value=session_ctx,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api)

        assert status == 202
        assert response == {"status": "pending"}


class TestRagPipelineImportConfirmApi:
    def test_confirm_success(self, app):
        api = RagPipelineImportConfirmApi()
        method = unwrap(api.post)

        user = MagicMock()
        result = MagicMock()
        result.status = "completed"
        result.model_dump.return_value = {"ok": True}

        service = MagicMock()
        service.confirm_import.return_value = result

        fake_db = MagicMock()
        fake_db.engine = MagicMock()

        session_ctx = MagicMock()
        session_ctx.__enter__.return_value = MagicMock()
        session_ctx.__exit__.return_value = None

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.current_account_with_tenant",
                return_value=(user, "tenant"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.db",
                fake_db,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.Session",
                return_value=session_ctx,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, "import-1")

        assert status == 200
        assert response == {"ok": True}

    def test_confirm_failed(self, app):
        api = RagPipelineImportConfirmApi()
        method = unwrap(api.post)

        user = MagicMock()
        result = MagicMock()
        result.status = ImportStatus.FAILED
        result.model_dump.return_value = {"ok": False}

        service = MagicMock()
        service.confirm_import.return_value = result

        fake_db = MagicMock()
        fake_db.engine = MagicMock()

        session_ctx = MagicMock()
        session_ctx.__enter__.return_value = MagicMock()
        session_ctx.__exit__.return_value = None

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.current_account_with_tenant",
                return_value=(user, "tenant"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.db",
                fake_db,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.Session",
                return_value=session_ctx,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, "import-1")

        assert status == 400
        assert response == {"ok": False}


class TestRagPipelineImportCheckDependenciesApi:
    def test_get_success(self, app):
        api = RagPipelineImportCheckDependenciesApi()
        method = unwrap(api.get)

        pipeline = MagicMock(spec=Pipeline)
        result = MagicMock()
        result.model_dump.return_value = {"deps": []}

        service = MagicMock()
        service.check_dependencies.return_value = result

        fake_db = MagicMock()
        fake_db.engine = MagicMock()

        session_ctx = MagicMock()
        session_ctx.__enter__.return_value = MagicMock()
        session_ctx.__exit__.return_value = None

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.db",
                fake_db,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.Session",
                return_value=session_ctx,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, pipeline)

        assert status == 200
        assert response == {"deps": []}


class TestRagPipelineExportApi:
    def test_get_with_include_secret(self, app):
        api = RagPipelineExportApi()
        method = unwrap(api.get)

        pipeline = MagicMock(spec=Pipeline)
        service = MagicMock()
        service.export_rag_pipeline_dsl.return_value = {"yaml": "data"}

        fake_db = MagicMock()
        fake_db.engine = MagicMock()

        session_ctx = MagicMock()
        session_ctx.__enter__.return_value = MagicMock()
        session_ctx.__exit__.return_value = None

        with (
            app.test_request_context("/?include_secret=true"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.db",
                fake_db,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.Session",
                return_value=session_ctx,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_import.RagPipelineDslService",
                return_value=service,
            ),
        ):
            response, status = method(api, pipeline)

        assert status == 200
        assert response == {"data": {"yaml": "data"}}
