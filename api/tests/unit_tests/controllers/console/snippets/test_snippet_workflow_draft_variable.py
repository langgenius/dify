from collections.abc import Iterator
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from sqlalchemy import event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from controllers.console.snippets import snippet_workflow_draft_variable as module
from graphon.variables import StringSegment
from models.account import Account, AccountStatus
from models.workflow import WorkflowDraftVariable, WorkflowDraftVariableFile
from services.workflow_draft_variable_service import WorkflowDraftVariableList

pytestmark = [
    pytest.mark.usefixtures("sqlite_session"),
    pytest.mark.parametrize(
        "sqlite_session",
        [(WorkflowDraftVariable, WorkflowDraftVariableFile)],
        indirect=True,
    ),
]


def _make_account() -> Account:
    account = Account(
        name="tester",
        email="tester@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = "user-1"  # type: ignore[assignment]
    return account


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


@pytest.fixture(autouse=True)
def _patch_snippet_service_factory(monkeypatch: pytest.MonkeyPatch) -> None:
    def factory():
        service_factory = module.SnippetService
        if isinstance(service_factory, type):
            return service_factory.__new__(service_factory)
        return service_factory()

    monkeypatch.setattr(module, "_snippet_service", factory)


@pytest.fixture
def app() -> Flask:
    app = Flask("test_snippet_workflow_draft_variable")
    app.config["TESTING"] = True
    return app


@pytest.fixture
def controller_sessions(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
) -> Iterator[scoped_session[Session]]:
    """Bind both controller session styles to the isolated SQLite engine."""
    sessions = scoped_session(sessionmaker(bind=sqlite_engine, expire_on_commit=False))
    monkeypatch.setattr(module, "db", SimpleNamespace(engine=sqlite_engine, session=sessions))
    try:
        yield sessions
    finally:
        sessions.remove()


def _persist_variables(sqlite_session: Session, *variables: WorkflowDraftVariable) -> None:
    sqlite_session.add_all(variables)
    sqlite_session.commit()


def _variable_ids(sqlite_engine: Engine) -> set[str]:
    with Session(sqlite_engine) as session:
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
        result = handler(api, _make_account(), snippet=SimpleNamespace(id="snippet-1"))

    assert result == WorkflowDraftVariableList(variables=[])


def test_system_variables_returns_empty_list(app: Flask) -> None:
    api = module.SnippetSystemVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, _make_account(), snippet=SimpleNamespace(id="snippet-1"))

    assert result == WorkflowDraftVariableList(variables=[])


def test_delete_variable_collection_deletes_only_current_user_variables(
    app: Flask,
    sqlite_session: Session,
    sqlite_engine: Engine,
    controller_sessions: scoped_session[Session],
) -> None:
    matching = _make_node_variable("matching", name="matching")
    matching_second = _make_node_variable("matching-second", node_id="tool-1", name="matching-second")
    other_user = _make_node_variable("other-user", user_id="user-2", name="other-user")
    other_snippet = _make_node_variable("other-snippet", app_id="snippet-2", name="other-snippet")
    _persist_variables(sqlite_session, matching, matching_second, other_user, other_snippet)
    api = module.SnippetWorkflowVariableCollectionApi()
    handler = unwrap(api.delete)

    with app.test_request_context("/", method="DELETE"):
        response = handler(api, _make_account(), snippet=SimpleNamespace(id="snippet-1"))

    assert response.status_code == 204
    assert _variable_ids(sqlite_engine) == {other_user.id, other_snippet.id}
    assert not controller_sessions().in_transaction()


def test_variable_collection_get_raises_when_draft_workflow_missing(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        module,
        "SnippetService",
        Mock(return_value=SimpleNamespace(get_draft_workflow=Mock(return_value=None))),
    )

    api = module.SnippetWorkflowVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/?page=1&limit=20"):
        with pytest.raises(module.DraftWorkflowNotExist):
            handler(api, _make_account(), snippet=SimpleNamespace(id="snippet-1"))


def test_node_variable_collection_get_lists_persisted_node_variables(
    app: Flask,
    sqlite_session: Session,
    controller_sessions: scoped_session[Session],
) -> None:
    matching = _make_node_variable("matching", name="matching")
    other_node = _make_node_variable("other-node", node_id="tool-1", name="other-node")
    other_user = _make_node_variable("other-user", user_id="user-2", name="other-user")
    other_snippet = _make_node_variable("other-snippet", app_id="snippet-2", name="other-snippet")
    _persist_variables(sqlite_session, matching, other_node, other_user, other_snippet)
    api = module.SnippetNodeVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, _make_account(), snippet=SimpleNamespace(id="snippet-1"), node_id="llm-1")

    assert [variable.id for variable in result.variables] == [matching.id]
    assert controller_sessions().get_bind() is not None


def test_node_variable_collection_delete_deletes_only_requested_node_variables(
    app: Flask,
    sqlite_session: Session,
    sqlite_engine: Engine,
    controller_sessions: scoped_session[Session],
) -> None:
    matching = _make_node_variable("matching", name="matching")
    matching_second = _make_node_variable("matching-second", name="matching-second")
    other_node = _make_node_variable("other-node", node_id="tool-1", name="other-node")
    other_user = _make_node_variable("other-user", user_id="user-2", name="other-user")
    _persist_variables(sqlite_session, matching, matching_second, other_node, other_user)
    api = module.SnippetNodeVariableCollectionApi()
    handler = unwrap(api.delete)

    with app.test_request_context("/", method="DELETE"):
        response = handler(api, _make_account(), snippet=SimpleNamespace(id="snippet-1"), node_id="llm-1")

    assert response.status_code == 204
    assert _variable_ids(sqlite_engine) == {other_node.id, other_user.id}
    assert not controller_sessions().in_transaction()


def test_variable_patch_returns_persisted_variable_without_committing_when_no_changes(
    app: Flask,
    sqlite_session: Session,
    controller_sessions: scoped_session[Session],
) -> None:
    variable = _make_node_variable("var-1")
    _persist_variables(sqlite_session, variable)
    session = controller_sessions()
    commits: list[bool] = []

    def record_commit(_session: Session) -> None:
        commits.append(True)

    event.listen(session, "after_commit", record_commit)
    api = module.SnippetVariableApi()
    handler = unwrap(api.patch)
    try:
        with app.test_request_context("/", method="PATCH", json={}):
            result = handler(
                api,
                _make_account(),
                snippet=SimpleNamespace(id="snippet-1", tenant_id="tenant-1"),
                variable_id="var-1",
            )
    finally:
        event.remove(session, "after_commit", record_commit)

    assert result.id == variable.id
    assert result.app_id == "snippet-1"
    assert commits == []
    assert session.in_transaction()


def test_variable_delete_deletes_persisted_variable(
    app: Flask,
    sqlite_session: Session,
    sqlite_engine: Engine,
    controller_sessions: scoped_session[Session],
) -> None:
    variable = _make_node_variable("var-1")
    retained = _make_node_variable("var-2", name="retained")
    _persist_variables(sqlite_session, variable, retained)
    api = module.SnippetVariableApi()
    handler = unwrap(api.delete)

    with app.test_request_context("/", method="DELETE"):
        response = handler(
            api,
            _make_account(),
            snippet=SimpleNamespace(id="snippet-1"),
            variable_id=variable.id,
        )

    assert response.status_code == 204
    assert _variable_ids(sqlite_engine) == {retained.id}
    assert not controller_sessions().in_transaction()


def test_variable_reset_deletes_variable_without_node_execution(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_engine: Engine,
    controller_sessions: scoped_session[Session],
) -> None:
    variable = _make_node_variable("var-1", node_execution_id=None)
    _persist_variables(sqlite_session, variable)
    monkeypatch.setattr(
        module,
        "SnippetService",
        Mock(return_value=SimpleNamespace(get_draft_workflow=Mock(return_value=SimpleNamespace(id="workflow-1")))),
    )
    api = module.SnippetVariableResetApi()
    handler = unwrap(api.put)

    with app.test_request_context("/", method="PUT"):
        response = handler(
            api,
            _make_account(),
            snippet=SimpleNamespace(id="snippet-1"),
            variable_id=variable.id,
        )

    assert response.status_code == 204
    assert _variable_ids(sqlite_engine) == set()
    assert not controller_sessions().in_transaction()


def test_environment_variables_returns_workflow_environment_variables(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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
    handler = unwrap(api.get)

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
