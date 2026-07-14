"""RAG pipeline workflow controller serialization tests.

Handlers that own transactions run against real SQLite sessions so response
DTOs must be materialized before those transaction contexts close.
"""

from __future__ import annotations

from datetime import datetime
from inspect import unwrap as unwrap_all
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, patch
from uuid import UUID

import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from controllers.console.datasets.rag_pipeline import rag_pipeline_workflow as module
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from models.account import Account, TenantAccountRole
from models.dataset import Pipeline
from services.errors.llm import InvokeRateLimitError
from services.rag_pipeline.rag_pipeline import RagPipelineService


def _make_workflow(**overrides):
    author = Account(name="Alice", email="alice@example.com")
    author.id = "user-1"
    workflow = SimpleNamespace(
        id="workflow-1",
        graph_dict={"nodes": [], "edges": []},
        features_dict={"file_upload": {"enabled": False}},
        unique_hash="hash-1",
        version="1",
        marked_name="Release 1",
        marked_comment="Initial release",
        created_by_account=author,
        created_at=datetime(2024, 1, 1, 12, 0, 0),
        updated_by_account=None,
        updated_at=datetime(2024, 1, 1, 12, 1, 0),
        tool_published=False,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    for key, value in overrides.items():
        setattr(workflow, key, value)
    return workflow


def _rag_pipeline_service(**methods):
    service = object.__new__(RagPipelineService)
    for name, method in methods.items():
        setattr(service, name, method)
    return service


def _account() -> Account:
    account = Account(name="Alice", email="alice@example.com")
    account.id = "user-1"
    account.role = TenantAccountRole.EDITOR
    return account


def _pipeline() -> Pipeline:
    pipeline = Pipeline(tenant_id="tenant-1", name="Pipeline", description="desc")
    pipeline.id = "pipeline-1"
    return pipeline


def test_draft_rag_pipeline_workflow_get_serializes_response_model(monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = _make_workflow()
    monkeypatch.setattr(
        module,
        "RagPipelineService",
        lambda *_args, **_kwargs: _rag_pipeline_service(get_draft_workflow=lambda **_kwargs: workflow),
    )

    api = module.DraftRagPipelineApi()
    handler = unwrap_all(api.get)

    response = handler(api, _pipeline())

    assert response["id"] == "workflow-1"
    assert response["graph"] == {"nodes": [], "edges": []}
    assert response["features"] == {"file_upload": {"enabled": False}}
    assert response["hash"] == "hash-1"
    assert response["created_by"] == {"id": "user-1", "name": "Alice", "email": "alice@example.com"}
    assert response["updated_by"] is None
    assert response["created_at"] == int(datetime(2024, 1, 1, 12, 0, 0).timestamp())
    assert response["updated_at"] == int(datetime(2024, 1, 1, 12, 1, 0).timestamp())


def test_published_rag_pipeline_workflows_serialize_items_before_session_closes(
    app, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    api = module.PublishedAllRagPipelineApi()
    handler = unwrap_all(api.get)
    session_state: dict[str, Session] = {}

    base_workflow = _make_workflow()

    class _Workflow:
        def __getattr__(self, name: str):
            assert session_state["session"].in_transaction() is True
            return getattr(base_workflow, name)

    def _get_all_published_workflow(**kwargs):
        session_state["session"] = kwargs["session"]
        return [_Workflow()], False

    monkeypatch.setattr(
        module,
        "RagPipelineService",
        lambda *_args, **_kwargs: _rag_pipeline_service(get_all_published_workflow=_get_all_published_workflow),
    )

    with Session(sqlite_engine) as request_session:
        monkeypatch.setattr(module, "db", SimpleNamespace(engine=sqlite_engine, session=lambda: request_session))
        with app.test_request_context(
            "/rag/pipelines/pipeline-1/workflows",
            method="GET",
            query_string={"page": 1, "limit": 10, "user_id": "", "named_only": "false"},
        ):
            response = handler(api, _account(), pipeline=_pipeline())

    assert session_state["session"].in_transaction() is False
    assert response["items"][0]["id"] == "workflow-1"
    assert response["page"] == 1
    assert response["limit"] == 10
    assert response["has_more"] is False


def test_rag_pipeline_workflow_patch_serializes_response_model(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    workflow = _make_workflow(marked_name="Updated release")
    captured_session: dict[str, Session] = {}

    def _update_workflow(**kwargs):
        captured_session["session"] = kwargs["session"]
        assert kwargs["session"].in_transaction() is True
        return workflow

    monkeypatch.setattr(
        module,
        "RagPipelineService",
        lambda *_args, **_kwargs: _rag_pipeline_service(update_workflow=_update_workflow),
    )
    payload: dict[str, object] = {"marked_name": "Updated release"}

    api = module.RagPipelineByIdApi()
    handler = unwrap_all(api.patch)

    with Session(sqlite_engine) as request_session:
        monkeypatch.setattr(module, "db", SimpleNamespace(engine=sqlite_engine, session=lambda: request_session))
        with (
            app.test_request_context("/rag/pipelines/pipeline-1/workflows/workflow-1", method="PATCH", json=payload),
            patch.object(type(module.console_ns), "payload", new_callable=PropertyMock, return_value=payload),
        ):
            response = handler(
                api,
                _account(),
                pipeline=_pipeline(),
                workflow_id="workflow-1",
            )

    assert captured_session["session"].in_transaction() is False
    assert response["id"] == "workflow-1"
    assert response["marked_name"] == "Updated release"
    assert response["hash"] == "hash-1"


def test_default_rag_pipeline_block_configs_serializes_root_response(monkeypatch: pytest.MonkeyPatch) -> None:
    block_configs = [{"type": "start", "config": {"title": "Start"}}]
    monkeypatch.setattr(
        module,
        "RagPipelineService",
        lambda *_args, **_kwargs: _rag_pipeline_service(get_default_block_configs=lambda: block_configs),
    )

    api = module.DefaultRagPipelineBlockConfigsApi()
    handler = unwrap_all(api.get)

    response = handler(api, _pipeline())

    assert response == block_configs


def test_draft_rag_pipeline_second_step_parameters_serializes_variables(app, monkeypatch: pytest.MonkeyPatch) -> None:
    variables = [
        {
            "belong_to_node_id": "shared",
            "type": "number",
            "label": "Chunk size",
            "variable": "chunk_size",
            "default_value": 1024,
            "required": True,
        }
    ]
    monkeypatch.setattr(
        module,
        "RagPipelineService",
        lambda *_args, **_kwargs: _rag_pipeline_service(get_second_step_parameters=lambda **_kwargs: variables),
    )

    api = module.DraftRagPipelineSecondStepApi()
    handler = unwrap_all(api.get)

    with app.test_request_context("/?node_id=node-1"):
        response = handler(api, _pipeline())

    assert response["variables"] == variables


def test_rag_pipeline_recommended_plugins_serializes_known_envelope(app, monkeypatch: pytest.MonkeyPatch) -> None:
    recommended_plugins = {
        "installed_recommended_plugins": [{"name": "Dify Extractor", "meta": {"version": "1.0.0"}}],
        "uninstalled_recommended_plugins": [{"plugin_id": "langgenius/notion_datasource"}],
    }
    monkeypatch.setattr(
        module,
        "RagPipelineService",
        lambda *_args, **_kwargs: _rag_pipeline_service(get_recommended_plugins=lambda *_args: recommended_plugins),
    )

    api = module.RagPipelineRecommendedPluginApi()
    handler = unwrap_all(api.get)

    with app.test_request_context("/?type=tool"):
        response = handler(api, "tenant-1", _account())

    assert response == recommended_plugins


def test_rag_pipeline_transform_rejects_read_only_member(app: Flask, sqlite_engine: Engine) -> None:
    account = _account()
    account.role = TenantAccountRole.NORMAL
    api = module.RagPipelineTransformApi()
    handler = unwrap_all(api.post)

    with (
        Session(sqlite_engine) as session,
        app.test_request_context("/"),
        pytest.raises(Forbidden),
    ):
        handler(api, session, account, UUID("44444444-4444-4444-4444-444444444444"))


@pytest.mark.parametrize(
    ("api_type", "payload"),
    [
        (
            module.DraftRagPipelineRunApi,
            {"inputs": {}, "datasource_type": "x", "datasource_info_list": [], "start_node_id": "node-1"},
        ),
        (
            module.PublishedRagPipelineRunApi,
            {
                "inputs": {},
                "datasource_type": "x",
                "datasource_info_list": [],
                "start_node_id": "node-1",
                "response_mode": "blocking",
            },
        ),
    ],
)
def test_rag_pipeline_run_uses_sqlite_session(
    app: Flask,
    sqlite_engine: Engine,
    api_type: type,
    payload: dict[str, object],
) -> None:
    api = api_type()
    handler = unwrap_all(api.post)
    pipeline = _pipeline()

    with (
        Session(sqlite_engine) as session,
        app.test_request_context("/", json=payload),
        patch.object(type(module.console_ns), "payload", payload),
        patch.object(module, "load_rag_pipeline", return_value=pipeline) as load_pipeline,
        patch.object(module.PipelineGenerateService, "generate", return_value=MagicMock()) as generate,
        patch.object(module.helper, "compact_generate_response", return_value={"ok": True}),
    ):
        response = handler(api, session, _account(), pipeline.id)

    assert response == {"ok": True}
    load_pipeline.assert_called_once_with(session, pipeline.id)
    assert generate.call_args.kwargs["session"] is session
    assert session.get_bind() is sqlite_engine


@pytest.mark.parametrize("api_type", [module.DraftRagPipelineRunApi, module.PublishedRagPipelineRunApi])
def test_rag_pipeline_run_translates_rate_limit(
    app: Flask,
    sqlite_engine: Engine,
    api_type: type,
) -> None:
    payload = {
        "inputs": {},
        "datasource_type": "x",
        "datasource_info_list": [],
        "start_node_id": "node-1",
    }
    api = api_type()
    handler = unwrap_all(api.post)
    pipeline = _pipeline()

    with (
        Session(sqlite_engine) as session,
        app.test_request_context("/", json=payload),
        patch.object(type(module.console_ns), "payload", payload),
        patch.object(module, "load_rag_pipeline", return_value=pipeline),
        patch.object(module.PipelineGenerateService, "generate", side_effect=InvokeRateLimitError("limit")),
        pytest.raises(InvokeRateLimitHttpError),
    ):
        handler(api, session, _account(), pipeline.id)
