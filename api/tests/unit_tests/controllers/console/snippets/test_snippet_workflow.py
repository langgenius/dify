from __future__ import annotations

import json
from inspect import unwrap
from typing import NoReturn
from unittest.mock import Mock

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import HTTPException

from controllers.common.errors import NotFoundError
from controllers.console.snippets import snippet_workflow as snippet_workflow_module
from extensions.ext_application_services import ApplicationServices
from machinery.context import RequestContext
from models.account import Account, TenantAccountRole
from models.snippet import CustomizedSnippet
from models.workflow import Workflow
from repositories.workflow.definition_repository import workflow_record, workflow_snapshot
from services.workflow.contracts import WorkflowRecord
from tests.unit_tests.model_factories import make_account


def _account(account_id: str = "account-1") -> Account:
    return make_account(
        account_id=account_id,
        name="Test User",
        email=f"{account_id}@example.com",
        role=TenantAccountRole.EDITOR,
    )


def _snippet(**overrides: object) -> CustomizedSnippet:
    data: dict[str, object] = {
        "id": "snippet-1",
        "tenant_id": "tenant-1",
        "name": "Snippet",
        "description": "Description",
        "type": "node",
        "created_by": "account-1",
    }
    data.update(overrides)
    return CustomizedSnippet(**data)


def _workflow(**overrides: object) -> Workflow:
    workflow = Workflow.new(
        tenant_id="tenant-1",
        app_id="snippet-1",
        type="workflow",
        version="2024-01-01 00:00:00",
        graph=json.dumps({"nodes": [], "edges": []}),
        features="{}",
        created_by="account-1",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    workflow.id = "workflow-1"
    for name, value in overrides.items():
        setattr(workflow, name, value)
    return workflow


def test_get_snippet_requires_snippet_id(app: Flask) -> None:
    @snippet_workflow_module.get_snippet
    def view(**kwargs: object) -> object:
        return kwargs

    with app.test_request_context("/snippets"):
        with pytest.raises(ValueError, match="missing snippet_id"):
            view()


def test_get_snippet_injects_resolved_snippet(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    snippet = _snippet()

    @snippet_workflow_module.get_snippet
    def view(**kwargs: object) -> object:
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
    def view(**kwargs: object) -> object:
        return kwargs

    monkeypatch.setattr(
        snippet_workflow_module,
        "current_account_with_tenant",
        lambda: (_account("account-1"), "tenant-1"),
    )
    monkeypatch.setattr(snippet_workflow_module.SnippetService, "get_snippet_by_id", Mock(return_value=None))

    with app.test_request_context("/snippets/snippet-1"):
        with pytest.raises(NotFoundError, match="Snippet not found"):
            view(snippet_id="snippet-1")


def test_draft_workflow_get_raises_when_missing(
    app: Flask, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    snippet = _snippet()
    monkeypatch.setattr(snippet_workflow_module.SnippetService, "get_draft_workflow_record", Mock(return_value=None))

    api = snippet_workflow_module.SnippetDraftWorkflowApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflows/draft"):
        with pytest.raises(snippet_workflow_module.DraftWorkflowNotExist):
            handler(api, unbound_session, snippet=snippet)


def test_draft_workflow_get_serializes_materialized_record(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    workflow = _workflow(updated_by="account-2")
    sqlite_session.add_all([_account(), _account("account-2")])
    sqlite_session.commit()
    snippet = _snippet()
    monkeypatch.setattr(
        snippet_workflow_module.SnippetService,
        "get_draft_workflow_record",
        Mock(return_value=workflow_record(workflow, sqlite_session)),
    )

    api = snippet_workflow_module.SnippetDraftWorkflowApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflows/draft"):
        response = handler(api, sqlite_session, snippet=snippet)

    assert response["id"] == "workflow-1"
    assert response["created_by"]["id"] == "account-1"
    assert response["updated_by"]["id"] == "account-2"
    assert response["tool_published"] is False


def test_draft_workflow_post_returns_400_for_invalid_graph(
    app: Flask, monkeypatch: pytest.MonkeyPatch, workflow_application: ApplicationServices
) -> None:
    user = _account("account-1")
    snippet = _snippet()
    sync_draft_workflow = Mock(side_effect=ValueError("invalid graph"))
    monkeypatch.setattr(workflow_application.workflow_drafts, "sync", sync_draft_workflow)

    api = snippet_workflow_module.SnippetDraftWorkflowApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/draft",
        method="POST",
        json={"graph": {"nodes": [], "edges": []}, "hash": "hash-1"},
    ):
        response, status_code = handler(api, RequestContext("test", None, user.id, snippet.tenant_id), snippet.id)

    assert status_code == 400
    assert response == {"message": "invalid graph"}


def test_draft_config_returns_parallel_depth_limit(app: Flask) -> None:
    api = snippet_workflow_module.SnippetDraftConfigApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflows/draft/config"):
        assert handler(api, snippet=_snippet()) == {"parallel_depth_limit": 3}


def test_published_workflow_get_returns_none_when_not_published(app: Flask, unbound_session: Session) -> None:
    api = snippet_workflow_module.SnippetPublishedWorkflowApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflows/publish"):
        assert handler(api, unbound_session, snippet=_snippet(is_published=False)) is None


def test_published_workflow_get_serializes_materialized_record(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    workflow = _workflow(updated_by="account-2")
    sqlite_session.add_all([_account(), _account("account-2")])
    sqlite_session.commit()
    snippet = _snippet(is_published=True)
    monkeypatch.setattr(
        snippet_workflow_module.SnippetService,
        "get_published_workflow_record",
        Mock(return_value=workflow_record(workflow, sqlite_session)),
    )

    api = snippet_workflow_module.SnippetPublishedWorkflowApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflows/publish"):
        response = handler(api, sqlite_session, snippet=snippet)

    assert response["id"] == "workflow-1"
    assert response["created_by"]["id"] == "account-1"
    assert response["updated_by"]["id"] == "account-2"
    assert response["tool_published"] is False


def test_published_workflow_post_returns_400_when_publish_fails(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    user = _account("account-1")
    snippet = _snippet()
    sqlite_session.add(snippet)
    sqlite_session.commit()

    def fail_publish(*, snippet: CustomizedSnippet, account: Account) -> NoReturn:
        raise ValueError("No valid workflow found.")

    monkeypatch.setattr(snippet_workflow_module.SnippetService, "publish_workflow", Mock(side_effect=fail_publish))

    api = snippet_workflow_module.SnippetPublishedWorkflowApi()
    handler = unwrap(api.post)

    with app.test_request_context("/snippets/snippet-1/workflows/publish", method="POST", json={}):
        response, status_code = handler(api, user, snippet)

    assert status_code == 400
    assert response == {"message": "No valid workflow found."}
    sqlite_session.refresh(snippet)
    assert snippet.name == "Snippet"


def test_published_workflow_post_returns_success(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    user = _account("account-1")
    snippet = _snippet()
    sqlite_session.add(snippet)
    sqlite_session.commit()
    workflow = _workflow()
    monkeypatch.setattr(snippet_workflow_module.SnippetService, "publish_workflow", Mock(return_value=workflow))

    api = snippet_workflow_module.SnippetPublishedWorkflowApi()
    handler = unwrap(api.post)
    with app.test_request_context("/snippets/snippet-1/workflows/publish", method="POST", json={}):
        response = handler(api, user, snippet)

    assert response["result"] == "success"


def test_published_workflow_post_translates_preparation_conflict(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    from controllers.console.app.error import DraftWorkflowNotSync
    from services.errors.app import WorkflowHashNotEqualError

    monkeypatch.setattr(
        snippet_workflow_module.SnippetService, "publish_workflow", Mock(side_effect=WorkflowHashNotEqualError)
    )
    api = snippet_workflow_module.SnippetPublishedWorkflowApi()
    with app.test_request_context("/snippets/snippet-1/workflows/publish", method="POST", json={}):
        with pytest.raises(DraftWorkflowNotSync) as error:
            unwrap(api.post)(api, _account("account-1"), _snippet())
    assert error.value.code == 409


def test_default_block_configs_delegates_to_service(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    get_default_block_configs = Mock(return_value=[{"type": "llm"}])
    monkeypatch.setattr(snippet_workflow_module.SnippetService, "get_default_block_configs", get_default_block_configs)

    api = snippet_workflow_module.SnippetDefaultBlockConfigsApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflows/default-workflow-block-configs"):
        result = handler(api, snippet=_snippet())

    assert result == [{"type": "llm"}]
    get_default_block_configs.assert_called_once()


def test_list_published_snippet_workflows_includes_input_fields(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    workflow = _workflow()
    input_fields = [{"variable": "query", "type": "text"}]
    snippet = _snippet(input_fields=json.dumps(input_fields))

    monkeypatch.setattr(
        snippet_workflow_module.SnippetService,
        "get_all_published_workflows",
        Mock(return_value=([workflow_record(workflow, sqlite_session)], False)),
    )

    api = snippet_workflow_module.SnippetPublishedAllWorkflowApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflows?page=1&limit=20"):
        response = handler(
            api,
            snippet_workflow_module.SnippetWorkflowListQuery.model_validate({"page": 1, "limit": 20}),
            sqlite_session,
            snippet=snippet,
        )

    assert response["items"][0]["input_fields"] == input_fields


def test_restore_published_snippet_workflow_to_draft_success(
    app: Flask, monkeypatch: pytest.MonkeyPatch, workflow_application: ApplicationServices
) -> None:
    workflow = _workflow(updated_at=None)
    user = _account("account-1")
    snippet = _snippet()

    monkeypatch.setattr(workflow_application.workflow_drafts, "restore", Mock(return_value=workflow_snapshot(workflow)))

    api = snippet_workflow_module.SnippetDraftWorkflowRestoreApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/published-workflow/restore",
        method="POST",
    ):
        response = handler(
            api, RequestContext("test", None, user.id, snippet.tenant_id), snippet.id, workflow_id="published-workflow"
        )

    assert response["result"] == "success"
    assert response["hash"] == workflow.unique_hash


def test_restore_published_snippet_workflow_to_draft_not_found(
    app: Flask, monkeypatch: pytest.MonkeyPatch, workflow_application: ApplicationServices
) -> None:
    user = _account("account-1")
    snippet = _snippet()

    monkeypatch.setattr(
        workflow_application.workflow_drafts,
        "restore",
        Mock(side_effect=snippet_workflow_module.WorkflowNotFoundError("Workflow not found")),
    )

    api = snippet_workflow_module.SnippetDraftWorkflowRestoreApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/published-workflow/restore",
        method="POST",
    ):
        with pytest.raises(NotFoundError):
            handler(
                api,
                RequestContext("test", None, user.id, snippet.tenant_id),
                snippet.id,
                workflow_id="published-workflow",
            )


def test_restore_published_snippet_workflow_to_draft_returns_400_for_draft_source(
    app: Flask, monkeypatch: pytest.MonkeyPatch, workflow_application: ApplicationServices
) -> None:
    user = _account("account-1")
    snippet = _snippet()

    monkeypatch.setattr(
        workflow_application.workflow_drafts,
        "restore",
        Mock(side_effect=snippet_workflow_module.IsDraftWorkflowError("source workflow must be published")),
    )

    api = snippet_workflow_module.SnippetDraftWorkflowRestoreApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/draft-workflow/restore",
        method="POST",
    ):
        with pytest.raises(HTTPException) as exc:
            handler(
                api, RequestContext("test", None, user.id, snippet.tenant_id), snippet.id, workflow_id="draft-workflow"
            )

    assert exc.value.code == 400
    assert exc.value.description == snippet_workflow_module.RESTORE_SOURCE_WORKFLOW_MUST_BE_PUBLISHED_MESSAGE


def test_restore_published_snippet_workflow_to_draft_returns_400_for_invalid_graph(
    app: Flask, monkeypatch: pytest.MonkeyPatch, workflow_application: ApplicationServices
) -> None:
    user = _account("account-1")
    snippet = _snippet()

    monkeypatch.setattr(
        workflow_application.workflow_drafts,
        "restore",
        Mock(side_effect=ValueError("invalid snippet workflow graph")),
    )

    api = snippet_workflow_module.SnippetDraftWorkflowRestoreApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/published-workflow/restore",
        method="POST",
    ):
        with pytest.raises(HTTPException) as exc:
            handler(
                api,
                RequestContext("test", None, user.id, snippet.tenant_id),
                snippet.id,
                workflow_id="published-workflow",
            )

    assert exc.value.code == 400
    assert exc.value.description == "invalid snippet workflow graph"


def test_update_published_snippet_workflow_returns_updated_workflow(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    workflow = _workflow(marked_name="v1", marked_comment="first version")
    user = _account("account-1")
    input_fields = [{"variable": "query", "type": "text"}]
    snippet = _snippet(input_fields=json.dumps(input_fields))
    sqlite_session.add(snippet)
    sqlite_session.commit()

    def update_persisted_snippet(*, session: Session, snippet: CustomizedSnippet, **_kwargs: object) -> WorkflowRecord:
        merged_snippet = session.merge(snippet)
        merged_snippet.description = "Updated in transaction"
        return workflow_record(workflow, session)

    update_workflow = Mock(side_effect=update_persisted_snippet)
    monkeypatch.setattr(snippet_workflow_module.SnippetService, "update_workflow", update_workflow)

    api = snippet_workflow_module.SnippetWorkflowByIdApi()
    handler = unwrap(api.patch)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/workflow-1",
        method="PATCH",
        json={"marked_name": "v1", "marked_comment": "first version"},
    ):
        response = handler(
            api,
            snippet_workflow_module.WorkflowUpdatePayload.model_validate(
                {"marked_name": "v1", "marked_comment": "first version"}
            ),
            sqlite_session,
            user,
            snippet,
            workflow_id="workflow-1",
        )

    update_workflow.assert_called_once()
    update_call = update_workflow.call_args.kwargs
    assert isinstance(update_call["session"], Session)
    assert update_call["snippet"] is snippet
    assert update_call["workflow_id"] == "workflow-1"
    assert update_call["account"] is user
    assert update_call["data"] == {"marked_name": "v1", "marked_comment": "first version"}
    assert response["marked_name"] == "v1"
    assert response["marked_comment"] == "first version"
    assert response["input_fields"] == input_fields
    sqlite_session.refresh(snippet)
    assert snippet.description == "Updated in transaction"


def test_update_published_snippet_workflow_returns_400_when_no_fields(app: Flask, unbound_session: Session) -> None:
    api = snippet_workflow_module.SnippetWorkflowByIdApi()
    handler = unwrap(api.patch)

    with app.test_request_context("/snippets/snippet-1/workflows/workflow-1", method="PATCH", json={}):
        response, status_code = handler(
            api,
            snippet_workflow_module.WorkflowUpdatePayload(),
            unbound_session,
            _account("account-1"),
            _snippet(),
            workflow_id="workflow-1",
        )

    assert status_code == 400
    assert response == {"message": "No valid fields to update"}


def test_update_published_snippet_workflow_raises_not_found(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    user = _account("account-1")
    snippet = _snippet()
    sqlite_session.add(snippet)
    sqlite_session.commit()

    def update_missing_workflow(*, session: Session, snippet: CustomizedSnippet, **_kwargs: object) -> None:
        merged_snippet = session.merge(snippet)
        merged_snippet.name = "Rolled back name"

    monkeypatch.setattr(
        snippet_workflow_module.SnippetService, "update_workflow", Mock(side_effect=update_missing_workflow)
    )

    api = snippet_workflow_module.SnippetWorkflowByIdApi()
    handler = unwrap(api.patch)

    with app.test_request_context(
        "/snippets/snippet-1/workflows/missing-workflow",
        method="PATCH",
        json={"marked_name": "v1"},
    ):
        with pytest.raises(NotFoundError, match="Workflow not found"):
            handler(
                api,
                snippet_workflow_module.WorkflowUpdatePayload.model_validate({"marked_name": "v1"}),
                sqlite_session,
                user,
                snippet,
                workflow_id="missing-workflow",
            )

    sqlite_session.rollback()
    sqlite_session.refresh(snippet)
    assert snippet.name == "Snippet"


@pytest.mark.parametrize("outcome", ["success", "missing", "active", "draft"])
def test_delete_published_snippet_workflow(
    app: Flask, monkeypatch: pytest.MonkeyPatch, workflow_application: ApplicationServices, outcome: str
) -> None:
    calls: list[tuple[RequestContext, object, str]] = []
    context = RequestContext("test", None, "account-1", "tenant-1")

    def delete(context: RequestContext, owner: snippet_workflow_module.WorkflowOwner, workflow_id: str) -> None:
        calls.append((context, owner, workflow_id))
        if outcome == "missing":
            raise snippet_workflow_module.WorkflowNotFoundError("Workflow not found")
        if outcome == "active":
            raise snippet_workflow_module.WorkflowInUseError("Workflow is in use")
        if outcome == "draft":
            raise snippet_workflow_module.DraftWorkflowDeletionError("Cannot delete draft")

    monkeypatch.setattr(workflow_application.console_workflows, "delete", delete)
    api = snippet_workflow_module.SnippetWorkflowByIdApi()
    handler = unwrap(api.delete)
    with app.test_request_context("/", method="DELETE"):
        if outcome == "success":
            assert handler(api, context, "snippet-1", "workflow-1") == (None, 204)
        else:
            with pytest.raises(HTTPException) as error:
                handler(api, context, "snippet-1", "workflow-1")
            assert error.value.code == (404 if outcome == "missing" else 400)
    assert calls == [(context, snippet_workflow_module.WorkflowOwner("snippet-1", "snippet"), "workflow-1")]


def test_workflow_run_detail_raises_not_found_when_run_missing(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    snippet = _snippet()
    monkeypatch.setattr(snippet_workflow_module.SnippetService, "get_snippet_workflow_run", Mock(return_value=None))

    api = snippet_workflow_module.SnippetWorkflowRunDetailApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflow-runs/run-1"):
        with pytest.raises(NotFoundError, match="Workflow run not found"):
            handler(api, sqlite_session, snippet=snippet, run_id="run-1")


def test_draft_node_last_run_raises_not_found_when_execution_missing(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    snippet = _snippet()
    draft_workflow = _workflow(version=Workflow.VERSION_DRAFT)
    monkeypatch.setattr(snippet_workflow_module.SnippetService, "get_draft_workflow", Mock(return_value=draft_workflow))
    monkeypatch.setattr(snippet_workflow_module.SnippetService, "get_snippet_node_last_run", Mock(return_value=None))

    api = snippet_workflow_module.SnippetDraftNodeLastRunApi()
    handler = unwrap(api.get)

    with app.test_request_context("/snippets/snippet-1/workflows/draft/nodes/llm-1/last-run"):
        with pytest.raises(NotFoundError, match="Node last run not found"):
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
        Mock(return_value=Mock(send_stop_command=send_stop_command)),
    )

    api = snippet_workflow_module.SnippetWorkflowTaskStopApi()
    handler = unwrap(api.post)

    with app.test_request_context("/snippets/snippet-1/workflow-runs/tasks/task-1/stop", method="POST"):
        result = handler(api, snippet=_snippet(), task_id="task-1")

    assert result == {"result": "success"}
    set_stop_flag.assert_called_once_with("task-1")
    send_stop_command.assert_called_once_with("task-1")
