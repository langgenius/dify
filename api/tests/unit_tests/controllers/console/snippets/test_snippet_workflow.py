from __future__ import annotations

import json
from datetime import datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from werkzeug.exceptions import HTTPException, NotFound

from controllers.console.snippets import snippet_workflow as snippet_workflow_module
from models.account import Account, TenantAccountRole
from models.snippet import CustomizedSnippet


def _account(account_id: str = "account-1") -> Account:
    account = Account(name="Test User", email=f"{account_id}@example.com")
    account.id = account_id
    account.role = TenantAccountRole.EDITOR
    return account


def _snippet(**overrides) -> CustomizedSnippet:
    data = {
        "id": "snippet-1",
        "tenant_id": "tenant-1",
        "name": "Snippet",
        "description": "Description",
        "type": "node",
        "created_by": "account-1",
    }
    data.update(overrides)
    return CustomizedSnippet(**data)


@pytest.fixture(autouse=True)
def _patch_snippet_service_factory(monkeypatch: pytest.MonkeyPatch) -> None:
    def factory():
        return snippet_workflow_module.SnippetService()

    monkeypatch.setattr(snippet_workflow_module, "_snippet_service", factory)
    monkeypatch.setattr(snippet_workflow_module, "_snippet_session_maker", Mock(return_value=Mock()))


def test_get_snippet_requires_snippet_id(app):
    @snippet_workflow_module.get_snippet
    def view(**kwargs):
        return kwargs

    with app.test_request_context("/snippets"):
        with pytest.raises(ValueError, match="missing snippet_id"):
            view()


def test_get_snippet_injects_resolved_snippet(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    snippet = _snippet()

    @snippet_workflow_module.get_snippet
    def view(**kwargs):
        return kwargs["snippet"]

    monkeypatch.setattr(
        snippet_workflow_module,
        "current_account_with_tenant",
        lambda: (_account("account-1"), "tenant-1"),
    )
    monkeypatch.setattr(snippet_workflow_module.SnippetService, "get_snippet_by_id", Mock(return_value=snippet))

    with app.test_request_context("/snippets/snippet-1"):
        result = view(snippet_id="snippet-1")

    assert result is snippet


def test_get_snippet_raises_not_found_when_snippet_missing(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    @snippet_workflow_module.get_snippet
    def view(**kwargs):
        return kwargs

    monkeypatch.setattr(
        snippet_workflow_module,
        "current_account_with_tenant",
        lambda: (_account("account-1"), "tenant-1"),
    )
    monkeypatch.setattr(snippet_workflow_module.SnippetService, "get_snippet_by_id", Mock(return_value=None))

    with app.test_request_context("/snippets/snippet-1"):
        with pytest.raises(NotFound, match="Snippet not found"):
            view(snippet_id="snippet-1")


def test_draft_workflow_get_raises_when_missing(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    snippet = _snippet()
    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        lambda: SimpleNamespace(get_draft_workflow=Mock(return_value=None)),
    )

    api = snippet_workflow_module.SnippetDraftWorkflowApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflows/draft"):
        with pytest.raises(snippet_workflow_module.DraftWorkflowNotExist):
            handler(api, snippet=snippet)


def test_draft_workflow_post_returns_400_for_invalid_graph(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    user = _account("account-1")
    snippet = _snippet()
    sync_draft_workflow = Mock(side_effect=ValueError("invalid graph"))
    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        lambda: SimpleNamespace(sync_draft_workflow=sync_draft_workflow),
    )

    api = snippet_workflow_module.SnippetDraftWorkflowApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/draft",
        method="POST",
        json={"graph": {"nodes": [], "edges": []}, "hash": "hash-1"},
    ):
        response, status_code = handler(api, user, snippet)

    assert status_code == 400
    assert response == {"message": "invalid graph"}


def test_draft_config_returns_parallel_depth_limit(app) -> None:
    api = snippet_workflow_module.SnippetDraftConfigApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflows/draft/config"):
        assert handler(api, snippet=SimpleNamespace(id="snippet-1")) == {"parallel_depth_limit": 3}


def test_published_workflow_get_returns_none_when_not_published(app) -> None:
    api = snippet_workflow_module.SnippetPublishedWorkflowApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflows/publish"):
        assert handler(api, snippet=SimpleNamespace(id="snippet-1", is_published=False)) is None


def test_published_workflow_post_returns_400_when_publish_fails(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    user = _account("account-1")
    snippet = _snippet()
    merged_snippet = _snippet()
    session = SimpleNamespace(merge=Mock(return_value=merged_snippet), commit=Mock())

    class SessionContext:
        def __init__(self, engine):
            self.engine = engine

        def __enter__(self):
            return session

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(snippet_workflow_module, "Session", SessionContext)
    monkeypatch.setattr(snippet_workflow_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        lambda: SimpleNamespace(publish_workflow=Mock(side_effect=ValueError("No valid workflow found."))),
    )

    api = snippet_workflow_module.SnippetPublishedWorkflowApi()
    handler = unwrap(api.post)

    with app.test_request_context("/snippets/snippet-1/workflows/publish", method="POST", json={}):
        response, status_code = handler(api, user, snippet)

    assert status_code == 400
    assert response == {"message": "No valid workflow found."}
    session.commit.assert_not_called()


def test_default_block_configs_delegates_to_service(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    get_default_block_configs = Mock(return_value=[{"type": "llm"}])
    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        lambda: SimpleNamespace(get_default_block_configs=get_default_block_configs),
    )

    api = snippet_workflow_module.SnippetDefaultBlockConfigsApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflows/default-workflow-block-configs"):
        result = handler(api, snippet=SimpleNamespace(id="snippet-1"))

    assert result == [{"type": "llm"}]
    get_default_block_configs.assert_called_once()


def test_list_published_snippet_workflows_includes_input_fields(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = SimpleNamespace(
        id="workflow-1",
        graph_dict={"nodes": [], "edges": []},
        features_dict={},
        unique_hash="hash-1",
        version="2024-01-01 00:00:00",
        marked_name="",
        marked_comment="",
        created_by_account=None,
        created_at=datetime(2024, 1, 1),
        updated_by_account=None,
        updated_at=datetime(2024, 1, 1),
        tool_published=False,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    input_fields = [{"variable": "query", "type": "text"}]
    snippet = _snippet(input_fields=json.dumps(input_fields))

    class SessionContext:
        def __init__(self, engine):
            self.engine = engine

        def __enter__(self):
            return Mock()

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(snippet_workflow_module, "Session", SessionContext)
    monkeypatch.setattr(snippet_workflow_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        lambda: SimpleNamespace(get_all_published_workflows=Mock(return_value=([workflow], False))),
    )

    api = snippet_workflow_module.SnippetPublishedAllWorkflowApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflows?page=1&limit=20"):
        response = handler(api, snippet=snippet)

    assert response["items"][0]["input_fields"] == input_fields


def test_restore_published_snippet_workflow_to_draft_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = SimpleNamespace(
        unique_hash="restored-hash",
        updated_at=None,
        created_at=datetime(2024, 1, 1),
    )
    user = _account("account-1")
    snippet = _snippet()

    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        lambda: SimpleNamespace(restore_published_workflow_to_draft=lambda **_kwargs: workflow),
    )

    api = snippet_workflow_module.SnippetDraftWorkflowRestoreApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/published-workflow/restore",
        method="POST",
    ):
        response = handler(api, user, snippet, workflow_id="published-workflow")

    assert response["result"] == "success"
    assert response["hash"] == "restored-hash"


def test_restore_published_snippet_workflow_to_draft_not_found(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    user = _account("account-1")
    snippet = _snippet()

    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        lambda: SimpleNamespace(
            restore_published_workflow_to_draft=lambda **_kwargs: (_ for _ in ()).throw(
                snippet_workflow_module.WorkflowNotFoundError("Workflow not found")
            )
        ),
    )

    api = snippet_workflow_module.SnippetDraftWorkflowRestoreApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/published-workflow/restore",
        method="POST",
    ):
        with pytest.raises(NotFound):
            handler(api, user, snippet, workflow_id="published-workflow")


def test_restore_published_snippet_workflow_to_draft_returns_400_for_draft_source(
    app, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = _account("account-1")
    snippet = _snippet()

    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        lambda: SimpleNamespace(
            restore_published_workflow_to_draft=lambda **_kwargs: (_ for _ in ()).throw(
                snippet_workflow_module.IsDraftWorkflowError("source workflow must be published")
            )
        ),
    )

    api = snippet_workflow_module.SnippetDraftWorkflowRestoreApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/draft-workflow/restore",
        method="POST",
    ):
        with pytest.raises(HTTPException) as exc:
            handler(api, user, snippet, workflow_id="draft-workflow")

    assert exc.value.code == 400
    assert exc.value.description == snippet_workflow_module.RESTORE_SOURCE_WORKFLOW_MUST_BE_PUBLISHED_MESSAGE


def test_restore_published_snippet_workflow_to_draft_returns_400_for_invalid_graph(
    app, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = _account("account-1")
    snippet = _snippet()

    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        lambda: SimpleNamespace(
            restore_published_workflow_to_draft=lambda **_kwargs: (_ for _ in ()).throw(
                ValueError("invalid snippet workflow graph")
            )
        ),
    )

    api = snippet_workflow_module.SnippetDraftWorkflowRestoreApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/published-workflow/restore",
        method="POST",
    ):
        with pytest.raises(HTTPException) as exc:
            handler(api, user, snippet, workflow_id="published-workflow")

    assert exc.value.code == 400
    assert exc.value.description == "invalid snippet workflow graph"


def test_update_published_snippet_workflow_returns_updated_workflow(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    workflow = SimpleNamespace(
        id="workflow-1",
        graph_dict={"nodes": [], "edges": []},
        features_dict={},
        unique_hash="hash-1",
        version="2024-01-01 00:00:00",
        marked_name="v1",
        marked_comment="first version",
        created_by_account=None,
        created_at=datetime(2024, 1, 1),
        updated_by_account=None,
        updated_at=datetime(2024, 1, 1),
        tool_published=False,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    user = _account("account-1")
    input_fields = [{"variable": "query", "type": "text"}]
    snippet = _snippet(input_fields=json.dumps(input_fields))
    session = SimpleNamespace(commit=Mock())
    update_workflow = Mock(return_value=workflow)

    class SessionContext:
        def __init__(self, engine):
            self.engine = engine

        def __enter__(self):
            return session

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(snippet_workflow_module, "Session", SessionContext)
    monkeypatch.setattr(snippet_workflow_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        lambda: SimpleNamespace(update_workflow=update_workflow),
    )

    api = snippet_workflow_module.SnippetWorkflowByIdApi()
    handler = unwrap(api.patch)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/workflow-1",
        method="PATCH",
        json={"marked_name": "v1", "marked_comment": "first version"},
    ):
        response = handler(api, user, snippet, workflow_id="workflow-1")

    update_workflow.assert_called_once_with(
        session=session,
        snippet=snippet,
        workflow_id="workflow-1",
        account=user,
        data={"marked_name": "v1", "marked_comment": "first version"},
    )
    session.commit.assert_called_once()
    assert response["marked_name"] == "v1"
    assert response["marked_comment"] == "first version"
    assert response["input_fields"] == input_fields


def test_update_published_snippet_workflow_returns_400_when_no_fields(app: Flask) -> None:
    api = snippet_workflow_module.SnippetWorkflowByIdApi()
    handler = unwrap(api.patch)

    with app.test_request_context("/snippets/snippet-1/workflows/workflow-1", method="PATCH", json={}):
        response, status_code = handler(api, _account("account-1"), _snippet(), workflow_id="workflow-1")

    assert status_code == 400
    assert response == {"message": "No valid fields to update"}


def test_update_published_snippet_workflow_raises_not_found(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = _account("account-1")
    snippet = _snippet()

    class SessionContext:
        def __init__(self, engine):
            self.engine = engine

        def __enter__(self):
            return SimpleNamespace(commit=Mock())

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(snippet_workflow_module, "Session", SessionContext)
    monkeypatch.setattr(snippet_workflow_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        lambda: SimpleNamespace(update_workflow=Mock(return_value=None)),
    )

    api = snippet_workflow_module.SnippetWorkflowByIdApi()
    handler = unwrap(api.patch)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/missing-workflow",
        method="PATCH",
        json={"marked_name": "v1"},
    ):
        with pytest.raises(NotFound, match="Workflow not found"):
            handler(api, user, snippet, workflow_id="missing-workflow")


def test_workflow_run_detail_raises_not_found_when_run_missing(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    snippet = _snippet()
    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        lambda: SimpleNamespace(get_snippet_workflow_run=Mock(return_value=None)),
    )

    api = snippet_workflow_module.SnippetWorkflowRunDetailApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflow-runs/run-1"):
        with pytest.raises(NotFound, match="Workflow run not found"):
            handler(api, snippet=snippet, run_id="run-1")


def test_draft_node_last_run_raises_not_found_when_execution_missing(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    snippet = _snippet()
    draft_workflow = SimpleNamespace(id="workflow-1")
    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        lambda: SimpleNamespace(
            get_draft_workflow=Mock(return_value=draft_workflow),
            get_snippet_node_last_run=Mock(return_value=None),
        ),
    )

    api = snippet_workflow_module.SnippetDraftNodeLastRunApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflows/draft/nodes/llm-1/last-run"):
        with pytest.raises(NotFound, match="Node last run not found"):
            handler(api, snippet=snippet, node_id="llm-1")


def test_workflow_task_stop_uses_queue_flag_and_graph_command(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    set_stop_flag = Mock()
    send_stop_command = Mock()
    monkeypatch.setattr(
        snippet_workflow_module.AppQueueManager,
        "set_stop_flag_no_user_check",
        set_stop_flag,
    )
    monkeypatch.setattr(
        snippet_workflow_module,
        "GraphEngineManager",
        Mock(return_value=SimpleNamespace(send_stop_command=send_stop_command)),
    )

    api = snippet_workflow_module.SnippetWorkflowTaskStopApi()
    handler = unwrap(api.post)

    with app.test_request_context("/snippets/snippet-1/workflow-runs/tasks/task-1/stop", method="POST"):
        result = handler(api, snippet=SimpleNamespace(id="snippet-1"), task_id="task-1")

    assert result == {"result": "success"}
    set_stop_flag.assert_called_once_with("task-1")
    send_stop_command.assert_called_once_with("task-1")
