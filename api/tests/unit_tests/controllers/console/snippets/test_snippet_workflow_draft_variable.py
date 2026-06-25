import json
import uuid
from contextlib import nullcontext
from inspect import unwrap
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import Mock

import pytest
from flask import Flask

from controllers.console.snippets import snippet_workflow_draft_variable as module
from factories.variable_factory import build_environment_variable_from_mapping, build_segment
from graphon.variables.types import SegmentType
from models import workflow as workflow_model_module
from models.account import Account, AccountStatus
from models.snippet import CustomizedSnippet
from models.workflow import Workflow, WorkflowDraftVariable, WorkflowType
from services.workflow_draft_variable_service import WorkflowDraftVariableList

_TEST_SNIPPET_ID = str(uuid.uuid4())
_TEST_TENANT_ID = str(uuid.uuid4())
_TEST_USER_ID = str(uuid.uuid4())
_TEST_NODE_EXECUTION_ID = str(uuid.uuid4())


def _make_account() -> Account:
    account = Account(
        name="tester",
        email="tester@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = _TEST_USER_ID
    return account


def _make_snippet() -> CustomizedSnippet:
    snippet = CustomizedSnippet()
    snippet.id = _TEST_SNIPPET_ID
    snippet.tenant_id = _TEST_TENANT_ID
    snippet.name = "Reusable snippet"
    snippet.description = "Snippet under test"
    snippet.type = "node"
    return snippet


def _make_draft_workflow(*, environment_variables: list[Any] | None = None) -> Workflow:
    workflow = Workflow()
    workflow.id = str(uuid.uuid4())
    workflow.tenant_id = _TEST_TENANT_ID
    workflow.app_id = _TEST_SNIPPET_ID
    workflow.type = WorkflowType.SNIPPET
    workflow.version = Workflow.VERSION_DRAFT
    workflow.graph = "{}"
    workflow.features = "{}"
    workflow.created_by = _TEST_USER_ID
    workflow._environment_variables = json.dumps(
        {variable.id: variable.model_dump(mode="json") for variable in environment_variables or []}
    )
    return workflow


def _make_node_variable(
    *, value: Any = "value", node_id: str = "llm-1", name: str = "node_var"
) -> WorkflowDraftVariable:
    return WorkflowDraftVariable.new_node_variable(
        app_id=_TEST_SNIPPET_ID,
        user_id=_TEST_USER_ID,
        node_id=node_id,
        name=name,
        value=build_segment(value),
        node_execution_id=_TEST_NODE_EXECUTION_ID,
    )


def _make_system_variable() -> WorkflowDraftVariable:
    return WorkflowDraftVariable.new_sys_variable(
        app_id=_TEST_SNIPPET_ID,
        user_id=_TEST_USER_ID,
        name="query",
        value=build_segment("hello"),
        node_execution_id=_TEST_NODE_EXECUTION_ID,
    )


def _make_conversation_variable() -> WorkflowDraftVariable:
    return WorkflowDraftVariable.new_conversation_variable(
        app_id=_TEST_SNIPPET_ID,
        user_id=_TEST_USER_ID,
        name="topic",
        value=build_segment("support"),
    )


def _expected_variable_payload(variable: WorkflowDraftVariable, *, value: Any) -> dict[str, Any]:
    expected_without_value = _expected_variable_without_value_payload(variable)
    return {
        **expected_without_value,
        "value": value,
        "full_content": None,
    }


def _expected_variable_without_value_payload(variable: WorkflowDraftVariable) -> dict[str, Any]:
    return {
        "id": variable.id,
        "type": "node",
        "name": variable.name,
        "description": "",
        "selector": [variable.node_id, variable.name],
        "value_type": str(variable.value_type.exposed_type()),
        "edited": False,
        "visible": True,
        "is_truncated": False,
    }


@pytest.fixture(autouse=True)
def _patch_snippet_service_factory(monkeypatch: pytest.MonkeyPatch):
    def factory():
        service_factory = module.SnippetService
        if isinstance(service_factory, type):
            return cast(Any, service_factory).__new__(service_factory)
        return service_factory()

    monkeypatch.setattr(module, "_snippet_service", factory)


@pytest.fixture
def app():
    app = Flask("test_snippet_workflow_draft_variable")
    app.config["TESTING"] = True
    return app


def test_ensure_snippet_draft_variable_row_allowed_rejects_system_variable():
    with pytest.raises(module.NotFoundError, match="variable not found"):
        module._ensure_snippet_draft_variable_row_allowed(variable=_make_system_variable(), variable_id="var-1")


def test_ensure_snippet_draft_variable_row_allowed_rejects_conversation_variable():
    with pytest.raises(module.NotFoundError, match="variable not found"):
        module._ensure_snippet_draft_variable_row_allowed(variable=_make_conversation_variable(), variable_id="var-1")


def test_ensure_snippet_draft_variable_row_allowed_accepts_canvas_node_variable():
    module._ensure_snippet_draft_variable_row_allowed(variable=_make_node_variable(), variable_id="var-1")


def test_conversation_variables_returns_empty_list(app: Flask):
    api = module.SnippetConversationVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, _make_account(), snippet=_make_snippet())

    assert result == {"items": []}


def test_system_variables_returns_empty_list(app: Flask):
    api = module.SnippetSystemVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, _make_account(), snippet=_make_snippet())

    assert result == {"items": []}


def test_delete_variable_collection_deletes_current_user_variables(app: Flask, monkeypatch: pytest.MonkeyPatch):
    draft_var_service = SimpleNamespace(delete_user_workflow_variables=Mock())
    monkeypatch.setattr(module, "WorkflowDraftVariableService", Mock(return_value=draft_var_service))
    db_session = Mock()
    db_session.return_value = SimpleNamespace()
    monkeypatch.setattr(module.db, "session", db_session)
    api = module.SnippetWorkflowVariableCollectionApi()
    handler = unwrap(api.delete)

    with app.test_request_context("/", method="DELETE"):
        response = handler(api, _make_account(), snippet=_make_snippet())

    assert response == ("", 204)
    draft_var_service.delete_user_workflow_variables.assert_called_once_with(_TEST_SNIPPET_ID, user_id=_TEST_USER_ID)
    db_session.commit.assert_called_once()


def test_variable_collection_get_raises_when_draft_workflow_missing(app: Flask, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        module,
        "SnippetService",
        Mock(return_value=SimpleNamespace(get_draft_workflow=Mock(return_value=None))),
    )

    api = module.SnippetWorkflowVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/?page=1&limit=20"):
        with pytest.raises(module.DraftWorkflowNotExist):
            handler(api, _make_account(), snippet=_make_snippet())


def test_variable_collection_get_returns_without_value_contract(app, monkeypatch):
    variable = _make_node_variable(value="hidden-value")
    draft_workflow = _make_draft_workflow()
    captured_args: dict[str, Any] = {}

    class DraftVariableService:
        def __init__(self, *, session: object) -> None:
            captured_args["session"] = session

        def list_variables_without_values(self, **kwargs: Any) -> WorkflowDraftVariableList:
            captured_args.update(kwargs)
            return WorkflowDraftVariableList(variables=[variable], total=9)

    session = object()
    monkeypatch.setattr(
        module,
        "SnippetService",
        Mock(return_value=SimpleNamespace(get_draft_workflow=Mock(return_value=draft_workflow))),
    )
    monkeypatch.setattr(module, "WorkflowDraftVariableService", DraftVariableService)
    monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        module,
        "Session",
        lambda *args, **kwargs: nullcontext(session),
    )

    api = module.SnippetWorkflowVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/?page=2&limit=3", method="GET"):
        result = handler(api, _make_account(), snippet=_make_snippet())

    expected = {"items": [_expected_variable_without_value_payload(variable)], "total": 9}
    assert captured_args == {
        "session": session,
        "app_id": _TEST_SNIPPET_ID,
        "page": 2,
        "limit": 3,
        "user_id": _TEST_USER_ID,
        "exclude_node_ids": module._SNIPPET_EXCLUDED_DRAFT_VARIABLE_NODE_IDS,
    }
    assert result == expected
    module.WorkflowDraftVariableListWithoutValueResponse.model_validate(result)


def test_node_variable_collection_get_lists_node_variables(app: Flask, monkeypatch: pytest.MonkeyPatch):
    variable = _make_node_variable(value=None)
    variables = WorkflowDraftVariableList(variables=[variable])
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
    handler = unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, _make_account(), snippet=_make_snippet(), node_id="llm-1")

    expected = {"items": [_expected_variable_payload(variable, value=None)]}
    assert result == expected
    module.WorkflowDraftVariableListResponse.model_validate(result)
    list_node_variables.assert_called_once_with(_TEST_SNIPPET_ID, "llm-1", user_id=_TEST_USER_ID)


def test_node_variable_collection_delete_deletes_node_variables(app: Flask, monkeypatch: pytest.MonkeyPatch):
    delete_node_variables = Mock()
    draft_var_service = SimpleNamespace(delete_node_variables=delete_node_variables)
    monkeypatch.setattr(module, "WorkflowDraftVariableService", Mock(return_value=draft_var_service))
    db_session = Mock()
    db_session.return_value = SimpleNamespace()
    monkeypatch.setattr(module.db, "session", db_session)

    api = module.SnippetNodeVariableCollectionApi()
    handler = unwrap(api.delete)

    with app.test_request_context("/", method="DELETE"):
        response = handler(api, _make_account(), snippet=_make_snippet(), node_id="llm-1")

    assert response == ("", 204)
    delete_node_variables.assert_called_once_with(_TEST_SNIPPET_ID, "llm-1", user_id=_TEST_USER_ID)
    db_session.commit.assert_called_once()


def test_variable_patch_returns_variable_when_no_changes(app: Flask, monkeypatch: pytest.MonkeyPatch):
    variable = _make_node_variable(value=42)
    draft_var_service = SimpleNamespace(get_variable=Mock(return_value=variable), update_variable=Mock())
    db_session = Mock()
    db_session.return_value = SimpleNamespace()
    monkeypatch.setattr(module.db, "session", db_session)
    monkeypatch.setattr(module, "WorkflowDraftVariableService", Mock(return_value=draft_var_service))

    api = module.SnippetVariableApi()
    handler = unwrap(api.patch)

    with app.test_request_context("/", method="PATCH", json={}):
        result = handler(
            api,
            _make_account(),
            snippet=_make_snippet(),
            variable_id=variable.id,
        )

    expected = _expected_variable_payload(variable, value=42)
    assert result == expected
    module.WorkflowDraftVariableResponse.model_validate(result)
    draft_var_service.update_variable.assert_not_called()
    db_session.commit.assert_not_called()


def test_variable_get_returns_raw_response_contract(app: Flask, monkeypatch: pytest.MonkeyPatch):
    variable = _make_node_variable(value={"count": 2, "enabled": True})
    draft_var_service = SimpleNamespace(get_variable=Mock(return_value=variable))
    db_session = Mock()
    db_session.return_value = SimpleNamespace()
    monkeypatch.setattr(module.db, "session", db_session)
    monkeypatch.setattr(module, "WorkflowDraftVariableService", Mock(return_value=draft_var_service))

    api = module.SnippetVariableApi()
    handler = unwrap(api.get)

    with app.test_request_context("/", method="GET"):
        result = handler(api, _make_account(), snippet=_make_snippet(), variable_id=variable.id)

    expected = _expected_variable_payload(variable, value={"count": 2, "enabled": True})
    assert result == expected
    module.WorkflowDraftVariableResponse.model_validate(result)
    draft_var_service.get_variable.assert_called_once_with(variable_id=variable.id)


def test_variable_patch_updates_from_pydantic_payload_and_returns_raw_contract(
    app: Flask, monkeypatch: pytest.MonkeyPatch
):
    variable = _make_node_variable(value=1, name="old_name")
    request_model = module.WorkflowDraftVariableUpdatePayload.model_validate({"name": "renamed", "value": 13})

    class DraftVariableService:
        def __init__(self, session: object) -> None:
            pass

        def get_variable(self, *, variable_id: str) -> WorkflowDraftVariable:
            assert variable_id == variable.id
            return variable

        def update_variable(self, target: WorkflowDraftVariable, *, name: str | None, value: Any) -> None:
            assert target is variable
            assert name == "renamed"
            target.set_name(name)
            target.set_value(value)

    session = Mock(return_value=object())
    session.commit = Mock()
    monkeypatch.setattr(module, "WorkflowDraftVariableService", DraftVariableService)
    monkeypatch.setattr(module.db, "session", session)

    api = module.SnippetVariableApi()
    handler = unwrap(api.patch)

    with app.test_request_context("/", method="PATCH", json=request_model.model_dump(mode="json")):
        result = handler(api, _make_account(), snippet=_make_snippet(), variable_id=variable.id)

    expected = _expected_variable_payload(variable, value=13)
    assert result == expected
    module.WorkflowDraftVariableResponse.model_validate(result)
    session.commit.assert_called_once()


def test_variable_delete_deletes_variable(app: Flask, monkeypatch: pytest.MonkeyPatch):
    variable = _make_node_variable()
    delete_variable = Mock()
    draft_var_service = SimpleNamespace(get_variable=Mock(return_value=variable), delete_variable=delete_variable)
    db_session = Mock()
    db_session.return_value = SimpleNamespace()
    monkeypatch.setattr(module.db, "session", db_session)
    monkeypatch.setattr(module, "WorkflowDraftVariableService", Mock(return_value=draft_var_service))

    api = module.SnippetVariableApi()
    handler = unwrap(api.delete)

    with app.test_request_context("/", method="DELETE"):
        response = handler(api, _make_account(), snippet=_make_snippet(), variable_id=variable.id)

    assert response == ("", 204)
    delete_variable.assert_called_once_with(variable)
    db_session.commit.assert_called_once()


def test_variable_reset_returns_no_content_when_reset_result_is_none(app: Flask, monkeypatch: pytest.MonkeyPatch):
    variable = _make_node_variable()
    draft_workflow = _make_draft_workflow()
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
    handler = unwrap(api.put)

    with app.test_request_context("/", method="PUT"):
        response = handler(api, _make_account(), snippet=_make_snippet(), variable_id=variable.id)

    assert response.status_code == 204
    draft_var_service.reset_variable.assert_called_once_with(draft_workflow, variable)
    db_session.commit.assert_called_once()


def test_variable_reset_returns_raw_response_contract_when_variable_is_reset(
    app: Flask, monkeypatch: pytest.MonkeyPatch
):
    variable = _make_node_variable(value="edited")
    reset_variable = _make_node_variable(value="default")
    reset_variable.id = variable.id
    draft_workflow = _make_draft_workflow()
    draft_var_service = SimpleNamespace(
        get_variable=Mock(return_value=variable),
        reset_variable=Mock(return_value=reset_variable),
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
    handler = unwrap(api.put)

    with app.test_request_context("/", method="PUT"):
        result = handler(api, _make_account(), snippet=_make_snippet(), variable_id=variable.id)

    expected = _expected_variable_payload(reset_variable, value="default")
    assert result == expected
    module.WorkflowDraftVariableResponse.model_validate(result)
    draft_var_service.reset_variable.assert_called_once_with(draft_workflow, variable)
    db_session.commit.assert_called_once()


def test_environment_variables_returns_workflow_environment_variables(app, monkeypatch):
    env_var = build_environment_variable_from_mapping(
        {
            "id": str(uuid.uuid4()),
            "name": "API_KEY",
            "description": "secret",
            "value_type": SegmentType.SECRET,
            "value": "sk-test",
        }
    )
    draft_workflow = _make_draft_workflow(environment_variables=[env_var])
    monkeypatch.setattr(workflow_model_module.encrypter, "decrypt_token", lambda tenant_id, token: token)
    monkeypatch.setattr(
        module,
        "SnippetService",
        Mock(return_value=SimpleNamespace(get_draft_workflow=Mock(return_value=draft_workflow))),
    )

    api = module.SnippetEnvironmentVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, _make_account(), snippet=_make_snippet())

    expected = {
        "items": [
            {
                "id": env_var.id,
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
    assert result == expected
    module.WorkflowDraftEnvironmentVariableListResponse.model_validate(result)
