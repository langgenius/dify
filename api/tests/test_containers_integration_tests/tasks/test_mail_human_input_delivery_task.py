import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from sqlalchemy import delete
from sqlalchemy.orm import Session

from configs import dify_config
from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
from core.repositories.human_input_repository import FormCreateParams, HumanInputFormRepositoryImpl
from core.workflow.human_input_adapter import (
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    ExternalRecipient,
    MemberRecipient,
)
from core.workflow.nodes.human_input.entities import HumanInputNodeData
from extensions.ext_storage import storage
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import GraphRuntimeState, VariablePool
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.human_input import HumanInputDelivery, HumanInputForm, HumanInputFormRecipient
from models.model import AppMode
from models.workflow import WorkflowPause, WorkflowRun, WorkflowType
from tasks.mail_human_input_delivery_task import dispatch_human_input_email_task


@pytest.fixture(autouse=True)
def cleanup_database(container_session: Session):
    container_session.execute(delete(HumanInputFormRecipient))
    container_session.execute(delete(HumanInputDelivery))
    container_session.execute(delete(HumanInputForm))
    container_session.execute(delete(WorkflowPause))
    container_session.execute(delete(WorkflowRun))
    container_session.execute(delete(TenantAccountJoin))
    container_session.execute(delete(Tenant))
    container_session.execute(delete(Account))
    container_session.commit()


def _create_workspace_member(container_session: Session):
    account = Account(
        email="owner@example.com",
        name="Owner",
        password="password",
        interface_language="en-US",
        status=AccountStatus.ACTIVE,
    )
    account.created_at = datetime.now(UTC)
    account.updated_at = datetime.now(UTC)
    container_session.add(account)
    container_session.commit()
    container_session.refresh(account)

    tenant = Tenant(name="Test Tenant")
    tenant.created_at = datetime.now(UTC)
    tenant.updated_at = datetime.now(UTC)
    container_session.add(tenant)
    container_session.commit()
    container_session.refresh(tenant)

    tenant_join = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=account.id,
        role=TenantAccountRole.OWNER,
    )
    tenant_join.created_at = datetime.now(UTC)
    tenant_join.updated_at = datetime.now(UTC)
    container_session.add(tenant_join)
    container_session.commit()

    return tenant, account


def _build_form(container_session, tenant, account, *, app_id: str, workflow_execution_id: str):
    delivery_method = EmailDeliveryMethod(
        config=EmailDeliveryConfig(
            recipients=EmailRecipients(
                include_bound_group=False,
                items=[
                    MemberRecipient(reference_id=account.id),
                    ExternalRecipient(email="external@example.com"),
                ],
            ),
            subject="Action needed {{ node_title }} {{#node1.value#}}",
            body="Token {{ form_token }} link {{#url#}} content {{#node1.value#}}",
        )
    )

    node_data = HumanInputNodeData(
        title="Review",
        form_content="Form content",
        delivery_methods=[delivery_method],
    )

    repo = HumanInputFormRepositoryImpl(tenant_id=tenant.id, app_id=app_id)
    params = FormCreateParams(
        workflow_execution_id=workflow_execution_id,
        node_id="node-1",
        form_config=node_data,
        rendered_content="Rendered",
        delivery_methods=node_data.delivery_methods,
        display_in_ui=False,
        resolved_default_values={},
    )
    return repo.create_form(params)


def _create_workflow_pause_state(
    container_session,
    *,
    workflow_run_id: str,
    workflow_id: str,
    tenant_id: str,
    app_id: str,
    account_id: str,
    variable_pool: VariablePool,
):
    workflow_run = WorkflowRun(
        id=workflow_run_id,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_id,
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        graph="{}",
        inputs="{}",
        status=WorkflowExecutionStatus.PAUSED,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account_id,
        created_at=datetime.now(UTC),
    )
    container_session.add(workflow_run)

    runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)
    resumption_context = WorkflowResumptionContext(
        generate_entity={
            "type": AppMode.WORKFLOW,
            "entity": WorkflowAppGenerateEntity(
                task_id=str(uuid.uuid4()),
                app_config=WorkflowUIBasedAppConfig(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    app_mode=AppMode.WORKFLOW,
                    workflow_id=workflow_id,
                ),
                inputs={},
                files=[],
                user_id=account_id,
                stream=False,
                invoke_from=InvokeFrom.WEB_APP,
                workflow_execution_id=workflow_run_id,
            ),
        },
        serialized_graph_runtime_state=runtime_state.dumps(),
    )

    state_object_key = f"workflow_pause_states/{workflow_run_id}.json"
    storage.save(state_object_key, resumption_context.dumps().encode())

    pause_state = WorkflowPause(
        workflow_id=workflow_id,
        workflow_run_id=workflow_run_id,
        state_object_key=state_object_key,
    )
    container_session.add(pause_state)
    container_session.commit()


def test_dispatch_human_input_email_task_integration(monkeypatch: pytest.MonkeyPatch, container_session: Session):
    tenant, account = _create_workspace_member(container_session)
    workflow_run_id = str(uuid.uuid4())
    workflow_id = str(uuid.uuid4())
    app_id = str(uuid.uuid4())
    variable_pool = VariablePool()
    variable_pool.add(["node1", "value"], "OK")
    _create_workflow_pause_state(
        container_session,
        workflow_run_id=workflow_run_id,
        workflow_id=workflow_id,
        tenant_id=tenant.id,
        app_id=app_id,
        account_id=account.id,
        variable_pool=variable_pool,
    )
    form_entity = _build_form(
        container_session,
        tenant,
        account,
        app_id=app_id,
        workflow_execution_id=workflow_run_id,
    )

    monkeypatch.setattr(dify_config, "APP_WEB_URL", "https://app.example.com")

    with patch("tasks.mail_human_input_delivery_task.mail") as mock_mail:
        mock_mail.is_inited.return_value = True

        dispatch_human_input_email_task(form_id=form_entity.id, node_title="Approval")

        assert mock_mail.send.call_count == 2
        send_args = [call.kwargs for call in mock_mail.send.call_args_list]
        recipients = {kwargs["to"] for kwargs in send_args}
        assert recipients == {"owner@example.com", "external@example.com"}
        assert all(kwargs["subject"] == "Action needed {{ node_title }} {{#node1.value#}}" for kwargs in send_args)
        assert all("app.example.com/form/" in kwargs["html"] for kwargs in send_args)
        assert all("content OK" in kwargs["html"] for kwargs in send_args)
        assert all("{{ form_token }}" in kwargs["html"] for kwargs in send_args)
