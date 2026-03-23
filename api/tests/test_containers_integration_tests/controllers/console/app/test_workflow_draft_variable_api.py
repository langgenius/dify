"""Authenticated controller integration tests for workflow draft variable APIs."""

import uuid

from flask.testing import FlaskClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from dify_graph.variables.segments import StringSegment
from models import Workflow
from models.model import AppMode
from models.workflow import WorkflowDraftVariable
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
    create_console_app,
)


def _create_draft_workflow(db_session: Session, app_id: str, tenant_id: str, account_id: str) -> Workflow:
    workflow = Workflow.new(
        tenant_id=tenant_id,
        app_id=app_id,
        type="workflow",
        version=Workflow.VERSION_DRAFT,
        graph='{"nodes": [], "edges": []}',
        features="{}",
        created_by=account_id,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    db_session.add(workflow)
    db_session.commit()
    return workflow


def _create_node_variable(
    db_session: Session, app_id: str, user_id: str, name: str = "test_var"
) -> WorkflowDraftVariable:
    variable = WorkflowDraftVariable.new_node_variable(
        app_id=app_id,
        user_id=user_id,
        node_id="node_1",
        name=name,
        value=StringSegment(value="test_value"),
        node_execution_id=str(uuid.uuid4()),
        visible=True,
        editable=True,
    )
    db_session.add(variable)
    db_session.commit()
    return variable


def test_variable_api_get_success(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.WORKFLOW)
    _create_draft_workflow(db_session_with_containers, app.id, tenant.id, account.id)
    variable = _create_node_variable(db_session_with_containers, app.id, account.id)

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/workflows/draft/variables/{variable.id}",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload is not None
    assert payload["id"] == variable.id
    assert payload["name"] == "test_var"


def test_variable_api_patch_success(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.WORKFLOW)
    _create_draft_workflow(db_session_with_containers, app.id, tenant.id, account.id)
    variable = _create_node_variable(db_session_with_containers, app.id, account.id)

    response = test_client_with_containers.patch(
        f"/console/api/apps/{app.id}/workflows/draft/variables/{variable.id}",
        headers=authenticate_console_client(test_client_with_containers, account),
        json={"name": "renamed_var"},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload is not None
    assert payload["id"] == variable.id
    assert payload["name"] == "renamed_var"

    refreshed = db_session_with_containers.scalar(
        select(WorkflowDraftVariable).where(WorkflowDraftVariable.id == variable.id)
    )
    assert refreshed is not None
    assert refreshed.name == "renamed_var"


def test_variable_api_delete_success(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.WORKFLOW)
    _create_draft_workflow(db_session_with_containers, app.id, tenant.id, account.id)
    variable = _create_node_variable(db_session_with_containers, app.id, account.id)

    response = test_client_with_containers.delete(
        f"/console/api/apps/{app.id}/workflows/draft/variables/{variable.id}",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 204
    assert db_session_with_containers.scalar(
        select(WorkflowDraftVariable).where(WorkflowDraftVariable.id == variable.id)
    ) is None


def test_variable_reset_api_put_success_returns_no_content_without_execution(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.WORKFLOW)
    _create_draft_workflow(db_session_with_containers, app.id, tenant.id, account.id)
    variable = _create_node_variable(db_session_with_containers, app.id, account.id)

    response = test_client_with_containers.put(
        f"/console/api/apps/{app.id}/workflows/draft/variables/{variable.id}/reset",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 204
    assert db_session_with_containers.scalar(
        select(WorkflowDraftVariable).where(WorkflowDraftVariable.id == variable.id)
    ) is None
