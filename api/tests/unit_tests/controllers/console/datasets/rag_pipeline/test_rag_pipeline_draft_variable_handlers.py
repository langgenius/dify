"""Direct-call tests for the rag-pipeline draft-variable handlers converted to `@with_session`."""

import json
from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session

from controllers.console.datasets.rag_pipeline import rag_pipeline_draft_variable as module
from graphon.variables.segments import StringSegment
from models.account import Account, AccountStatus
from models.dataset import Pipeline
from models.workflow import Workflow, WorkflowDraftVariable

_PIPELINE_ID = "pipeline-1"
_USER_ID = "user-1"


def _make_account() -> Account:
    account = Account(
        name="tester",
        email="tester@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = _USER_ID  # type: ignore[assignment]
    return account


def _make_pipeline() -> Pipeline:
    pipeline = Pipeline(
        tenant_id="tenant-1",
        name="Pipeline",
    )
    pipeline.id = _PIPELINE_ID
    return pipeline


def _make_draft_workflow() -> Workflow:
    workflow = Workflow.new(
        tenant_id="tenant-1",
        app_id=_PIPELINE_ID,
        type="rag-pipeline",
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


def _make_node_variable(variable_id: str, *, node_id: str = "extract-1") -> WorkflowDraftVariable:
    variable = WorkflowDraftVariable.new_node_variable(
        app_id=_PIPELINE_ID,
        user_id=_USER_ID,
        node_id=node_id,
        name=variable_id,
        value=StringSegment(value=f"value-{variable_id}"),
        node_execution_id="execution-1",
    )
    variable.id = variable_id
    return variable


@pytest.fixture
def app() -> Flask:
    app = Flask("test_rag_pipeline_draft_variable_handlers")
    app.config["TESTING"] = True
    return app


def test_node_variable_collection_get_returns_decoded_values(app: Flask, sqlite_session: Session) -> None:
    variable = _make_node_variable("var-1")
    sqlite_session.add(variable)
    sqlite_session.commit()
    api = module.RagPipelineNodeVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, sqlite_session, _make_account(), pipeline=_make_pipeline(), node_id="extract-1")

    assert [item["id"] for item in result["items"]] == ["var-1"]
    assert result["items"][0]["value"] == "value-var-1"


def test_variable_get_returns_decoded_value(app: Flask, sqlite_session: Session) -> None:
    variable = _make_node_variable("var-1")
    sqlite_session.add(variable)
    sqlite_session.commit()
    api = module.RagPipelineVariableApi()
    handler = unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, sqlite_session, _make_account(), pipeline=_make_pipeline(), variable_id="var-1")

    assert result["id"] == "var-1"
    assert result["value"] == "value-var-1"


def test_variable_patch_without_changes_returns_variable(app: Flask, sqlite_session: Session) -> None:
    variable = _make_node_variable("var-1")
    sqlite_session.add(variable)
    sqlite_session.commit()
    api = module.RagPipelineVariableApi()
    handler = unwrap(api.patch)

    with app.test_request_context("/", method="PATCH", json={}):
        result = handler(
            api,
            sqlite_session,
            module.WorkflowDraftVariablePatchPayload(),
            _make_account(),
            pipeline=_make_pipeline(),
            variable_id="var-1",
        )

    assert result["id"] == "var-1"
    assert result["value"] == "value-var-1"


def test_variable_reset_removes_variable_without_default(app: Flask, sqlite_session: Session) -> None:
    workflow = _make_draft_workflow()
    variable = _make_node_variable("var-1")
    variable.node_execution_id = None
    sqlite_session.add_all([workflow, variable])
    sqlite_session.commit()
    api = module.RagPipelineVariableResetApi()
    handler = unwrap(api.put)

    rag_pipeline_service = MagicMock()
    rag_pipeline_service.get_draft_workflow.return_value = workflow
    with (
        app.test_request_context("/", method="PUT"),
        patch.object(module, "RagPipelineService", return_value=rag_pipeline_service),
    ):
        response = handler(api, sqlite_session, _make_account(), pipeline=_make_pipeline(), variable_id="var-1")

    assert response.status_code == 204


def test_system_variable_collection_get_lists_system_variables(app: Flask, sqlite_session: Session) -> None:
    sys_var = WorkflowDraftVariable.new_sys_variable(
        app_id=_PIPELINE_ID,
        user_id=_USER_ID,
        name="query",
        value=StringSegment(value="sys-value"),
        node_execution_id="execution-1",
    )
    sys_var.id = "sys-1"
    sqlite_session.add(sys_var)
    sqlite_session.commit()
    api = module.RagPipelineSystemVariableCollectionApi()
    handler = unwrap(api.get)

    with app.test_request_context("/"):
        result = handler(api, sqlite_session, _make_account(), pipeline=_make_pipeline())

    assert [item["id"] for item in result["items"]] == ["sys-1"]
    assert result["items"][0]["value"] == "sys-value"
