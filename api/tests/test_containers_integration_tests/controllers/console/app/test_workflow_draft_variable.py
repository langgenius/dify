"""Authenticated controller integration tests for workflow draft variable APIs."""

import uuid

from flask.testing import FlaskClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from dify_graph.constants import CONVERSATION_VARIABLE_NODE_ID, ENVIRONMENT_VARIABLE_NODE_ID
from dify_graph.variables.segments import StringSegment
from factories.variable_factory import segment_to_variable
from models import Workflow
from models.model import AppMode
from models.workflow import WorkflowDraftVariable
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
    create_console_app,
)


def _create_draft_workflow(
    db_session: Session,
    app_id: str,
    tenant_id: str,
    account_id: str,
    *,
    environment_variables: list | None = None,
    conversation_variables: list | None = None,
) -> Workflow:
    workflow = Workflow.new(
        tenant_id=tenant_id,
        app_id=app_id,
        type="workflow",
        version=Workflow.VERSION_DRAFT,
        graph='{"nodes": [], "edges": []}',
        features="{}",
        created_by=account_id,
        environment_variables=environment_variables or [],
        conversation_variables=conversation_variables or [],
        rag_pipeline_variables=[],
    )
    db_session.add(workflow)
    db_session.commit()
    return workflow


def _create_node_variable(
    db_session: Session,
    app_id: str,
    user_id: str,
    *,
    node_id: str = "node_1",
    name: str = "test_var",
) -> WorkflowDraftVariable:
    variable = WorkflowDraftVariable.new_node_variable(
        app_id=app_id,
        user_id=user_id,
        node_id=node_id,
        name=name,
        value=StringSegment(value="test_value"),
        node_execution_id=str(uuid.uuid4()),
        visible=True,
        editable=True,
    )
    db_session.add(variable)
    db_session.commit()
    return variable


def _create_system_variable(
    db_session: Session, app_id: str, user_id: str, name: str = "query"
) -> WorkflowDraftVariable:
    variable = WorkflowDraftVariable.new_sys_variable(
        app_id=app_id,
        user_id=user_id,
        name=name,
        value=StringSegment(value="system-value"),
        node_execution_id=str(uuid.uuid4()),
        editable=True,
    )
    db_session.add(variable)
    db_session.commit()
    return variable


def _build_environment_variable(name: str, value: str):
    return segment_to_variable(
        segment=StringSegment(value=value),
        selector=[ENVIRONMENT_VARIABLE_NODE_ID, name],
        name=name,
        description=f"Environment variable {name}",
    )


def _build_conversation_variable(name: str, value: str):
    return segment_to_variable(
        segment=StringSegment(value=value),
        selector=[CONVERSATION_VARIABLE_NODE_ID, name],
        name=name,
        description=f"Conversation variable {name}",
    )


def test_workflow_variable_collection_get_success(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.WORKFLOW)
    _create_draft_workflow(db_session_with_containers, app.id, tenant.id, account.id)

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/workflows/draft/variables?page=1&limit=20",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    assert response.get_json() == {"items": [], "total": 0}


def test_workflow_variable_collection_get_not_exist(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.WORKFLOW)

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/workflows/draft/variables",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 404
    payload = response.get_json()
    assert payload is not None
    assert payload["code"] == "draft_workflow_not_exist"


def test_workflow_variable_collection_delete(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.WORKFLOW)
    _create_node_variable(db_session_with_containers, app.id, account.id)
    _create_node_variable(db_session_with_containers, app.id, account.id, node_id="node_2", name="other_var")

    response = test_client_with_containers.delete(
        f"/console/api/apps/{app.id}/workflows/draft/variables",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 204
    remaining = db_session_with_containers.scalars(
        select(WorkflowDraftVariable).where(
            WorkflowDraftVariable.app_id == app.id,
            WorkflowDraftVariable.user_id == account.id,
        )
    ).all()
    assert remaining == []


def test_node_variable_collection_get_success(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.WORKFLOW)
    node_variable = _create_node_variable(db_session_with_containers, app.id, account.id, node_id="node_123")
    _create_node_variable(db_session_with_containers, app.id, account.id, node_id="node_456", name="other")

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/workflows/draft/nodes/node_123/variables",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload is not None
    assert [item["id"] for item in payload["items"]] == [node_variable.id]


def test_node_variable_collection_get_invalid_node_id(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.WORKFLOW)

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/workflows/draft/nodes/sys/variables",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 400
    payload = response.get_json()
    assert payload is not None
    assert payload["code"] == "invalid_param"


def test_node_variable_collection_delete(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.WORKFLOW)
    target = _create_node_variable(db_session_with_containers, app.id, account.id, node_id="node_123")
    untouched = _create_node_variable(db_session_with_containers, app.id, account.id, node_id="node_456")
    target_id = target.id
    untouched_id = untouched.id

    response = test_client_with_containers.delete(
        f"/console/api/apps/{app.id}/workflows/draft/nodes/node_123/variables",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 204
    assert (
        db_session_with_containers.scalar(select(WorkflowDraftVariable).where(WorkflowDraftVariable.id == target_id))
        is None
    )
    assert (
        db_session_with_containers.scalar(select(WorkflowDraftVariable).where(WorkflowDraftVariable.id == untouched_id))
        is not None
    )


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


def test_variable_api_get_not_found(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.WORKFLOW)
    _create_draft_workflow(db_session_with_containers, app.id, tenant.id, account.id)

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/workflows/draft/variables/{uuid.uuid4()}",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 404
    payload = response.get_json()
    assert payload is not None
    assert payload["code"] == "not_found"


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
    assert (
        db_session_with_containers.scalar(select(WorkflowDraftVariable).where(WorkflowDraftVariable.id == variable.id))
        is None
    )


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
    assert (
        db_session_with_containers.scalar(select(WorkflowDraftVariable).where(WorkflowDraftVariable.id == variable.id))
        is None
    )


def test_conversation_variable_collection_get(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.WORKFLOW)
    _create_draft_workflow(
        db_session_with_containers,
        app.id,
        tenant.id,
        account.id,
        conversation_variables=[_build_conversation_variable("session_name", "Alice")],
    )

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/workflows/draft/conversation-variables",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload is not None
    assert [item["name"] for item in payload["items"]] == ["session_name"]

    created = db_session_with_containers.scalars(
        select(WorkflowDraftVariable).where(
            WorkflowDraftVariable.app_id == app.id,
            WorkflowDraftVariable.user_id == account.id,
            WorkflowDraftVariable.node_id == CONVERSATION_VARIABLE_NODE_ID,
        )
    ).all()
    assert len(created) == 1


def test_system_variable_collection_get(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.WORKFLOW)
    variable = _create_system_variable(db_session_with_containers, app.id, account.id)

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/workflows/draft/system-variables",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload is not None
    assert [item["id"] for item in payload["items"]] == [variable.id]


def test_environment_variable_collection_get(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.WORKFLOW)
    _create_draft_workflow(
        db_session_with_containers,
        app.id,
        tenant.id,
        account.id,
        environment_variables=[_build_environment_variable("api_key", "secret-value")],
    )

    response = test_client_with_containers.get(
        f"/console/api/apps/{app.id}/workflows/draft/environment-variables",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload is not None
    assert payload["items"][0]["name"] == "api_key"
    assert payload["items"][0]["value"] == "secret-value"
