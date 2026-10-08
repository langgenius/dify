"""Direct-call tests for the app draft-variable handlers converted to `@with_session`."""

import json
from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session

from controllers.console.app import workflow_draft_variable as module
from graphon.variables.segments import StringSegment
from models.account import Account, AccountStatus
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowDraftVariable

_APP_ID = "app-1"
_USER_ID = "user-1"


def _make_account() -> Account:
    account = Account(
        name="tester",
        email="tester@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = _USER_ID  # type: ignore[assignment]
    return account


def _make_app_model() -> App:
    return App(
        id=_APP_ID,
        tenant_id="tenant-1",
        name="App",
        mode=AppMode.ADVANCED_CHAT,
        enable_site=True,
        enable_api=True,
    )


def _make_draft_workflow() -> Workflow:
    workflow = Workflow.new(
        tenant_id="tenant-1",
        app_id=_APP_ID,
        type="workflow",
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps({"nodes": [], "edges": []}),
        features="{}",
        created_by=_USER_ID,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    workflow.id = "workflow-1"
    return workflow


def _make_node_variable(variable_id: str, *, node_id: str = "llm-1") -> WorkflowDraftVariable:
    variable = WorkflowDraftVariable.new_node_variable(
        app_id=_APP_ID,
        user_id=_USER_ID,
        node_id=node_id,
        name=variable_id,
        value=StringSegment(value=f"value-{variable_id}"),
        node_execution_id="execution-1",
    )
    variable.id = variable_id
    return variable


def _make_system_variable(variable_id: str, *, name: str) -> WorkflowDraftVariable:
    variable = WorkflowDraftVariable.new_sys_variable(
        app_id=_APP_ID,
        user_id=_USER_ID,
        name=name,
        value=StringSegment(value=f"value-{name}"),
        node_execution_id="execution-1",
    )
    variable.id = variable_id
    return variable


@pytest.fixture
def app() -> Flask:
    app = Flask("test_workflow_draft_variable_handlers")
    app.config["TESTING"] = True
    return app


def test_node_variable_collection_get_returns_decoded_values(app: Flask, sqlite_session: Session) -> None:
    variable = _make_node_variable("var-1")
    sqlite_session.add(variable)
    sqlite_session.commit()
    api = module.NodeVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, sqlite_session, _make_account(), app_model=_make_app_model(), node_id="llm-1")

    assert [item["id"] for item in result["items"]] == ["var-1"]
    assert result["items"][0]["value"] == "value-var-1"


def test_variable_get_returns_decoded_value(app: Flask, sqlite_session: Session) -> None:
    variable = _make_node_variable("var-1")
    sqlite_session.add(variable)
    sqlite_session.commit()
    api = module.VariableApi()
    handler = unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, sqlite_session, _make_account(), app_model=_make_app_model(), variable_id="var-1")

    assert result["id"] == "var-1"
    assert result["value"] == "value-var-1"


def test_variable_patch_without_changes_returns_variable(app: Flask, sqlite_session: Session) -> None:
    variable = _make_node_variable("var-1")
    sqlite_session.add(variable)
    sqlite_session.commit()
    api = module.VariableApi()
    handler = unwrap(api.patch)

    with app.test_request_context("/", method="PATCH", json={}):
        result = handler(
            api,
            sqlite_session,
            module.WorkflowDraftVariableUpdatePayload(),
            _make_account(),
            app_model=_make_app_model(),
            variable_id="var-1",
        )

    assert result["id"] == "var-1"
    assert result["value"] == "value-var-1"


def test_variable_patch_renames_variable(app: Flask, sqlite_session: Session) -> None:
    variable = _make_node_variable("var-1")
    sqlite_session.add(variable)
    sqlite_session.commit()
    api = module.VariableApi()
    handler = unwrap(api.patch)

    with app.test_request_context("/", method="PATCH", json={"name": "renamed"}):
        result = handler(
            api,
            sqlite_session,
            module.WorkflowDraftVariableUpdatePayload(name="renamed"),
            _make_account(),
            app_model=_make_app_model(),
            variable_id="var-1",
        )

    assert result["name"] == "renamed"
    stored = sqlite_session.get(WorkflowDraftVariable, "var-1")
    assert stored is not None
    assert stored.name == "renamed"


def test_variable_reset_returns_default_value(app: Flask, sqlite_session: Session) -> None:
    workflow = _make_draft_workflow()
    variable = _make_node_variable("var-1")
    variable.node_execution_id = None
    sqlite_session.add_all([workflow, variable])
    sqlite_session.commit()
    api = module.VariableResetApi()
    handler = unwrap(api.put)

    workflow_service = MagicMock()
    workflow_service.get_draft_workflow.return_value = workflow
    with (
        app.test_request_context("/", method="PUT"),
        patch.object(module, "WorkflowService", return_value=workflow_service),
    ):
        response = handler(api, sqlite_session, _make_account(), app_model=_make_app_model(), variable_id="var-1")

    # A node variable without an associated execution has no default to restore, so the
    # handler answers 204 after removing the row.
    assert response.status_code == 204


def test_conversation_variable_collection_get_lists_conversation_variables(app: Flask, sqlite_session: Session) -> None:
    workflow = _make_draft_workflow()
    conv_var = WorkflowDraftVariable.new_conversation_variable(
        app_id=_APP_ID,
        name="conv_var",
        value=StringSegment(value="conv-value"),
    )
    conv_var.id = "conv-1"
    conv_var.user_id = _USER_ID
    sqlite_session.add_all([workflow, conv_var])
    sqlite_session.commit()
    api = module.ConversationVariableCollectionApi()
    handler = unwrap(api.get)

    workflow_service = MagicMock()
    workflow_service.get_draft_workflow.return_value = workflow
    with (
        app.test_request_context("/"),
        patch.object(module, "WorkflowService", return_value=workflow_service),
    ):
        result = handler(api, sqlite_session, _make_account(), app_model=_make_app_model())

    assert [item["id"] for item in result["items"]] == ["conv-1"]
    assert result["items"][0]["value"] == "conv-value"


def test_system_variable_collection_get_lists_system_variables(app: Flask, sqlite_session: Session) -> None:
    sys_var = _make_system_variable("sys-1", name="query")
    sqlite_session.add(sys_var)
    sqlite_session.commit()
    api = module.SystemVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, sqlite_session, _make_account(), app_model=_make_app_model())

    assert [item["id"] for item in result["items"]] == ["sys-1"]
    assert result["items"][0]["value"] == "value-query"
