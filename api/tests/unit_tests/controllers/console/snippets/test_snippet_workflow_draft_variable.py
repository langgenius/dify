import json
from inspect import unwrap
from unittest.mock import Mock

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.console.snippets import snippet_workflow_draft_variable as module
from graphon.variables import StringSegment, StringVariable
from models.account import Account, AccountStatus
from models.snippet import CustomizedSnippet
from models.workflow import Workflow, WorkflowDraftVariable
from services.workflow_draft_variable_service import WorkflowDraftVariableList


def _make_account() -> Account:
    account = Account(
        name="tester",
        email="tester@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = "user-1"  # type: ignore[assignment]
    return account


def _make_snippet(snippet_id: str = "snippet-1") -> CustomizedSnippet:
    return CustomizedSnippet(
        id=snippet_id,
        tenant_id="tenant-1",
        name="Snippet",
        description="Description",
        type="node",
        created_by="user-1",
    )


def _make_workflow(*, environment_variables: list[StringVariable] | None = None) -> Workflow:
    workflow = Workflow.new(
        tenant_id="tenant-1",
        app_id="snippet-1",
        type="workflow",
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps({"nodes": [], "edges": []}),
        features="{}",
        created_by="user-1",
        environment_variables=environment_variables or [],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    workflow.id = "workflow-1"
    return workflow


def _make_node_variable(
    variable_id: str,
    *,
    app_id: str = "snippet-1",
    user_id: str = "user-1",
    node_id: str = "llm-1",
    name: str | None = None,
    node_execution_id: str | None = "execution-1",
) -> WorkflowDraftVariable:
    """Create a valid node variable for persisted controller tests."""
    variable = WorkflowDraftVariable.new_node_variable(
        app_id=app_id,
        user_id=user_id,
        node_id=node_id,
        name=name or variable_id,
        value=StringSegment(value=f"value-{variable_id}"),
        node_execution_id=node_execution_id or "execution-1",
    )
    variable.id = variable_id
    variable.node_execution_id = node_execution_id
    return variable


@pytest.fixture
def app() -> Flask:
    app = Flask("test_snippet_workflow_draft_variable")
    app.config["TESTING"] = True
    return app


def _persist_variables(sqlite_session: Session, *variables: WorkflowDraftVariable) -> None:
    sqlite_session.add_all(variables)
    sqlite_session.commit()


def _variable_ids(session: Session) -> set[str]:
    return set(session.scalars(select(WorkflowDraftVariable.id)))


def test_ensure_snippet_draft_variable_row_allowed_rejects_system_variable() -> None:
    variable = WorkflowDraftVariable.new_sys_variable(
        app_id="snippet-1",
        user_id="user-1",
        name="query",
        value=StringSegment(value="query"),
        node_execution_id="execution-1",
        editable=True,
    )

    with pytest.raises(module.NotFoundError, match="variable not found"):
        module._ensure_snippet_draft_variable_row_allowed(variable=variable, variable_id="var-1")


def test_ensure_snippet_draft_variable_row_allowed_rejects_conversation_variable() -> None:
    variable = WorkflowDraftVariable.new_conversation_variable(
        app_id="snippet-1",
        user_id="user-1",
        name="conversation-name",
        value=StringSegment(value="value"),
    )

    with pytest.raises(module.NotFoundError, match="variable not found"):
        module._ensure_snippet_draft_variable_row_allowed(variable=variable, variable_id="var-1")


def test_ensure_snippet_draft_variable_row_allowed_accepts_canvas_node_variable() -> None:
    variable = _make_node_variable("var-1")

    module._ensure_snippet_draft_variable_row_allowed(variable=variable, variable_id="var-1")


def test_conversation_variables_returns_empty_list(app: Flask) -> None:
    api = module.SnippetConversationVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, _make_account(), snippet=_make_snippet())

    assert result == WorkflowDraftVariableList(variables=[])


def test_system_variables_returns_empty_list(app: Flask) -> None:
    api = module.SnippetSystemVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, _make_account(), snippet=_make_snippet())

    assert result == WorkflowDraftVariableList(variables=[])


def test_delete_variable_collection_deletes_only_current_user_variables(
    app: Flask,
    sqlite_session: Session,
) -> None:
    matching = _make_node_variable("matching", name="matching")
    matching_second = _make_node_variable("matching-second", node_id="tool-1", name="matching-second")
    other_user = _make_node_variable("other-user", user_id="user-2", name="other-user")
    other_snippet = _make_node_variable("other-snippet", app_id="snippet-2", name="other-snippet")
    _persist_variables(sqlite_session, matching, matching_second, other_user, other_snippet)
    api = module.SnippetWorkflowVariableCollectionApi()
    handler = unwrap(api.delete)

    with app.test_request_context("/", method="DELETE"):
        response = handler(api, sqlite_session, _make_account(), snippet=_make_snippet())

    assert response.status_code == 204
    assert _variable_ids(sqlite_session) == {other_user.id, other_snippet.id}


def test_variable_collection_get_raises_when_draft_workflow_missing(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    monkeypatch.setattr(
        module,
        "SnippetService",
        Mock(return_value=Mock(get_draft_workflow=Mock(return_value=None))),
    )

    api = module.SnippetWorkflowVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/?page=1&limit=20"):
        with pytest.raises(module.DraftWorkflowNotExist):
            handler(api, sqlite_session, _make_account(), snippet=_make_snippet())


def test_node_variable_collection_get_lists_persisted_node_variables(
    app: Flask,
    sqlite_session: Session,
) -> None:
    matching = _make_node_variable("matching", name="matching")
    other_node = _make_node_variable("other-node", node_id="tool-1", name="other-node")
    other_user = _make_node_variable("other-user", user_id="user-2", name="other-user")
    other_snippet = _make_node_variable("other-snippet", app_id="snippet-2", name="other-snippet")
    _persist_variables(sqlite_session, matching, other_node, other_user, other_snippet)
    api = module.SnippetNodeVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, sqlite_session, _make_account(), snippet=_make_snippet(), node_id="llm-1")

    assert [variable.id for variable in result.variables] == [matching.id]


def test_node_variable_collection_delete_deletes_only_requested_node_variables(
    app: Flask,
    sqlite_session: Session,
) -> None:
    matching = _make_node_variable("matching", name="matching")
    matching_second = _make_node_variable("matching-second", name="matching-second")
    other_node = _make_node_variable("other-node", node_id="tool-1", name="other-node")
    other_user = _make_node_variable("other-user", user_id="user-2", name="other-user")
    _persist_variables(sqlite_session, matching, matching_second, other_node, other_user)
    api = module.SnippetNodeVariableCollectionApi()
    handler = unwrap(api.delete)

    with app.test_request_context("/", method="DELETE"):
        response = handler(api, sqlite_session, _make_account(), snippet=_make_snippet(), node_id="llm-1")

    assert response.status_code == 204
    assert _variable_ids(sqlite_session) == {other_node.id, other_user.id}


def test_variable_patch_returns_persisted_variable_without_committing_when_no_changes(
    app: Flask,
    sqlite_session: Session,
) -> None:
    variable = _make_node_variable("var-1")
    _persist_variables(sqlite_session, variable)
    api = module.SnippetVariableApi()
    handler = unwrap(api.patch)
    with app.test_request_context("/", method="PATCH", json={}):
        result = handler(
            api,
            module.WorkflowDraftVariableUpdatePayload(),
            sqlite_session,
            _make_account(),
            snippet=_make_snippet(),
            variable_id="var-1",
        )

    assert result.id == variable.id
    assert result.app_id == "snippet-1"


def test_variable_delete_deletes_persisted_variable(
    app: Flask,
    sqlite_session: Session,
) -> None:
    variable = _make_node_variable("var-1")
    retained = _make_node_variable("var-2", name="retained")
    _persist_variables(sqlite_session, variable, retained)
    api = module.SnippetVariableApi()
    handler = unwrap(api.delete)

    with app.test_request_context("/", method="DELETE"):
        response = handler(
            api,
            sqlite_session,
            _make_account(),
            snippet=_make_snippet(),
            variable_id=variable.id,
        )

    assert response.status_code == 204
    assert _variable_ids(sqlite_session) == {retained.id}


def test_variable_reset_deletes_variable_without_node_execution(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    variable = _make_node_variable("var-1", node_execution_id=None)
    _persist_variables(sqlite_session, variable)
    monkeypatch.setattr(
        module,
        "SnippetService",
        Mock(return_value=Mock(get_draft_workflow=Mock(return_value=_make_workflow()))),
    )
    api = module.SnippetVariableResetApi()
    handler = unwrap(api.put)

    with app.test_request_context("/", method="PUT"):
        response = handler(
            api,
            sqlite_session,
            _make_account(),
            snippet=_make_snippet(),
            variable_id=variable.id,
        )

    assert response.status_code == 204
    assert _variable_ids(sqlite_session) == set()


def test_environment_variables_returns_workflow_environment_variables(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    env_var = StringVariable(
        id="env-1",
        name="API_KEY",
        description="secret",
        selector=["env", "API_KEY"],
        value="sk-test",
    )
    monkeypatch.setattr(
        module,
        "SnippetService",
        Mock(return_value=Mock(get_draft_workflow=Mock(return_value=_make_workflow(environment_variables=[env_var])))),
    )

    api = module.SnippetEnvironmentVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, _make_account(), snippet=_make_snippet())

    assert result == {
        "items": [
            {
                "id": "env-1",
                "type": "env",
                "name": "API_KEY",
                "description": "secret",
                "selector": ["env", "API_KEY"],
                "value_type": "string",
                "value": "sk-test",
                "edited": False,
                "visible": True,
                "editable": True,
            }
        ]
    }
