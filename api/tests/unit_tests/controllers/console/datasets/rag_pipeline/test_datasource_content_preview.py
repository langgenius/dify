from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden

from controllers.console import console_ns
from controllers.console.datasets.rag_pipeline.datasource_content_preview import (
    DataSourceContentPreviewApi,
)
from models import Account
from models.dataset import Pipeline


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestDataSourceContentPreviewApi:
    def _valid_payload(self):
        return {
            "inputs": {"query": "hello"},
            "datasource_type": "notion",
            "credential_id": "cred-1",
        }

    def test_post_success(self, app):
        api = DataSourceContentPreviewApi()
        method = unwrap(api.post)

        payload = self._valid_payload()

        pipeline = MagicMock(spec=Pipeline)
        node_id = "node-1"
        account = MagicMock(spec=Account)

        preview_result = {"content": "preview data"}

        service_instance = MagicMock()
        service_instance.run_datasource_node_preview.return_value = preview_result

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_content_preview.current_user",
                account,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_content_preview.RagPipelineService",
                return_value=service_instance,
            ),
        ):
            response, status = method(api, pipeline, node_id)

        service_instance.run_datasource_node_preview.assert_called_once_with(
            pipeline=pipeline,
            node_id=node_id,
            user_inputs=payload["inputs"],
            account=account,
            datasource_type=payload["datasource_type"],
            is_published=True,
            credential_id=payload["credential_id"],
        )
        assert status == 200
        assert response == preview_result

    def test_post_forbidden_non_account_user(self, app):
        api = DataSourceContentPreviewApi()
        method = unwrap(api.post)

        payload = self._valid_payload()

        pipeline = MagicMock(spec=Pipeline)

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_content_preview.current_user",
                MagicMock(),  # NOT Account
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, pipeline, "node-1")

    def test_post_invalid_payload(self, app):
        api = DataSourceContentPreviewApi()
        method = unwrap(api.post)

        payload = {
            "inputs": {"query": "hello"},
            # datasource_type missing
        }

        pipeline = MagicMock(spec=Pipeline)
        account = MagicMock(spec=Account)

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_content_preview.current_user",
                account,
            ),
        ):
            with pytest.raises(ValueError):
                method(api, pipeline, "node-1")

    def test_post_without_credential_id(self, app):
        api = DataSourceContentPreviewApi()
        method = unwrap(api.post)

        payload = {
            "inputs": {"query": "hello"},
            "datasource_type": "notion",
            "credential_id": None,
        }

        pipeline = MagicMock(spec=Pipeline)
        account = MagicMock(spec=Account)

        service_instance = MagicMock()
        service_instance.run_datasource_node_preview.return_value = {"ok": True}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_content_preview.current_user",
                account,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_content_preview.RagPipelineService",
                return_value=service_instance,
            ),
        ):
            response, status = method(api, pipeline, "node-1")

        service_instance.run_datasource_node_preview.assert_called_once()
        assert status == 200
        assert response == {"ok": True}
