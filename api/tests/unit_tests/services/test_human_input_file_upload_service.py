from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from core.workflow.human_input import HumanInputFormKind, HumanInputFormStatus
import models.account as account_module
import services.human_input_file_upload_service as service_module
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.account import Account, Tenant, TenantAccountJoin
from models.base import Base
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.human_input import (
    HumanInputForm,
    HumanInputFormRecipient,
    HumanInputFormUploadFile,
    HumanInputFormUploadToken,
)
from models.model import App, AppMode, EndUser
from models.workflow import WorkflowRun, WorkflowType
from services.human_input_file_upload_service import HITL_UPLOAD_TOKEN_PREFIX, HumanInputFileUploadService
from services.human_input_service import FormSubmittedError


@pytest.fixture
def session_maker(monkeypatch: pytest.MonkeyPatch):
    engine = create_engine("sqlite:///:memory:")
    monkeypatch.setattr(account_module, "db", SimpleNamespace(engine=engine))
    Base.metadata.create_all(
        engine,
        tables=[
            Tenant.__table__,
            Account.__table__,
            TenantAccountJoin.__table__,
            App.__table__,
            EndUser.__table__,
            WorkflowRun.__table__,
            HumanInputForm.__table__,
            HumanInputFormRecipient.__table__,
            HumanInputFormUploadToken.__table__,
            HumanInputFormUploadFile.__table__,
        ],
    )
    try:
        yield sessionmaker(bind=engine, expire_on_commit=False)
    finally:
        Base.metadata.drop_all(
            engine,
            tables=[
                HumanInputFormUploadFile.__table__,
                HumanInputFormUploadToken.__table__,
                HumanInputFormRecipient.__table__,
                HumanInputForm.__table__,
                WorkflowRun.__table__,
                EndUser.__table__,
                App.__table__,
                TenantAccountJoin.__table__,
                Account.__table__,
                Tenant.__table__,
            ],
        )
        engine.dispose()


def _create_waiting_form(
    session_maker,
    *,
    created_by_role: CreatorUserRole = CreatorUserRole.ACCOUNT,
    form_kind: HumanInputFormKind = HumanInputFormKind.RUNTIME,
) -> tuple[str, str, str]:
    form_id = "00000000-0000-0000-0000-000000000001"
    recipient_id = "00000000-0000-0000-0000-000000000002"
    workflow_run_id = None
    if form_kind == HumanInputFormKind.RUNTIME:
        workflow_run_id = "00000000-0000-0000-0000-000000000012"
    tenant_id = "00000000-0000-0000-0000-000000000010"
    app_id = "00000000-0000-0000-0000-000000000011"
    now = naive_utc_now()
    created_by = (
        "00000000-0000-0000-0000-000000000020"
        if created_by_role == CreatorUserRole.ACCOUNT
        else "00000000-0000-0000-0000-000000000021"
    )
    with session_maker.begin() as session:
        tenant = Tenant(name="tenant-1")
        tenant.id = tenant_id
        session.add(tenant)
        if created_by_role == CreatorUserRole.ACCOUNT:
            account = Account(name="owner", email="owner@example.com")
            account.id = created_by
            session.add(account)
            session.add(
                TenantAccountJoin(
                    tenant_id=tenant_id,
                    account_id=created_by,
                    current=True,
                )
            )
            app_creator = created_by
        else:
            end_user = EndUser(
                tenant_id=tenant_id,
                app_id=app_id,
                type=EndUserType.BROWSER,
                is_anonymous=False,
                session_id="session-1",
                external_user_id="external-1",
            )
            end_user.id = created_by
            session.add(end_user)
            app_creator = "00000000-0000-0000-0000-000000000020"
            account = Account(name="owner", email="owner@example.com")
            account.id = app_creator
            session.add(account)
            session.add(
                TenantAccountJoin(
                    tenant_id=tenant_id,
                    account_id=app_creator,
                    current=True,
                )
            )
        app = App(
            tenant_id=tenant_id,
            name="app-1",
            description="",
            mode=AppMode.WORKFLOW,
            icon_type="emoji",
            icon="app",
            icon_background="#ffffff",
            enable_site=True,
            enable_api=True,
            created_by=app_creator,
            updated_by=app_creator,
        )
        app.id = app_id
        session.add(app)
        if workflow_run_id is not None:
            workflow_run = WorkflowRun(
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id="00000000-0000-0000-0000-000000000013",
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="1",
                graph="{}",
                inputs="{}",
                status=WorkflowExecutionStatus.RUNNING,
                created_by_role=created_by_role,
                created_by=created_by,
                created_at=now,
            )
            workflow_run.id = workflow_run_id
            session.add(workflow_run)
        session.add(
            HumanInputForm(
                id=form_id,
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_run_id=workflow_run_id,
                form_kind=form_kind,
                node_id="node-1",
                form_definition="{}",
                rendered_content="content",
                expiration_time=now + timedelta(hours=1),
                created_at=now,
            )
        )
        session.add(
            HumanInputFormRecipient(
                id=recipient_id,
                form_id=form_id,
                delivery_id="00000000-0000-0000-0000-000000000003",
                recipient_type="standalone_web_app",
                recipient_payload='{"TYPE": "standalone_web_app"}',
                access_token="form-token-1",
            )
        )
    return form_id, recipient_id, created_by


def _create_service(
    session_maker,
    workflow_run_repository: MagicMock | None = None,
) -> HumanInputFileUploadService:
    return HumanInputFileUploadService(
        session_maker,
        workflow_run_repository=workflow_run_repository or MagicMock(),
    )


def test_issue_upload_token_persists_token_without_technical_end_user(
    monkeypatch: pytest.MonkeyPatch,
    session_maker,
) -> None:
    form_id, recipient_id, _created_by = _create_waiting_form(session_maker)
    monkeypatch.setattr(service_module.secrets, "token_urlsafe", lambda _bytes: "random-value")

    token = _create_service(session_maker).issue_upload_token("form-token-1")

    assert token.upload_token == f"{HITL_UPLOAD_TOKEN_PREFIX}random-value"
    with session_maker() as session:
        token_model = session.scalar(select(HumanInputFormUploadToken))
        assert token_model is not None
        assert token_model.form_id == form_id
        assert token_model.recipient_id == recipient_id
        assert token_model.token == token.upload_token
        assert session.scalar(select(EndUser).limit(1)) is None


def test_validate_upload_token_returns_account_owner_and_record_file_link(session_maker) -> None:
    form_id, recipient_id, created_by = _create_waiting_form(session_maker, created_by_role=CreatorUserRole.ACCOUNT)
    token = _create_service(session_maker).issue_upload_token("form-token-1")
    workflow_run_repository = MagicMock()
    workflow_run_repository.get_workflow_run_by_id.return_value = SimpleNamespace(
        tenant_id="00000000-0000-0000-0000-000000000010",
        app_id="00000000-0000-0000-0000-000000000011",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=created_by,
    )

    context = HumanInputFileUploadService(
        session_maker,
        workflow_run_repository=workflow_run_repository,
    ).validate_upload_token(token.upload_token)
    assert context.form_id == form_id
    assert context.recipient_id == recipient_id
    assert isinstance(context.owner, Account)
    assert context.owner.id == created_by
    assert context.owner.current_tenant_id == "00000000-0000-0000-0000-000000000010"
    workflow_run_repository.get_workflow_run_by_id.assert_called_once_with(
        tenant_id="00000000-0000-0000-0000-000000000010",
        app_id="00000000-0000-0000-0000-000000000011",
        run_id="00000000-0000-0000-0000-000000000012",
    )

    _create_service(session_maker).record_upload_file(
        context=context,
        file_id="00000000-0000-0000-0000-000000000099",
    )

    with session_maker() as session:
        link = session.scalar(select(HumanInputFormUploadFile))
        assert link is not None
        assert link.tenant_id == context.tenant_id
        assert link.app_id == context.app_id
        assert link.form_id == form_id
        assert link.upload_token_id == context.upload_token_id


def test_validate_upload_token_returns_end_user_owner(session_maker) -> None:
    form_id, recipient_id, created_by = _create_waiting_form(session_maker, created_by_role=CreatorUserRole.END_USER)
    token = _create_service(session_maker).issue_upload_token("form-token-1")
    workflow_run_repository = MagicMock()
    workflow_run_repository.get_workflow_run_by_id.return_value = SimpleNamespace(
        tenant_id="00000000-0000-0000-0000-000000000010",
        app_id="00000000-0000-0000-0000-000000000011",
        created_by_role=CreatorUserRole.END_USER,
        created_by=created_by,
    )

    context = HumanInputFileUploadService(
        session_maker,
        workflow_run_repository=workflow_run_repository,
    ).validate_upload_token(token.upload_token)

    assert context.form_id == form_id
    assert context.recipient_id == recipient_id
    assert isinstance(context.owner, EndUser)
    assert context.owner.id == created_by


def test_validate_upload_token_allows_delivery_test_form(session_maker) -> None:
    form_id, recipient_id, _created_by = _create_waiting_form(
        session_maker,
        form_kind=HumanInputFormKind.DELIVERY_TEST,
    )
    token = _create_service(session_maker).issue_upload_token("form-token-1")

    context = _create_service(session_maker).validate_upload_token(token.upload_token)

    assert context.form_id == form_id
    assert context.recipient_id == recipient_id
    assert isinstance(context.owner, Account)
    assert context.owner.id == "00000000-0000-0000-0000-000000000020"
    assert context.owner.current_tenant_id == "00000000-0000-0000-0000-000000000010"


def test_validate_upload_token_rejects_submitted_form(session_maker) -> None:
    form_id, _recipient_id, _created_by = _create_waiting_form(session_maker)
    token = _create_service(session_maker).issue_upload_token("form-token-1")
    with session_maker.begin() as session:
        form = session.get(HumanInputForm, form_id)
        assert form is not None
        form.status = HumanInputFormStatus.SUBMITTED
        form.submitted_at = naive_utc_now()

    with pytest.raises(FormSubmittedError):
        _create_service(session_maker).validate_upload_token(token.upload_token)
