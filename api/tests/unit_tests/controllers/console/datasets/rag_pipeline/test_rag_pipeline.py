from unittest.mock import MagicMock, patch

import pytest

from controllers.console import console_ns
from controllers.console.datasets.rag_pipeline.rag_pipeline import (
    CustomizedPipelineTemplateApi,
    PipelineTemplateDetailApi,
    PipelineTemplateListApi,
    PublishCustomizedPipelineTemplateApi,
)


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestPipelineTemplateListApi:
    def test_get_success(self, app):
        api = PipelineTemplateListApi()
        method = unwrap(api.get)

        templates = [{"id": "t1"}]

        with (
            app.test_request_context("/?type=built-in&language=en-US"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService.get_pipeline_templates",
                return_value=templates,
            ),
        ):
            response, status = method(api)

        assert status == 200
        assert response == templates


class TestPipelineTemplateDetailApi:
    def test_get_success(self, app):
        api = PipelineTemplateDetailApi()
        method = unwrap(api.get)

        template = {"id": "tpl-1"}

        service = MagicMock()
        service.get_pipeline_template_detail.return_value = template

        with (
            app.test_request_context("/?type=built-in"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService",
                return_value=service,
            ),
        ):
            response, status = method(api, "tpl-1")

        assert status == 200
        assert response == template


class TestCustomizedPipelineTemplateApi:
    def test_patch_success(self, app):
        api = CustomizedPipelineTemplateApi()
        method = unwrap(api.patch)

        payload = {
            "name": "Template",
            "description": "Desc",
            "icon_info": {"icon": "📘"},
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService.update_customized_pipeline_template"
            ) as update_mock,
        ):
            response = method(api, "tpl-1")

        update_mock.assert_called_once()
        assert response == 200

    def test_delete_success(self, app):
        api = CustomizedPipelineTemplateApi()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService.delete_customized_pipeline_template"
            ) as delete_mock,
        ):
            response = method(api, "tpl-1")

        delete_mock.assert_called_once_with("tpl-1")
        assert response == 200

    def test_post_success(self, app):
        api = CustomizedPipelineTemplateApi()
        method = unwrap(api.post)

        template = MagicMock()
        template.yaml_content = "yaml-data"

        fake_db = MagicMock()
        fake_db.engine = MagicMock()

        session = MagicMock()
        session.query.return_value.where.return_value.first.return_value = template

        session_ctx = MagicMock()
        session_ctx.__enter__.return_value = session
        session_ctx.__exit__.return_value = None

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.db",
                fake_db,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.Session",
                return_value=session_ctx,
            ),
        ):
            response, status = method(api, "tpl-1")

        assert status == 200
        assert response == {"data": "yaml-data"}

    def test_post_template_not_found(self, app):
        api = CustomizedPipelineTemplateApi()
        method = unwrap(api.post)

        fake_db = MagicMock()
        fake_db.engine = MagicMock()

        session = MagicMock()
        session.query.return_value.where.return_value.first.return_value = None

        session_ctx = MagicMock()
        session_ctx.__enter__.return_value = session
        session_ctx.__exit__.return_value = None

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.db",
                fake_db,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.Session",
                return_value=session_ctx,
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "tpl-1")


class TestPublishCustomizedPipelineTemplateApi:
    def test_post_success(self, app):
        api = PublishCustomizedPipelineTemplateApi()
        method = unwrap(api.post)

        payload = {
            "name": "Template",
            "description": "Desc",
            "icon_info": {"icon": "📘"},
        }

        service = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService",
                return_value=service,
            ),
        ):
            response = method(api, "pipeline-1")

        service.publish_customized_pipeline_template.assert_called_once()
        assert response == {"result": "success"}
