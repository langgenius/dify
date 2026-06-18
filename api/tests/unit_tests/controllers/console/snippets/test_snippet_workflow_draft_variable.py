from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask

from controllers.console.snippets import snippet_workflow_draft_variable as module
from core.workflow.variable_prefixes import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from models.account import Account, AccountStatus
from services.workflow_draft_variable_service import WorkflowDraftVariableList


def _unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


def _make_account() -> Account:
    account = Account(
        name="tester",
        email="tester@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = "user-1"  # type: ignore[assignment]
    return account


@pytest.fixture(autouse=True)
def _patch_snippet_service_factory(monkeypatch):
    def factory():
        service_factory = module.SnippetService
        if isinstance(service_factory, type):
            return service_factory.__new__(service_factory)
        return service_factory()

    monkeypatch.setattr(module, "_snippet_service", factory)


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
        result = handler(api, _make_account(), snippet=SimpleNamespace(id="snippet-1"))

    assert result == WorkflowDraftVariableList(variables=[])


def test_system_variables_returns_empty_list(app):
    api = module.SnippetSystemVariableCollectionApi()
    handler = _unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, _make_account(), snippet=SimpleNamespace(id="snippet-1"))

    assert result == WorkflowDraftVariableList(variables=[])


def test_delete_variable_collection_deletes_current_user_variables(app: Flask, monkeypatch: pytest.MonkeyPatch):
    draft_var_service = SimpleNamespace(delete_user_workflow_variables=Mock())
    monkeypatch.setattr(module, "WorkflowDraftVariableService", Mock(return_value=draft_var_service))
    db_session = Mock()
    db_session.return_value = SimpleNamespace()
    monkeypatch.setattr(module.db, "session", db_session)
    api = module.SnippetWorkflowVariableCollectionApi()
    handler = _unwrap(api.delete)

    with app.test_request_context("/", method="DELETE"):
        response = handler(api, _make_account(), snippet=SimpleNamespace(id="snippet-1"))

    assert response.status_code == 204
    draft_var_service.delete_user_workflow_variables.assert_called_once_with("snippet-1", user_id="user-1")
    db_session.commit.assert_called_once()


def test_variable_collection_get_raises_when_draft_workflow_missing(app: Flask, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        module,
        "SnippetService",
        Mock(return_value=SimpleNamespace(get_draft_workflow=Mock(return_value=None))),
    )

    api = module.SnippetWorkflowVariableCollectionApi()
    handler = _unwrap(api.get)

    with app.test_request_context("/?page=1&limit=20"):
        with pytest.raises(module.DraftWorkflowNotExist):
            handler(api, _make_account(), snippet=SimpleNamespace(id="snippet-1"))


def test_node_variable_collection_get_lists_node_variables(app: Flask, monkeypatch: pytest.MonkeyPatch):
    variables = WorkflowDraftVariableList(variables=[SimpleNamespace(id="var-1")])
    list_node_variables = Mock(return_value=variables)

    class SessionContext:
        def __init__(self, bind, expire_on_commit=False):
            self.bind = bind
            self.expire_on_commit = expire_on_commit

        def __enter__(self):
            return SimpleNamespace()

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(module, "Session", SessionContext)
    monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        module,
        "WorkflowDraftVariableService",
        Mock(return_value=SimpleNamespace(list_node_variables=list_node_variables)),
    )

    api = module.SnippetNodeVariableCollectionApi()
    handler = _unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, _make_account(), snippet=SimpleNamespace(id="snippet-1"), node_id="llm-1")

    assert result is variables
    list_node_variables.assert_called_once_with("snippet-1", "llm-1", user_id="user-1")


def test_node_variable_collection_delete_deletes_node_variables(app: Flask, monkeypatch: pytest.MonkeyPatch):
    delete_node_variables = Mock()
    draft_var_service = SimpleNamespace(delete_node_variables=delete_node_variables)
    monkeypatch.setattr(module, "WorkflowDraftVariableService", Mock(return_value=draft_var_service))
    db_session = Mock()
    db_session.return_value = SimpleNamespace()
    monkeypatch.setattr(module.db, "session", db_session)

    api = module.SnippetNodeVariableCollectionApi()
    handler = _unwrap(api.delete)

    with app.test_request_context("/", method="DELETE"):
        response = handler(api, _make_account(), snippet=SimpleNamespace(id="snippet-1"), node_id="llm-1")

    assert response.status_code == 204
    delete_node_variables.assert_called_once_with("snippet-1", "llm-1", user_id="user-1")
    db_session.commit.assert_called_once()


def test_variable_patch_returns_variable_when_no_changes(app: Flask, monkeypatch: pytest.MonkeyPatch):
    variable = SimpleNamespace(id="var-1", app_id="snippet-1", user_id="user-1", node_id="llm-1")
    draft_var_service = SimpleNamespace(get_variable=Mock(return_value=variable), update_variable=Mock())
    db_session = Mock()
    db_session.return_value = SimpleNamespace()
    monkeypatch.setattr(module.db, "session", db_session)
    monkeypatch.setattr(module, "WorkflowDraftVariableService", Mock(return_value=draft_var_service))

    api = module.SnippetVariableApi()
    handler = _unwrap(api.patch)

    with app.test_request_context("/", method="PATCH", json={}):
        result = handler(
            api,
            _make_account(),
            snippet=SimpleNamespace(id="snippet-1", tenant_id="tenant-1"),
            variable_id="var-1",
        )

    assert result is variable
    draft_var_service.update_variable.assert_not_called()
    db_session.commit.assert_not_called()


def test_variable_delete_deletes_variable(app: Flask, monkeypatch: pytest.MonkeyPatch):
    variable = SimpleNamespace(id="var-1", app_id="snippet-1", user_id="user-1", node_id="llm-1")
    delete_variable = Mock()
    draft_var_service = SimpleNamespace(get_variable=Mock(return_value=variable), delete_variable=delete_variable)
    db_session = Mock()
    db_session.return_value = SimpleNamespace()
    monkeypatch.setattr(module.db, "session", db_session)
    monkeypatch.setattr(module, "WorkflowDraftVariableService", Mock(return_value=draft_var_service))

    api = module.SnippetVariableApi()
    handler = _unwrap(api.delete)

    with app.test_request_context("/", method="DELETE"):
        response = handler(api, _make_account(), snippet=SimpleNamespace(id="snippet-1"), variable_id="var-1")

    assert response.status_code == 204
    delete_variable.assert_called_once_with(variable)
    db_session.commit.assert_called_once()


def test_variable_reset_returns_no_content_when_reset_result_is_none(app: Flask, monkeypatch: pytest.MonkeyPatch):
    variable = SimpleNamespace(id="var-1", app_id="snippet-1", user_id="user-1", node_id="llm-1")
    draft_workflow = SimpleNamespace(id="workflow-1")
    draft_var_service = SimpleNamespace(
        get_variable=Mock(return_value=variable),
        reset_variable=Mock(return_value=None),
    )
    db_session = Mock()
    db_session.return_value = SimpleNamespace()
    monkeypatch.setattr(module.db, "session", db_session)
    monkeypatch.setattr(module, "WorkflowDraftVariableService", Mock(return_value=draft_var_service))
    monkeypatch.setattr(
        module,
        "SnippetService",
        Mock(return_value=SimpleNamespace(get_draft_workflow=Mock(return_value=draft_workflow))),
    )

    api = module.SnippetVariableResetApi()
    handler = _unwrap(api.put)

    with app.test_request_context("/", method="PUT"):
        response = handler(api, _make_account(), snippet=SimpleNamespace(id="snippet-1"), variable_id="var-1")

    assert response.status_code == 204
    draft_var_service.reset_variable.assert_called_once_with(draft_workflow, variable)
    db_session.commit.assert_called_once()


def test_environment_variables_returns_workflow_environment_variables(app: Flask, monkeypatch: pytest.MonkeyPatch):
    env_var = SimpleNamespace(
        id="env-1",
        name="API_KEY",
        description="secret",
        selector=["env", "API_KEY"],
        value_type=SimpleNamespace(exposed_type=Mock(return_value=SimpleNamespace(value="secret"))),
        value="sk-test",
    )
    monkeypatch.setattr(
        module,
        "SnippetService",
        Mock(
            return_value=SimpleNamespace(
                get_draft_workflow=Mock(return_value=SimpleNamespace(environment_variables=[env_var]))
            )
        ),
    )

    api = module.SnippetEnvironmentVariableCollectionApi()
    handler = _unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, _make_account(), snippet=SimpleNamespace(id="snippet-1"))

    assert result == {
        "items": [
            {
                "id": "env-1",
                "type": "env",
                "name": "API_KEY",
                "description": "secret",
                "selector": ["env", "API_KEY"],
                "value_type": "secret",
                "value": "sk-test",
                "edited": False,
                "visible": True,
                "editable": True,
            }
        ]
    }
