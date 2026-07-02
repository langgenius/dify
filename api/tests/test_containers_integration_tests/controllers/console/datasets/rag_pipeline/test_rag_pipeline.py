"""Testcontainers integration tests for rag_pipeline controller endpoints."""

from __future__ import annotations

from collections.abc import Callable
from inspect import unwrap
from typing import cast
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.common.schema import JsonResponseWithStatus
from controllers.console import console_ns
from controllers.console.datasets.rag_pipeline.rag_pipeline import (
    CustomizedPipelineTemplateApi,
    PipelineTemplateDetailApi,
    PipelineTemplateListApi,
    PublishCustomizedPipelineTemplateApi,
)
from models.account import Account
from models.dataset import PipelineCustomizedTemplate


class TestPipelineTemplateListApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_get_success(self, app: Flask) -> None:
        api = PipelineTemplateListApi()
        method = unwrap(api.get)

        templates = {
            "pipeline_templates": [
                {
                    "id": "t1",
                    "name": "Template",
                    "description": "Description",
                    "icon": {"icon": "📘", "icon_type": "emoji", "icon_background": "#fff"},
                    "position": 1,
                    "chunk_structure": "general",
                }
            ]
        }

        with (
            app.test_request_context("/?type=built-in&language=en-US"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService.get_pipeline_templates",
                return_value=templates,
            ),
        ):
            response, status = method(api, MagicMock(spec=Session), str(uuid4()))

        assert status == 200
        assert response == {
            "pipeline_templates": [
                {
                    **templates["pipeline_templates"][0],
                    "copyright": None,
                    "privacy_policy": None,
                }
            ]
        }


class TestPipelineTemplateDetailApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_get_success(self, app: Flask) -> None:
        api = PipelineTemplateDetailApi()
        method = unwrap(api.get)

        nodes: list[dict[str, object]] = []
        edges: list[dict[str, object]] = []
        viewport: dict[str, int] = {"x": 0, "y": 0, "zoom": 1}
        template = {
            "id": "tpl-1",
            "name": "Template",
            "icon_info": {"icon": "📘", "icon_type": "emoji", "icon_background": "#fff"},
            "description": "Description",
            "chunk_structure": "general",
            "export_data": "yaml-data",
            "graph": {"nodes": nodes, "edges": edges, "viewport": viewport},
        }

        service = MagicMock()
        service.get_pipeline_template_detail.return_value = template

        with (
            app.test_request_context("/?type=built-in"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService",
                return_value=service,
            ),
        ):
            response, status = method(api, MagicMock(spec=Session), "tpl-1")

        assert status == 200
        assert response == {**template, "created_by": None}

    def test_get_returns_404_when_template_not_found(self, app: Flask) -> None:
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
            with pytest.raises(NotFound):
                method(api, MagicMock(spec=Session), "non-existent-id")

    def test_get_returns_404_for_customized_type_not_found(self, app: Flask) -> None:
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
            with pytest.raises(NotFound):
                method(api, MagicMock(spec=Session), "non-existent-id")


class TestCustomizedPipelineTemplateApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_patch_success(self, app: Flask) -> None:
        api = CustomizedPipelineTemplateApi()
        method = unwrap(api.patch)
        account = Account(name="Test User", email="test@example.com")
        account.id = str(uuid4())
        tenant_id = str(uuid4())

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
            response, status = method(api, tenant_id, account, "tpl-1")

        update_mock.assert_called_once()
        assert update_mock.call_args.args[2] is account
        assert update_mock.call_args.args[3] == tenant_id
        assert status == 204
        assert response == ""

    def test_delete_success(self, app: Flask) -> None:
        api = CustomizedPipelineTemplateApi()
        method = unwrap(api.delete)
        tenant_id = str(uuid4())

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService.delete_customized_pipeline_template"
            ) as delete_mock,
        ):
            response, status = method(api, tenant_id, "tpl-1")

        delete_mock.assert_called_once_with("tpl-1", tenant_id)
        assert status == 204
        assert response == ""

    def test_post_success(self, app: Flask, db_session_with_containers: Session) -> None:
        api = CustomizedPipelineTemplateApi()
        method = unwrap(cast(Callable[..., JsonResponseWithStatus], api.post))

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

    def test_post_template_not_found(self, app: Flask) -> None:
        api = CustomizedPipelineTemplateApi()
        method = unwrap(cast(Callable[..., JsonResponseWithStatus], api.post))

        with app.test_request_context("/"):
            with pytest.raises(ValueError):
                method(api, str(uuid4()))


class TestPublishCustomizedPipelineTemplateApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_post_success(self, app: Flask) -> None:
        api = PublishCustomizedPipelineTemplateApi()
        method = unwrap(api.post)
        account = Account(name="Test User", email="test@example.com")
        account.id = str(uuid4())
        tenant_id = str(uuid4())

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
            response, status = method(api, tenant_id, account, "pipeline-1")

        service.publish_customized_pipeline_template.assert_called_once()
        assert service.publish_customized_pipeline_template.call_args.args[2] is account
        assert service.publish_customized_pipeline_template.call_args.args[3] == tenant_id
        assert status == 204
        assert response == ""
