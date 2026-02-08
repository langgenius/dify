import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest

from configs import dify_config
from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
from core.repositories.human_input_repository import FormCreateParams, HumanInputFormRepositoryImpl
from core.workflow.enums import WorkflowExecutionStatus
from core.workflow.nodes.human_input.entities import (
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    ExternalRecipient,
    HumanInputNodeData,
    MemberRecipient,
)
from core.workflow.runtime import GraphRuntimeState, VariablePool
from extensions.ext_storage import storage
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.human_input import HumanInputDelivery, HumanInputForm, HumanInputFormRecipient
from models.model import AppMode
from models.workflow import WorkflowPause, WorkflowRun, WorkflowType
from tasks.mail_human_input_delivery_task import dispatch_human_input_email_task


@pytest.fixture(autouse=True)
def cleanup_database(db_session_with_containers):
    db_session_with_containers.query(HumanInputFormRecipient).delete()
    db_session_with_containers.query(HumanInputDelivery).delete()
    db_session_with_containers.query(HumanInputForm).delete()
    db_session_with_containers.query(WorkflowPause).delete()
    db_session_with_containers.query(WorkflowRun).delete()
    db_session_with_containers.query(TenantAccountJoin).delete()
    db_session_with_containers.query(Tenant).delete()
    db_session_with_containers.query(Account).delete()
    db_session_with_containers.commit()


def _create_workspace_member(db_session_with_containers):
    account = Account(
        email="owner@example.com",
        name="Owner",
        password="password",
        interface_language="en-US",
        status=AccountStatus.ACTIVE,
    )
    account.created_at = datetime.now(UTC)
    account.updated_at = datetime.now(UTC)
    db_session_with_containers.add(account)
    db_session_with_containers.commit()
    db_session_with_containers.refresh(account)

    tenant = Tenant(name="Test Tenant")
    tenant.created_at = datetime.now(UTC)
    tenant.updated_at = datetime.now(UTC)
    db_session_with_containers.add(tenant)
    db_session_with_containers.commit()
    db_session_with_containers.refresh(tenant)

    tenant_join = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=account.id,
        role=TenantAccountRole.OWNER,
    )
    tenant_join.created_at = datetime.now(UTC)
    tenant_join.updated_at = datetime.now(UTC)
    db_session_with_containers.add(tenant_join)
    db_session_with_containers.commit()

    return tenant, account


def _build_form(db_session_with_containers, tenant, account, *, app_id: str, workflow_execution_id: str):
    delivery_method = EmailDeliveryMethod(
        config=EmailDeliveryConfig(
            recipients=EmailRecipients(
                whole_workspace=False,
                items=[
                    MemberRecipient(user_id=account.id),
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

    engine = db_session_with_containers.get_bind()
    repo = HumanInputFormRepositoryImpl(session_factory=engine, tenant_id=tenant.id)
    params = FormCreateParams(
        app_id=app_id,
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
    db_session_with_containers,
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
    db_session_with_containers.add(workflow_run)

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
    db_session_with_containers.add(pause_state)
    db_session_with_containers.commit()


def test_dispatch_human_input_email_task_integration(monkeypatch: pytest.MonkeyPatch, db_session_with_containers):
    tenant, account = _create_workspace_member(db_session_with_containers)
    workflow_run_id = str(uuid.uuid4())
    workflow_id = str(uuid.uuid4())
    app_id = str(uuid.uuid4())
    variable_pool = VariablePool()
    variable_pool.add(["node1", "value"], "OK")
    _create_workflow_pause_state(
        db_session_with_containers,
        workflow_run_id=workflow_run_id,
        workflow_id=workflow_id,
        tenant_id=tenant.id,
        app_id=app_id,
        account_id=account.id,
        variable_pool=variable_pool,
    )
    form_entity = _build_form(
        db_session_with_containers,
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
