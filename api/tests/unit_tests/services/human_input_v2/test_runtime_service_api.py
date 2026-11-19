"""Runtime initialization preserves the caller's identity across invocation surfaces."""

import hashlib
from collections.abc import Callable
from uuid import uuid4

import pytest
import sqlalchemy as sa
from cryptography.fernet import Fernet
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.helper import encrypter
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input_v2.entities import HumanInputNodeData
from core.workflow.system_variables import SystemVariableKey, system_variable_selector
from enums import DeploymentEdition
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import VariablePool
from models.account import TenantAccountJoin, TenantAccountRole
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.human_input_v2 import (
    ContactSubjectType,
    HumanInputContactIdentity,
    HumanInputDelivery,
    HumanInputRecipient,
    RecipientSubjectType,
)
from models.model import AppMode, EndUser
from models.workflow import WorkflowRun, WorkflowType
from repositories.human_input_v2.delivery_repository import SubmissionAuthType
from services.human_input_v2.composition import WorkflowHumanInputRuntime
from tests.helpers.unit.model_factories import make_account, make_app, make_tenant


@pytest.mark.parametrize(
    ("invoke_from", "user_from", "subject_type", "auth_type"),
    [
        (InvokeFrom.WEB_APP, UserFrom.END_USER, RecipientSubjectType.END_USER, SubmissionAuthType.WEB_APP),
        (InvokeFrom.SERVICE_API, UserFrom.END_USER, RecipientSubjectType.END_USER, SubmissionAuthType.WEB_APP),
        (InvokeFrom.OPENAPI, UserFrom.END_USER, RecipientSubjectType.END_USER, SubmissionAuthType.WEB_APP),
        (InvokeFrom.OPENAPI, UserFrom.ACCOUNT, RecipientSubjectType.CONTACT, SubmissionAuthType.CONSOLE),
    ],
)
def test_initiator_creates_a_reusable_approval_token(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    invoke_from: InvokeFrom,
    user_from: UserFrom,
    subject_type: RecipientSubjectType,
    auth_type: SubmissionAuthType,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    tenant = make_tenant(tenant_id=str(uuid4()))
    application = make_app(app_id=str(uuid4()), tenant_id=tenant.id, mode=AppMode.WORKFLOW)
    user_id = str(uuid4())
    recipient_subject = user_id
    with sqlite_session_factory.begin() as session:
        session.add_all([tenant, application])
        if user_from is UserFrom.ACCOUNT:
            account = make_account(account_id=user_id)
            contact = HumanInputContactIdentity(subject_type=ContactSubjectType.ACCOUNT, account_id=user_id)
            recipient_subject = contact.id
            session.add_all(
                [
                    account,
                    contact,
                    TenantAccountJoin(tenant_id=tenant.id, account_id=user_id, role=TenantAccountRole.NORMAL),
                ]
            )
        else:
            session.add(
                EndUser(
                    id=user_id,
                    tenant_id=tenant.id,
                    app_id=application.id,
                    type={
                        InvokeFrom.SERVICE_API: EndUserType.SERVICE_API,
                        InvokeFrom.OPENAPI: EndUserType.OPENAPI,
                        InvokeFrom.WEB_APP: EndUserType.BROWSER,
                    }[invoke_from],
                    session_id="runtime-initiator",
                )
            )
    run = WorkflowRun(
        id=str(uuid4()),
        tenant_id=tenant.id,
        app_id=application.id,
        workflow_id=str(uuid4()),
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        status=WorkflowExecutionStatus.RUNNING,
        created_by_role=CreatorUserRole.ACCOUNT if user_from is UserFrom.ACCOUNT else CreatorUserRole.END_USER,
        created_by=user_id,
    )
    with sqlite_session_factory.begin() as session:
        session.add(run)
    cipher = Fernet(Fernet.generate_key())
    monkeypatch.setattr(encrypter, "encrypt_token", lambda _tenant, token: cipher.encrypt(token.encode()).decode())
    monkeypatch.setattr(encrypter, "decrypt_token", lambda _tenant, token: cipher.decrypt(token.encode()).decode())
    runtime = WorkflowHumanInputRuntime(
        DifyRunContext(
            tenant_id=tenant.id,
            app_id=application.id,
            user_id=user_id,
            user_from=user_from,
            invoke_from=invoke_from,
        )
    )
    node = HumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "form_content": "Review {{#$output.note#}}",
            "inputs": [{"type": "paragraph", "output_variable_name": "note"}],
            "user_actions": [{"id": "approve", "title": "Approve"}],
            "recipients_spec": [{"type": "initiator"}],
            "message_template": {"subject": "Review", "body": "Open {{#url#}}"},
            "debug_mode": {"enabled": False, "channels": []},
        }
    )
    pool = VariablePool()
    pool.add(system_variable_selector(SystemVariableKey.WORKFLOW_EXECUTION_ID), run.id)
    execution_id = str(uuid4())
    prepared = runtime.prepare_form(node_execution_id=execution_id, node_data=node, variable_pool=pool)
    assert prepared.form.status == HumanInputFormStatus.WAITING
    assert prepared.form_token is not None
    with sqlite_session_factory() as session:
        recipient = session.scalars(sa.select(HumanInputRecipient)).one()
        assert recipient.subject_type == subject_type
        assert recipient.subject_value == recipient_subject
        delivery = session.scalars(sa.select(HumanInputDelivery)).one()
        assert delivery.recipient_id == recipient.id
        assert delivery.auth_type == auth_type
        assert delivery.token_hash == hashlib.sha256(prepared.form_token.get_secret_value().encode()).hexdigest()
    revisited = runtime.prepare_form(node_execution_id=execution_id, node_data=node, variable_pool=pool)
    assert revisited.form.id == prepared.form.id
    assert revisited.form_token == prepared.form_token
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputRecipient)) == 1
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDelivery)) == 1
