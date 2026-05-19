from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import PropertyMock, patch

import pytest

from controllers.console.datasets.rag_pipeline import rag_pipeline_workflow as module


def _unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


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


def test_draft_rag_pipeline_workflow_get_serializes_response_model(monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = _make_workflow()
    monkeypatch.setattr(
        module, "RagPipelineService", lambda: SimpleNamespace(get_draft_workflow=lambda **_kwargs: workflow)
    )

    api = module.DraftRagPipelineApi()
    handler = _unwrap(api.get)

    response = handler(api, pipeline=SimpleNamespace(id="pipeline-1"))

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
    handler = _unwrap(api.get)
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

    monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(module, "sessionmaker", lambda *_args, **_kwargs: _SessionMaker())
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (SimpleNamespace(id="user-1"), "tenant-1"))
    monkeypatch.setattr(
        module,
        "RagPipelineService",
        lambda: SimpleNamespace(get_all_published_workflow=lambda **_kwargs: ([_Workflow()], False)),
    )

    with app.test_request_context(
        "/rag/pipelines/pipeline-1/workflows",
        method="GET",
        query_string={"page": 1, "limit": 10, "user_id": "", "named_only": "false"},
    ):
        response = handler(api, pipeline=SimpleNamespace(id="pipeline-1"))

    assert response["items"][0]["id"] == "workflow-1"
    assert response["page"] == 1
    assert response["limit"] == 10
    assert response["has_more"] is False


def test_rag_pipeline_workflow_patch_serializes_response_model(app, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = _make_workflow(marked_name="Updated release")
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (SimpleNamespace(id="user-1"), "tenant-1"))

    class _SessionContext:
        def __enter__(self):
            return object()

        def __exit__(self, exc_type, exc, tb):
            return False

    class _SessionMaker:
        def begin(self):
            return _SessionContext()

    monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(module, "sessionmaker", lambda *_args, **_kwargs: _SessionMaker())
    monkeypatch.setattr(
        module,
        "RagPipelineService",
        lambda: SimpleNamespace(update_workflow=lambda **_kwargs: workflow),
    )
    payload: dict[str, object] = {"marked_name": "Updated release"}

    api = module.RagPipelineByIdApi()
    handler = _unwrap(api.patch)

    with (
        app.test_request_context("/rag/pipelines/pipeline-1/workflows/workflow-1", method="PATCH", json=payload),
        patch.object(type(module.console_ns), "payload", new_callable=PropertyMock, return_value=payload),
    ):
        response = handler(
            api,
            pipeline=SimpleNamespace(id="pipeline-1", tenant_id="tenant-1"),
            workflow_id="workflow-1",
        )

    assert response["id"] == "workflow-1"
    assert response["marked_name"] == "Updated release"
    assert response["hash"] == "hash-1"
