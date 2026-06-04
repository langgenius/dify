from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask

from controllers.console.snippets import snippet_workflow_draft_variable as module
from core.workflow.variable_prefixes import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from services.workflow_draft_variable_service import WorkflowDraftVariableList


def _unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture
def app():
    app = Flask("test_snippet_workflow_draft_variable")
    app.config["TESTING"] = True
    return app


def test_ensure_snippet_draft_variable_row_allowed_rejects_system_variable():
    variable = SimpleNamespace(node_id=SYSTEM_VARIABLE_NODE_ID)

    with pytest.raises(module.NotFoundError, match="variable not found"):
        module._ensure_snippet_draft_variable_row_allowed(variable=variable, variable_id="var-1")


def test_ensure_snippet_draft_variable_row_allowed_rejects_conversation_variable():
    variable = SimpleNamespace(node_id=CONVERSATION_VARIABLE_NODE_ID)

    with pytest.raises(module.NotFoundError, match="variable not found"):
        module._ensure_snippet_draft_variable_row_allowed(variable=variable, variable_id="var-1")


def test_ensure_snippet_draft_variable_row_allowed_accepts_canvas_node_variable():
    variable = SimpleNamespace(node_id="llm-1")

    module._ensure_snippet_draft_variable_row_allowed(variable=variable, variable_id="var-1")


def test_conversation_variables_returns_empty_list(app):
    api = module.SnippetConversationVariableCollectionApi()
    handler = _unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, snippet=SimpleNamespace(id="snippet-1"))

    assert result == WorkflowDraftVariableList(variables=[])


def test_system_variables_returns_empty_list(app):
    api = module.SnippetSystemVariableCollectionApi()
    handler = _unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, snippet=SimpleNamespace(id="snippet-1"))

    assert result == WorkflowDraftVariableList(variables=[])


def test_delete_variable_collection_deletes_current_user_variables(app, monkeypatch):
    draft_var_service = SimpleNamespace(delete_user_workflow_variables=Mock())
    monkeypatch.setattr(module, "WorkflowDraftVariableService", Mock(return_value=draft_var_service))
    monkeypatch.setattr(module, "current_user", SimpleNamespace(id="user-1"))
    db_session = Mock()
    db_session.return_value = SimpleNamespace()
    monkeypatch.setattr(module.db, "session", db_session)
    api = module.SnippetWorkflowVariableCollectionApi()
    handler = _unwrap(api.delete)

    with app.test_request_context("/", method="DELETE"):
        response = handler(api, snippet=SimpleNamespace(id="snippet-1"))

    assert response.status_code == 204
    draft_var_service.delete_user_workflow_variables.assert_called_once_with("snippet-1", user_id="user-1")
    db_session.commit.assert_called_once()
