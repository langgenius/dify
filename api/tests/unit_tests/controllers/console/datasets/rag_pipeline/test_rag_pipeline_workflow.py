from __future__ import annotations

from datetime import datetime
from inspect import unwrap as unwrap_all
from types import SimpleNamespace
from unittest.mock import PropertyMock, patch

import pytest
from flask import Flask

from controllers.console.datasets.rag_pipeline import rag_pipeline_workflow as module
from models.account import Account, TenantAccountRole
from models.dataset import Pipeline


def _make_workflow(**overrides):
    workflow = SimpleNamespace(
        id="workflow-1",
        graph_dict={"nodes": [], "edges": []},
        features_dict={"file_upload": {"enabled": False}},
        unique_hash="hash-1",
        version="1",
        marked_name="Release 1",
        marked_comment="Initial release",
        created_by_account=SimpleNamespace(id="user-1", name="Alice", email="alice@example.com"),
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
        lambda *_args, **_kwargs: SimpleNamespace(get_draft_workflow=lambda **_kwargs: workflow),
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
    app, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = module.PublishedAllRagPipelineApi()
    handler = unwrap_all(api.get)
    session_state = {"open": False}

    class _SessionContext:
        def __enter__(self):
            session_state["open"] = True
            return object()

        def __exit__(self, exc_type, exc, tb):
            session_state["open"] = False
            return False

    class _SessionMaker:
        def begin(self):
            return _SessionContext()

    base_workflow = _make_workflow()

    class _Workflow:
        def __getattr__(self, name: str):
            assert session_state["open"] is True
            return getattr(base_workflow, name)

    monkeypatch.setattr(module, "db", SimpleNamespace(engine=object(), session=lambda: object()))
    monkeypatch.setattr(module, "sessionmaker", lambda *_args, **_kwargs: _SessionMaker())
    monkeypatch.setattr(
        module,
        "RagPipelineService",
        lambda *_args, **_kwargs: SimpleNamespace(get_all_published_workflow=lambda **_kwargs: ([_Workflow()], False)),
    )

    with app.test_request_context(
        "/rag/pipelines/pipeline-1/workflows",
        method="GET",
        query_string={"page": 1, "limit": 10, "user_id": "", "named_only": "false"},
    ):
        response = handler(api, _account(), pipeline=_pipeline())

    assert response["items"][0]["id"] == "workflow-1"
    assert response["page"] == 1
    assert response["limit"] == 10
    assert response["has_more"] is False


def test_rag_pipeline_workflow_patch_serializes_response_model(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = _make_workflow(marked_name="Updated release")

    class _SessionContext:
        def __enter__(self):
            return object()

        def __exit__(self, exc_type, exc, tb):
            return False

    class _SessionMaker:
        def begin(self):
            return _SessionContext()

    monkeypatch.setattr(module, "db", SimpleNamespace(engine=object(), session=lambda: object()))
    monkeypatch.setattr(module, "sessionmaker", lambda *_args, **_kwargs: _SessionMaker())
    monkeypatch.setattr(
        module,
        "RagPipelineService",
        lambda *_args, **_kwargs: SimpleNamespace(update_workflow=lambda **_kwargs: workflow),
    )
    payload: dict[str, object] = {"marked_name": "Updated release"}

    api = module.RagPipelineByIdApi()
    handler = unwrap_all(api.patch)

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

    assert response["id"] == "workflow-1"
    assert response["marked_name"] == "Updated release"
    assert response["hash"] == "hash-1"


def test_default_rag_pipeline_block_configs_serializes_root_response(monkeypatch: pytest.MonkeyPatch) -> None:
    block_configs = [{"type": "start", "config": {"title": "Start"}}]
    monkeypatch.setattr(
        module,
        "RagPipelineService",
        lambda *_args, **_kwargs: SimpleNamespace(get_default_block_configs=lambda: block_configs),
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
        lambda *_args, **_kwargs: SimpleNamespace(get_second_step_parameters=lambda **_kwargs: variables),
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
        lambda *_args, **_kwargs: SimpleNamespace(get_recommended_plugins=lambda *_args: recommended_plugins),
    )

    api = module.RagPipelineRecommendedPluginApi()
    handler = unwrap_all(api.get)

    with app.test_request_context("/?type=tool"):
        response = handler(api, "tenant-1", _account())

    assert response == recommended_plugins
