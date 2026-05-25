from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

import pytest
from werkzeug.exceptions import HTTPException, NotFound

from controllers.console.snippets import snippet_workflow as snippet_workflow_module


def _unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


def test_restore_published_snippet_workflow_to_draft_success(
    app, monkeypatch: pytest.MonkeyPatch
) -> None:
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


def test_restore_published_snippet_workflow_to_draft_not_found(
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
