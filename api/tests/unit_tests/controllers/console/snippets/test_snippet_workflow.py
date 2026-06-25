from __future__ import annotations

import json
from datetime import datetime
from inspect import unwrap
from unittest.mock import Mock

import pytest
from flask import Flask
from werkzeug.exceptions import HTTPException, NotFound

from controllers.console.snippets import snippet_workflow as snippet_workflow_module
from models.account import Account, TenantAccountRole
from models.snippet import CustomizedSnippet
from models.workflow import Workflow, WorkflowKind, WorkflowType


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


def _workflow(**overrides) -> Workflow:
    workflow = Workflow.new(
        tenant_id="tenant-1",
        app_id="snippet-1",
        type=WorkflowType.WORKFLOW.value,
        version="2024-01-01 00:00:00",
        graph=json.dumps({"nodes": [], "edges": []}),
        features=json.dumps({}),
        created_by="account-1",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
        kind=WorkflowKind.SNIPPET.value,
        marked_name="",
        marked_comment="",
    )
    workflow.id = "workflow-1"
    for key, value in overrides.items():
        setattr(workflow, key, value)
    return workflow


class _DbStub:
    engine = object()


class _SessionStub:
    def __init__(self, merged_snippet: CustomizedSnippet) -> None:
        self.merge = Mock(return_value=merged_snippet)
        self.commit = Mock()


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

    class SnippetServiceStub:
        def get_draft_workflow(self, *, snippet: CustomizedSnippet) -> None:
            return None

    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        SnippetServiceStub,
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

    class SnippetServiceStub:
        def sync_draft_workflow(self, **kwargs):
            return sync_draft_workflow(**kwargs)

    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        SnippetServiceStub,
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


def _response_model_name(entry: object) -> str:
    assert isinstance(entry, tuple)
    assert len(entry) >= 2
    model = entry[1]
    name = getattr(model, "name", None)
    assert isinstance(name, str)
    return name


def test_snippet_workflow_endpoints_keep_response_docs() -> None:
    assert snippet_workflow_module.SnippetDefaultBlockConfigsApi.get.__apidoc__["responses"]["200"] == (
        "Default block configs retrieved successfully",
        None,
        {},
    )

    cases = [
        (
            snippet_workflow_module.SnippetDraftConfigApi.get,
            snippet_workflow_module.SnippetDraftConfigResponse.__name__,
        ),
        (
            snippet_workflow_module.SnippetDraftRunIterationNodeApi.post,
            snippet_workflow_module.EventStreamResponse.__name__,
        ),
        (
            snippet_workflow_module.SnippetDraftRunLoopNodeApi.post,
            snippet_workflow_module.EventStreamResponse.__name__,
        ),
        (
            snippet_workflow_module.SnippetDraftWorkflowRunApi.post,
            snippet_workflow_module.EventStreamResponse.__name__,
        ),
        (
            snippet_workflow_module.SnippetWorkflowTaskStopApi.post,
            snippet_workflow_module.SimpleResultResponse.__name__,
        ),
    ]

    for view, model_name in cases:
        responses = getattr(view, "__apidoc__", {}).get("responses", {})
        assert _response_model_name(responses["200"]) == model_name


def test_draft_config_returns_parallel_depth_limit(app) -> None:
    api = snippet_workflow_module.SnippetDraftConfigApi()
    handler = unwrap(api.get)
    snippet = _snippet()

    with app.test_request_context("/snippets/snippet-1/workflows/draft/config"):
        assert handler(api, snippet=snippet) == {"parallel_depth_limit": 3}


def test_published_workflow_get_returns_none_when_not_published(app) -> None:
    api = snippet_workflow_module.SnippetPublishedWorkflowApi()
    handler = unwrap(api.get)
    snippet = _snippet(is_published=False)

    with app.test_request_context("/snippets/snippet-1/workflows/publish"):
        assert handler(api, snippet=snippet) is None


def test_published_workflow_post_returns_400_when_publish_fails(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    user = _account("account-1")
    snippet = _snippet()
    merged_snippet = _snippet()
    session = _SessionStub(merged_snippet)

    class SnippetServiceStub:
        def publish_workflow(self, **kwargs):
            raise ValueError("No valid workflow found.")

    class SessionContext:
        def __init__(self, engine):
            self.engine = engine

        def __enter__(self):
            return session

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(snippet_workflow_module, "Session", SessionContext)
    monkeypatch.setattr(snippet_workflow_module, "db", _DbStub())
    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        SnippetServiceStub,
    )

    api = snippet_workflow_module.SnippetPublishedWorkflowApi()
    handler = unwrap(api.post)

    with app.test_request_context("/snippets/snippet-1/workflows/publish", method="POST", json={}):
        response, status_code = handler(api, user, snippet)

    assert status_code == 400
    assert response == {"message": "No valid workflow found."}
    session.commit.assert_not_called()


def test_published_workflow_post_returns_publish_result(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    user = _account("account-1")
    snippet = _snippet()
    merged_snippet = _snippet()
    workflow = _workflow(marked_name="Release 1", marked_comment="Initial release")
    session = _SessionStub(merged_snippet)
    publish_workflow = Mock(return_value=workflow)

    class SnippetServiceStub:
        def publish_workflow(self, **kwargs):
            return publish_workflow(**kwargs)

    class SessionContext:
        def __init__(self, engine):
            self.engine = engine

        def __enter__(self):
            return session

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(snippet_workflow_module, "Session", SessionContext)
    monkeypatch.setattr(snippet_workflow_module, "db", _DbStub())
    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        SnippetServiceStub,
    )

    api = snippet_workflow_module.SnippetPublishedWorkflowApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/publish",
        method="POST",
        json={"marked_name": "Release 1", "marked_comment": "Initial release"},
    ):
        response = handler(api, user, snippet)

    assert response == {"result": "success", "created_at": int(workflow.created_at.timestamp())}
    publish_workflow.assert_called_once_with(
        session=session,
        snippet=merged_snippet,
        account=user,
    )
    session.commit.assert_called_once()


def test_default_block_configs_delegates_to_service(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    get_default_block_configs = Mock(return_value=[{"type": "llm"}])

    class SnippetServiceStub:
        def get_default_block_configs(self):
            return get_default_block_configs()

    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        SnippetServiceStub,
    )

    api = snippet_workflow_module.SnippetDefaultBlockConfigsApi()
    handler = unwrap(api.get)
    snippet = _snippet()

    with app.test_request_context("/snippets/snippet-1/workflows/default-workflow-block-configs"):
        result = handler(api, snippet=snippet)

    assert result == [{"type": "llm"}]
    get_default_block_configs.assert_called_once()


def test_list_published_snippet_workflows_includes_input_fields(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = _workflow(
        graph=json.dumps({"nodes": [], "edges": []}),
        features=json.dumps({}),
        version="2024-01-01 00:00:00",
        marked_name="",
        marked_comment="",
        created_at=datetime(2024, 1, 1),
        updated_at=datetime(2024, 1, 1),
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    input_fields = [{"variable": "query", "type": "text"}]
    snippet = _snippet(input_fields=json.dumps(input_fields))
    monkeypatch.setattr(Workflow, "created_by_account", property(lambda _workflow: None))
    monkeypatch.setattr(Workflow, "updated_by_account", property(lambda _workflow: None))
    monkeypatch.setattr(Workflow, "tool_published", property(lambda _workflow: False))

    class SessionContext:
        def __init__(self, engine):
            self.engine = engine

        def __enter__(self):
            return Mock()

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(snippet_workflow_module, "Session", SessionContext)
    monkeypatch.setattr(snippet_workflow_module, "db", _DbStub())

    class SnippetServiceStub:
        def get_all_published_workflows(self, **kwargs):
            return [workflow], False

    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        SnippetServiceStub,
    )

    api = snippet_workflow_module.SnippetPublishedAllWorkflowApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflows?page=1&limit=20"):
        response = handler(api, snippet=snippet)

    assert response["items"][0]["input_fields"] == input_fields


def test_restore_published_snippet_workflow_to_draft_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = _workflow(
        updated_at=None,
        created_at=datetime(2024, 1, 1),
    )
    user = _account("account-1")
    snippet = _snippet()

    class SnippetServiceStub:
        def restore_published_workflow_to_draft(self, **kwargs):
            return workflow

    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        SnippetServiceStub,
    )

    api = snippet_workflow_module.SnippetDraftWorkflowRestoreApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/published-workflow/restore",
        method="POST",
    ):
        response = handler(api, user, snippet, workflow_id="published-workflow")

    assert response["result"] == "success"
    assert response["hash"] == workflow.unique_hash


def test_restore_published_snippet_workflow_to_draft_not_found(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    user = _account("account-1")
    snippet = _snippet()

    class SnippetServiceStub:
        def restore_published_workflow_to_draft(self, **kwargs):
            raise snippet_workflow_module.WorkflowNotFoundError("Workflow not found")

    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        SnippetServiceStub,
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

    class SnippetServiceStub:
        def restore_published_workflow_to_draft(self, **kwargs):
            raise snippet_workflow_module.IsDraftWorkflowError("source workflow must be published")

    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        SnippetServiceStub,
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

    class SnippetServiceStub:
        def restore_published_workflow_to_draft(self, **kwargs):
            raise ValueError("invalid snippet workflow graph")

    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        SnippetServiceStub,
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


def test_workflow_run_detail_raises_not_found_when_run_missing(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    snippet = _snippet()

    class SnippetServiceStub:
        def get_snippet_workflow_run(self, **kwargs) -> None:
            return None

    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        SnippetServiceStub,
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
    draft_workflow = _workflow(id="workflow-1", version=Workflow.VERSION_DRAFT)

    class SnippetServiceStub:
        def get_draft_workflow(self, *, snippet: CustomizedSnippet) -> Workflow:
            return draft_workflow

        def get_snippet_node_last_run(self, **kwargs) -> None:
            return None

    monkeypatch.setattr(
        snippet_workflow_module,
        "SnippetService",
        SnippetServiceStub,
    )

    api = snippet_workflow_module.SnippetDraftNodeLastRunApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflows/draft/nodes/llm-1/last-run"):
        with pytest.raises(NotFound, match="Node last run not found"):
            handler(api, snippet=snippet, node_id="llm-1")


def test_workflow_task_stop_uses_queue_flag_and_graph_command(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    set_stop_flag = Mock()
    send_stop_command = Mock()

    class GraphEngineManagerStub:
        def __init__(self, redis_client):
            self.redis_client = redis_client
            self.send_stop_command = send_stop_command

    monkeypatch.setattr(
        snippet_workflow_module.AppQueueManager,
        "set_stop_flag_no_user_check",
        set_stop_flag,
    )
    monkeypatch.setattr(
        snippet_workflow_module,
        "GraphEngineManager",
        GraphEngineManagerStub,
    )

    api = snippet_workflow_module.SnippetWorkflowTaskStopApi()
    handler = unwrap(api.post)
    snippet = _snippet()

    with app.test_request_context("/snippets/snippet-1/workflow-runs/tasks/task-1/stop", method="POST"):
        result = handler(api, snippet=snippet, task_id="task-1")

    assert result == {"result": "success"}
    set_stop_flag.assert_called_once_with("task-1")
    send_stop_command.assert_called_once_with("task-1")
