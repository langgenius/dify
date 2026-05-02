"""Testcontainers integration tests for rag_pipeline controller endpoints."""

from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session

from controllers.console import console_ns
from controllers.console.datasets.rag_pipeline.rag_pipeline import (
    CustomizedPipelineTemplateApi,
    PipelineTemplateDetailApi,
    PipelineTemplateListApi,
    PublishCustomizedPipelineTemplateApi,
)
from models.dataset import PipelineCustomizedTemplate


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestPipelineTemplateListApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

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
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

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

    def test_get_returns_404_when_template_not_found(self, app):
        api = PipelineTemplateDetailApi()
        method = unwrap(api.get)

        service = MagicMock()
        service.get_pipeline_template_detail.return_value = None

        with (
            app.test_request_context("/?type=built-in"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService",
                return_value=service,
            ),
        ):
            response, status = method(api, "non-existent-id")

        assert status == 404
        assert "error" in response

    def test_get_returns_404_for_customized_type_not_found(self, app):
        api = PipelineTemplateDetailApi()
        method = unwrap(api.get)

        service = MagicMock()
        service.get_pipeline_template_detail.return_value = None

        with (
            app.test_request_context("/?type=customized"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService",
                return_value=service,
            ),
        ):
            response, status = method(api, "non-existent-id")

        assert status == 404
        assert "error" in response


class TestCustomizedPipelineTemplateApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

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

    def test_post_success(self, app, db_session_with_containers: Session):
        api = CustomizedPipelineTemplateApi()
        method = unwrap(api.post)

        tenant_id = str(uuid4())
        template = PipelineCustomizedTemplate(
            tenant_id=tenant_id,
            name="Test Template",
            description="Test",
            chunk_structure="hierarchical",
            icon={"icon": "📘"},
            position=0,
            yaml_content="yaml-data",
            install_count=0,
            language="en-US",
            created_by=str(uuid4()),
        )
        db_session_with_containers.add(template)
        db_session_with_containers.commit()
        db_session_with_containers.expire_all()

        with app.test_request_context("/"):
            response, status = method(api, template.id)

        assert status == 200
        assert response == {"data": "yaml-data"}

    def test_post_template_not_found(self, app):
        api = CustomizedPipelineTemplateApi()
        method = unwrap(api.post)

        with app.test_request_context("/"):
            with pytest.raises(ValueError):
                method(api, str(uuid4()))


class TestPublishCustomizedPipelineTemplateApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

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
