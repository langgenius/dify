from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console import console_ns
from controllers.console.datasets.rag_pipeline.datasource_content_preview import (
    DataSourceContentPreviewApi,
)
from models import Account
from models.dataset import Pipeline


def make_account() -> Account:
    account = Account(name="Test User", email="user@example.com")
    account.id = "account-1"
    return account


class TestDataSourceContentPreviewApi:
    def _valid_payload(self):
        return {
            "inputs": {"query": "hello"},
            "datasource_type": "notion",
            "credential_id": "cred-1",
        }

    def test_post_success(self, app: Flask):
        api = DataSourceContentPreviewApi()
        method = unwrap(api.post)

        payload = self._valid_payload()

        pipeline = MagicMock(spec=Pipeline)
        node_id = "node-1"
        account = make_account()

        preview_result = {"content": "preview data"}

        service_instance = MagicMock()
        service_instance.run_datasource_node_preview.return_value = preview_result

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_content_preview.RagPipelineService",
                return_value=service_instance,
            ),
        ):
            response, status = method(api, account, pipeline, node_id)

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

    def test_post_invalid_payload(self, app: Flask):
        api = DataSourceContentPreviewApi()
        method = unwrap(api.post)

        payload = {
            "inputs": {"query": "hello"},
            # datasource_type missing
        }

        pipeline = MagicMock(spec=Pipeline)
        account = make_account()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            with pytest.raises(ValueError):
                method(api, account, pipeline, "node-1")

    def test_post_without_credential_id(self, app: Flask):
        api = DataSourceContentPreviewApi()
        method = unwrap(api.post)

        payload = {
            "inputs": {"query": "hello"},
            "datasource_type": "notion",
            "credential_id": None,
        }

        pipeline = MagicMock(spec=Pipeline)
        account = make_account()

        service_instance = MagicMock()
        service_instance.run_datasource_node_preview.return_value = {"ok": True}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_content_preview.RagPipelineService",
                return_value=service_instance,
            ),
        ):
            response, status = method(api, account, pipeline, "node-1")

        service_instance.run_datasource_node_preview.assert_called_once()
        assert status == 200
        assert response == {"ok": True}
