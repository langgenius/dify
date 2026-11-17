"""Fixtures scoped to Human Input service tests."""

from collections.abc import Iterator
from datetime import timedelta
from sqlite3 import Connection as SQLiteConnection
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.engine import Connection
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import ConnectionPoolEntry

from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from models import CreatorUserRole
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import WorkflowRunTriggeredFrom
from models.human_input_v2 import ContactSubjectType, HumanInputContactIdentity
from models.workflow import WorkflowRun, WorkflowType
from services.human_input_v2.form_service import AccountInitiator, FormExecutionContext, HumanInputFormService
from tests.helpers.unit.core.human_input_v2.slack import SlackApiServer, run_slack_api_server
from tests.helpers.unit.services.human_input_v2.form_runtime import (
    ACCOUNT_ID,
    APP_ID,
    CONTACT_ID,
    TENANT_ID,
    WORKFLOW_RUN_ID,
    FormRuntimeContext,
)


@pytest.fixture
def context(sqlite_engine: sa.Engine, monkeypatch: pytest.MonkeyPatch) -> FormRuntimeContext:
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
        account.id = ACCOUNT_ID
        tenant = Tenant(name="Workspace")
        tenant.id = TENANT_ID
        identity = HumanInputContactIdentity(subject_type=ContactSubjectType.ACCOUNT, account_id=ACCOUNT_ID)
        identity.id = CONTACT_ID
        session.add_all(
            [
                account,
                tenant,
                identity,
                TenantAccountJoin(tenant_id=TENANT_ID, account_id=ACCOUNT_ID, role=TenantAccountRole.NORMAL),
                WorkflowRun(
                    id=WORKFLOW_RUN_ID,
                    tenant_id=TENANT_ID,
                    app_id=APP_ID,
                    workflow_id=str(uuid4()),
                    type=WorkflowType.WORKFLOW,
                    triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                    version="1",
                    status=WorkflowExecutionStatus.RUNNING,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=ACCOUNT_ID,
                ),
            ]
        )
    execution = FormExecutionContext(
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        workflow_run_id=WORKFLOW_RUN_ID,
        global_timeout_deadline=naive_utc_now() + timedelta(days=3),
        initiator=AccountInitiator(ACCOUNT_ID),
        debugging_account_id=None,
    )
    return FormRuntimeContext(sessions, HumanInputFormService(session_factory=sessions, context=execution), execution)


@pytest.fixture
def slack_api_server() -> Iterator[SlackApiServer]:
    """Run an isolated local Slack HTTP server for the requesting test."""
    with run_slack_api_server() as server:
        yield server
