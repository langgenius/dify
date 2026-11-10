"""A Human Input v2 world on SQLite: an account initiator, its run, and approvals for the console and the web app."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import timedelta
from sqlite3 import Connection as SQLiteConnection
from uuid import uuid4

import pytest
import sqlalchemy as sa
from flask.testing import FlaskClient
from sqlalchemy import event
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import ConnectionPoolEntry

from core.human_input_v2.shared.values import AccountId, ContactId, TenantId
from core.workflow.nodes.human_input_v2.entities import (
    Contact,
    DynamicEmail,
    HumanInputNodeData,
    Initiator,
    OnetimeEmail,
)
from core.workflow.nodes.human_input_v2.runtime import PreparedForm
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import VariablePool
from libs.datetime_utils import naive_utc_now
from models import CreatorUserRole
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import EndUserType, WorkflowRunTriggeredFrom
from models.human_input_v2 import (
    ContactSubjectType,
    HumanInputContactIdentity,
)
from models.model import EndUser
from models.workflow import WorkflowPause, WorkflowRun, WorkflowType
from repositories.human_input_v2.delivery_repository import SubmissionAuthType
from services.human_input_v2.form_service import (
    AccountInitiator,
    CreatedForm,
    FormExecutionContext,
    HumanInputFormService,
)

_TENANT = TenantId("00000000-0000-0000-0000-000000000001")
_APP = "00000000-0000-0000-0000-000000000002"
_RUN = "00000000-0000-0000-0000-000000000003"
_ACCOUNT = AccountId("00000000-0000-0000-0000-000000000004")
_CONTACT = ContactId("00000000-0000-0000-0000-000000000005")
_EXECUTION = "00000000-0000-0000-0000-000000000006"


@dataclass
class Context:
    sessions: sessionmaker[Session]
    service: HumanInputFormService
    execution: FormExecutionContext

    def prepare(self, data: HumanInputNodeData, pool: VariablePool | None = None) -> CreatedForm | PreparedForm:
        return self.service.prepare_form(
            node_execution_id=_EXECUTION, node_data=data, variable_pool=pool or VariablePool()
        )

    def handle_timeouts(self) -> None:
        from services.human_input_v2.form_service import handle_form_timeouts

        handle_form_timeouts(session_factory=self.sessions, tenant_id=_TENANT, app_id=_APP, workflow_run_id=_RUN)


def _node(*recipients: Contact | DynamicEmail | Initiator | OnetimeEmail) -> HumanInputNodeData:
    return HumanInputNodeData.model_validate(
        {
            "recipients_spec": list(recipients),
            "message_template": {"subject": "Review", "body": "Open {{#url#}}"},
            "debug_mode": {"enabled": False, "channels": []},
            "title": "Frozen",
            "form_content": "Please approve",
            "user_actions": [{"id": "approve", "title": "Approve"}],
        }
    )


@pytest.fixture
def context(sqlite_engine: sa.Engine, monkeypatch: pytest.MonkeyPatch) -> Context:
    from tasks.human_input_im_card_tasks import update_human_input_im_card_task

    monkeypatch.setattr(update_human_input_im_card_task, "apply_async", lambda **_kwargs: None)
    engine = sqlite_engine

    @event.listens_for(engine, "connect")
    def setup_connection(connection: SQLiteConnection, _record: ConnectionPoolEntry) -> None:
        connection.isolation_level = None

    @event.listens_for(engine, "begin")
    def begin_transaction(connection: Connection) -> None:
        # SQLite cannot upgrade competing read transactions to writers. Reserve
        # its writer at begin so concurrent calls can wait for serialized commits.
        connection.exec_driver_sql("BEGIN IMMEDIATE")

    sessions = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr("core.db.session_factory.session_factory.get_session_maker", lambda: sessions)
    with sessions.begin() as session:
        account = Account(name="Initiator", email="member@example.com", status=AccountStatus.ACTIVE)
        account.id = _ACCOUNT
        tenant = Tenant(name="Workspace")
        tenant.id = _TENANT
        identity = HumanInputContactIdentity(subject_type=ContactSubjectType.ACCOUNT, account_id=_ACCOUNT)
        identity.id = _CONTACT
        session.add_all(
            [
                account,
                tenant,
                identity,
                TenantAccountJoin(tenant_id=_TENANT, account_id=_ACCOUNT, role=TenantAccountRole.NORMAL),
                WorkflowRun(
                    id=_RUN,
                    tenant_id=_TENANT,
                    app_id=_APP,
                    workflow_id=str(uuid4()),
                    type=WorkflowType.WORKFLOW,
                    triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                    version="1",
                    status=WorkflowExecutionStatus.RUNNING,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=_ACCOUNT,
                ),
            ]
        )
    execution = FormExecutionContext(
        tenant_id=_TENANT,
        app_id=_APP,
        workflow_run_id=_RUN,
        global_timeout_deadline=naive_utc_now() + timedelta(days=3),
        initiator=AccountInitiator(_ACCOUNT),
        debugging_account_id=None,
    )
    return Context(sessions, HumanInputFormService(session_factory=sessions, context=execution), execution)


@pytest.fixture
def console_approval(context: Context) -> tuple[str, str]:
    import hashlib

    from repositories.human_input_v2.delivery_repository import (
        DeliveryCreateParams,
        InitiatorSnapshot,
    )
    from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository

    node_data = _node(Initiator()).model_dump(mode="json")
    node_data.update(
        form_content="Review: {{#$output.note#}}",
        inputs=[{"type": "paragraph", "output_variable_name": "note"}],
    )
    node = HumanInputNodeData.model_validate(node_data)
    created = context.prepare(node)
    assert isinstance(created, CreatedForm)
    token = "console-approval-test-token"
    with context.sessions.begin() as session:
        SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=_TENANT,
            form_id=created.form.id,
            params=DeliveryCreateParams(
                recipient_id=created.recipients[0].id,
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                auth_type=SubmissionAuthType.CONSOLE,
                target_snapshot=InitiatorSnapshot(protected_form_token="encrypted-token"),
            ),
        )
        run = session.get_one(WorkflowRun, _RUN)
        assert run is not None
        run.status = WorkflowExecutionStatus.PAUSED
        session.add(
            WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=_RUN, state_object_key="approval-checkpoint")
        )
    return created.form.id, token


@pytest.fixture
def web_app_approval(
    context: Context, monkeypatch: pytest.MonkeyPatch
) -> tuple[FlaskClient, str, str, dict[str, str], str]:
    import hashlib

    from flask import Flask

    from configs import dify_config
    from controllers.web import web_ns
    from core.db.session_factory import session_factory
    from libs.external_api import ExternalApi
    from libs.passport import PassportService
    from models.model import App, AppMode, CustomizeTokenStrategy, Site
    from models.workflow import Workflow
    from repositories.human_input_v2.delivery_repository import (
        DeliveryCreateParams,
        InitiatorSnapshot,
    )
    from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
    from services.human_input_v2.form_service import EndUserInitiator
    from services.system_feature_service import SystemFeatureService

    end_user_id = str(uuid4())
    with context.sessions.begin() as session:
        session.add_all(
            [
                App(
                    id=_APP,
                    tenant_id=_TENANT,
                    name="Web approval",
                    mode=AppMode.WORKFLOW,
                    workflow_id="published-approval-workflow",
                    enable_site=True,
                    enable_api=True,
                ),
                Workflow(
                    id="published-approval-workflow",
                    tenant_id=_TENANT,
                    app_id=_APP,
                    type=WorkflowType.WORKFLOW,
                    version="published",
                    graph="{}",
                    _features="{}",
                    created_by=str(_ACCOUNT),
                ),
                Site(
                    app_id=_APP,
                    code="approval-app",
                    title="Web approval",
                    default_language="en-US",
                    customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
                ),
                EndUser(
                    id=end_user_id,
                    tenant_id=_TENANT,
                    app_id=_APP,
                    type=EndUserType.BROWSER,
                    session_id="original-session",
                ),
            ]
        )
    forms = HumanInputFormService(
        session_factory=context.sessions, context=replace(context.execution, initiator=EndUserInitiator(end_user_id))
    )
    node_data = _node(Initiator()).model_dump(mode="json")
    node_data.update(
        form_content="Review: {{#$output.note#}}",
        inputs=[{"type": "paragraph", "output_variable_name": "note"}],
    )
    created = forms.prepare_form(
        node_execution_id=_EXECUTION,
        node_data=HumanInputNodeData.model_validate(node_data),
        variable_pool=VariablePool(),
    )
    assert isinstance(created, CreatedForm)
    token = "web-app-approval-test-token"
    with context.sessions.begin() as session:
        SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=_TENANT,
            form_id=created.form.id,
            params=DeliveryCreateParams(
                recipient_id=created.recipients[0].id,
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                auth_type=SubmissionAuthType.WEB_APP,
                target_snapshot=InitiatorSnapshot(protected_form_token="encrypted-token"),
            ),
        )
        run = session.get_one(WorkflowRun, _RUN)
        assert run is not None
        run.status = WorkflowExecutionStatus.PAUSED
        session.add(WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=_RUN, state_object_key="web-checkpoint"))
    monkeypatch.setattr(session_factory, "create_session", context.sessions)
    monkeypatch.setattr(SystemFeatureService, "is_webapp_auth_enabled", staticmethod(lambda: False))
    monkeypatch.setattr(dify_config, "SECRET_KEY", "web-approval-test-signing-key-at-least-32-bytes")
    app = Flask(__name__)
    ExternalApi(app).add_namespace(web_ns)
    passport = PassportService().issue({"app_id": _APP, "app_code": "approval-app", "end_user_id": end_user_id})
    headers = {"X-App-Code": "approval-app", "X-App-Passport": passport}
    return app.test_client(), created.form.id, token, headers, end_user_id
