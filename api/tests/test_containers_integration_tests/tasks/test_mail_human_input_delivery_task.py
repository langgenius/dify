from datetime import UTC, datetime
import uuid
from unittest.mock import patch

import pytest

from configs import dify_config
from core.repositories.human_input_reposotiry import FormCreateParams, HumanInputFormRepositoryImpl
from core.workflow.nodes.human_input.entities import (
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    ExternalRecipient,
    HumanInputNodeData,
    MemberRecipient,
)
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.human_input import HumanInputDelivery, HumanInputForm, HumanInputFormRecipient
from tasks.mail_human_input_delivery_task import dispatch_human_input_email_task


@pytest.fixture(autouse=True)
def cleanup_database(db_session_with_containers):
    db_session_with_containers.query(HumanInputFormRecipient).delete()
    db_session_with_containers.query(HumanInputDelivery).delete()
    db_session_with_containers.query(HumanInputForm).delete()
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


def _build_form(db_session_with_containers, tenant, account):
    delivery_method = EmailDeliveryMethod(
        config=EmailDeliveryConfig(
            recipients=EmailRecipients(
                whole_workspace=False,
                items=[
                    MemberRecipient(user_id=account.id),
                    ExternalRecipient(email="external@example.com"),
                ],
            ),
            subject="Action needed {{ node_title }}",
            body="Token {{ form_token }} link {{ form_link }} content {{ form_content }}",
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
        workflow_execution_id=str(uuid.uuid4()),
        node_id="node-1",
        form_config=node_data,
        rendered_content="Rendered",
        resolved_placeholder_values={},
    )
    return repo.create_form(params)


def test_dispatch_human_input_email_task_integration(monkeypatch: pytest.MonkeyPatch, db_session_with_containers):
    tenant, account = _create_workspace_member(db_session_with_containers)
    form_entity = _build_form(db_session_with_containers, tenant, account)

    monkeypatch.setattr(dify_config, "CONSOLE_WEB_URL", "https://console.example.com")

    with patch("tasks.mail_human_input_delivery_task.mail") as mock_mail:
        mock_mail.is_inited.return_value = True

        dispatch_human_input_email_task(form_id=form_entity.id, node_title="Approval")

        assert mock_mail.send.call_count == 2
        send_args = [call.kwargs for call in mock_mail.send.call_args_list]
        recipients = {kwargs["to"] for kwargs in send_args}
        assert recipients == {"owner@example.com", "external@example.com"}
        assert all("console.example.com/api/form/human_input/" in kwargs["html"] for kwargs in send_args)
