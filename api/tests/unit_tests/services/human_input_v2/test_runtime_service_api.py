"""Real runtime initialization must retain the Service API run's EndUser grant."""

import hashlib
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
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from graphon.runtime import VariablePool
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.human_input_v2 import HumanInputDelivery, HumanInputRecipient, RecipientSubjectType
from models.model import AppMode, EndUser
from models.workflow import WorkflowRun
from repositories.human_input_v2.delivery_repository import SubmissionAuthType
from services.human_input_v2.composition import WorkflowHumanInputRuntime
from tests.unit_tests.model_factories import make_app, make_tenant


@pytest.mark.parametrize("invoke_from", [InvokeFrom.WEB_APP, InvokeFrom.SERVICE_API])
def test_end_user_initiator_creates_a_reusable_approval_token(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    invoke_from: InvokeFrom,
) -> None:
    tenant = make_tenant(tenant_id=str(uuid4()))
    application = make_app(app_id=str(uuid4()), tenant_id=tenant.id, mode=AppMode.WORKFLOW)
    end_user = EndUser(
        id=str(uuid4()),
        tenant_id=tenant.id,
        app_id=application.id,
        type=EndUserType.SERVICE_API if invoke_from == InvokeFrom.SERVICE_API else EndUserType.BROWSER,
        session_id="runtime-initiator",
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
        created_by_role=CreatorUserRole.END_USER,
        created_by=end_user.id,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([tenant, application, end_user, run])
    cipher = Fernet(Fernet.generate_key())
    monkeypatch.setattr(encrypter, "encrypt_token", lambda _tenant, token: cipher.encrypt(token.encode()).decode())
    monkeypatch.setattr(encrypter, "decrypt_token", lambda _tenant, token: cipher.decrypt(token.encode()).decode())
    runtime = WorkflowHumanInputRuntime(
        DifyRunContext(
            tenant_id=tenant.id,
            app_id=application.id,
            user_id=end_user.id,
            user_from=UserFrom.END_USER,
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
        assert recipient.subject_type == RecipientSubjectType.END_USER
        assert recipient.subject_value == end_user.id
        delivery = session.scalars(sa.select(HumanInputDelivery)).one()
        assert delivery.recipient_id == recipient.id
        assert delivery.auth_type == SubmissionAuthType.WEB_APP
        assert delivery.token_hash == hashlib.sha256(prepared.form_token.get_secret_value().encode()).hexdigest()
    revisited = runtime.prepare_form(node_execution_id=execution_id, node_data=node, variable_pool=pool)
    assert revisited.form.id == prepared.form.id
    assert revisited.form_token == prepared.form_token
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputRecipient)) == 1
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputDelivery)) == 1
