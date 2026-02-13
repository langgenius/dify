"""Endpoint-level tests for rag pipeline workflow controller."""

from __future__ import annotations

import builtins
import datetime as dt
import importlib
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask
from flask.views import MethodView

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]

from libs.helper import TimestampField


@pytest.fixture
def app() -> Flask:
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture
def controller_module(monkeypatch: pytest.MonkeyPatch):
    from controllers.console import wraps as console_wraps
    from controllers.console.datasets import wraps as dataset_wraps
    from libs import login

    def _noop_decorator(func):
        return func

    monkeypatch.setattr(login, "login_required", _noop_decorator)
    monkeypatch.setattr(console_wraps, "setup_required", _noop_decorator)
    monkeypatch.setattr(console_wraps, "account_initialization_required", _noop_decorator)
    monkeypatch.setattr(console_wraps, "edit_permission_required", _noop_decorator)
    monkeypatch.setattr(dataset_wraps, "get_rag_pipeline", _noop_decorator)

    module_name = "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow"
    sys.modules.pop(module_name, None)
    return importlib.import_module(module_name)


def _mock_user() -> SimpleNamespace:
    return SimpleNamespace(id="acc-1")


def test_sync_draft_workflow_from_json_payload(app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch):
    user = _mock_user()
    monkeypatch.setattr(controller_module, "current_account_with_tenant", lambda: (user, "tenant-1"))

    env_builder = MagicMock(side_effect=lambda mapping: {"env": mapping["key"]})
    conv_builder = MagicMock(side_effect=lambda mapping: {"conv": mapping["title"]})
    monkeypatch.setattr(controller_module.variable_factory, "build_environment_variable_from_mapping", env_builder)
    monkeypatch.setattr(controller_module.variable_factory, "build_conversation_variable_from_mapping", conv_builder)

    workflow = SimpleNamespace(
        unique_hash="hash-1", updated_at=dt.datetime.now(dt.UTC), created_at=dt.datetime.now(dt.UTC)
    )
    service = MagicMock()
    service.sync_draft_workflow.return_value = workflow
    monkeypatch.setattr(controller_module, "RagPipelineService", lambda: service)

    pipeline = SimpleNamespace(id="pipe-1")
    payload = {
        "graph": {"nodes": []},
        "hash": "seed-hash",
        "environment_variables": [{"key": "API_KEY"}],
        "conversation_variables": [{"title": "question"}],
        "rag_pipeline_variables": [{"name": "foo"}],
        "features": {"trace": True},
    }

    with app.test_request_context(
        "/rag/pipelines/pipe-1/workflows/draft",
        method="POST",
        json=payload,
    ):
        response = controller_module.DraftRagPipelineApi().post(pipeline=pipeline)

    assert response["result"] == "success"
    assert response["hash"] == "hash-1"
    assert response["updated_at"] == TimestampField().format(workflow.updated_at)

    service.sync_draft_workflow.assert_called_once_with(
        pipeline=pipeline,
        graph={"nodes": []},
        unique_hash="seed-hash",
        account=user,
        environment_variables=[{"env": "API_KEY"}],
        conversation_variables=[{"conv": "question"}],
        rag_pipeline_variables=[{"name": "foo"}],
    )


def test_published_workflow_run_uses_expected_invoke_mode(
    app: Flask, controller_module, monkeypatch: pytest.MonkeyPatch
):
    user = _mock_user()
    monkeypatch.setattr(controller_module, "current_account_with_tenant", lambda: (user, "tenant-1"))

    generate_mock = MagicMock(return_value={"stream": True})
    monkeypatch.setattr(controller_module.PipelineGenerateService, "generate", generate_mock)
    monkeypatch.setattr(controller_module.helper, "compact_generate_response", lambda data: {"wrapped": data})

    pipeline = SimpleNamespace(id="pipe-2")
    payload = {
        "inputs": {"q": "hi"},
        "datasource_type": "dataset",
        "datasource_info_list": [],
        "start_node_id": "start",
        "is_preview": False,
        "response_mode": "blocking",
    }

    with app.test_request_context(
        "/rag/pipelines/pipe-2/workflows/published/run",
        method="POST",
        json=payload,
    ):
        response = controller_module.PublishedRagPipelineRunApi().post(pipeline=pipeline)

    assert response == {"wrapped": {"stream": True}}
    generate_mock.assert_called_once_with(
        pipeline=pipeline,
        user=user,
        args=payload,
        invoke_from=controller_module.InvokeFrom.PUBLISHED,
        streaming=False,
    )
