from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from werkzeug.exceptions import HTTPException, NotFound

from controllers.console.snippets import snippet_workflow as snippet_workflow_module


def _unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


def test_restore_published_snippet_workflow_to_draft_success(app, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = SimpleNamespace(
        unique_hash="restored-hash",
        updated_at=None,
        created_at=datetime(2024, 1, 1),
    )
    user = SimpleNamespace(id="account-1")
    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1")

    monkeypatch.setattr(snippet_workflow_module, "current_account_with_tenant", lambda: (user, "tenant-1"))
    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        lambda: SimpleNamespace(restore_published_workflow_to_draft=lambda **_kwargs: workflow),
    )

    api = snippet_workflow_module.SnippetDraftWorkflowRestoreApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/published-workflow/restore",
        method="POST",
    ):
        response = handler(api, snippet=snippet, workflow_id="published-workflow")

    assert response["result"] == "success"
    assert response["hash"] == "restored-hash"


def test_restore_published_snippet_workflow_to_draft_not_found(app, monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(id="account-1")
    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1")

    monkeypatch.setattr(snippet_workflow_module, "current_account_with_tenant", lambda: (user, "tenant-1"))
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
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/published-workflow/restore",
        method="POST",
    ):
        with pytest.raises(NotFound):
            handler(api, snippet=snippet, workflow_id="published-workflow")


def test_restore_published_snippet_workflow_to_draft_returns_400_for_draft_source(
    app, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = SimpleNamespace(id="account-1")
    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1")

    monkeypatch.setattr(snippet_workflow_module, "current_account_with_tenant", lambda: (user, "tenant-1"))
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
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/draft-workflow/restore",
        method="POST",
    ):
        with pytest.raises(HTTPException) as exc:
            handler(api, snippet=snippet, workflow_id="draft-workflow")

    assert exc.value.code == 400
    assert exc.value.description == snippet_workflow_module.RESTORE_SOURCE_WORKFLOW_MUST_BE_PUBLISHED_MESSAGE


def test_restore_published_snippet_workflow_to_draft_returns_400_for_invalid_graph(
    app, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = SimpleNamespace(id="account-1")
    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1")

    monkeypatch.setattr(snippet_workflow_module, "current_account_with_tenant", lambda: (user, "tenant-1"))
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
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/published-workflow/restore",
        method="POST",
    ):
        with pytest.raises(HTTPException) as exc:
            handler(api, snippet=snippet, workflow_id="published-workflow")

    assert exc.value.code == 400
    assert exc.value.description == "invalid snippet workflow graph"


def test_workflow_run_detail_raises_not_found_when_run_missing(app, monkeypatch: pytest.MonkeyPatch) -> None:
    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1")
    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        lambda: SimpleNamespace(get_snippet_workflow_run=Mock(return_value=None)),
    )

    api = snippet_workflow_module.SnippetWorkflowRunDetailApi()
    handler = _unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflow-runs/run-1"):
        with pytest.raises(NotFound, match="Workflow run not found"):
            handler(api, snippet=snippet, run_id="run-1")


def test_draft_node_last_run_raises_not_found_when_execution_missing(
    app, monkeypatch: pytest.MonkeyPatch
) -> None:
    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1")
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
    handler = _unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflows/draft/nodes/llm-1/last-run"):
        with pytest.raises(NotFound, match="Node last run not found"):
            handler(api, snippet=snippet, node_id="llm-1")


def test_workflow_task_stop_uses_queue_flag_and_graph_command(app, monkeypatch: pytest.MonkeyPatch) -> None:
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
    handler = _unwrap(api.post)

    with app.test_request_context("/snippets/snippet-1/workflow-runs/tasks/task-1/stop", method="POST"):
        result = handler(api, snippet=SimpleNamespace(id="snippet-1"), task_id="task-1")

    assert result == {"result": "success"}
    set_stop_flag.assert_called_once_with("task-1")
    send_stop_command.assert_called_once_with("task-1")
