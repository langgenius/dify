"""Accepted submissions retain the exact authenticated delivery across all surfaces."""

from collections.abc import Callable
from contextlib import nullcontext
from datetime import timedelta
from hashlib import sha256
from uuid import uuid4

import pytest
from flask.testing import FlaskClient
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access.controller import DatabaseFileAccessController
from core.app.file_access.scope import FileAccessScope, bind_file_access_scope
from core.app.workflow.file_runtime import DifyWorkflowFileRuntime
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.resolved_form import ResolvedForm
from core.human_input_v2.shared.values import RecipientId, TenantId
from core.workflow.file_reference import build_file_reference
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from graphon.file import File, FileTransferMethod, FileType
from graphon.variables.segments import ArrayFileSegment, FileSegment, StringSegment
from libs.datetime_utils import naive_utc_now
from models.human_input_v2 import HumanInputForm
from repositories.human_input_v2.delivery_repository import DeliveryCreateParams
from repositories.human_input_v2.form_repository import Form, FormCreateParams
from repositories.human_input_v2.im_channel_repository import IMChannelId
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from services.human_input_v2.email_otp_service import EmailOtpError
from services.human_input_v2.form_service import AccountInitiator
from services.human_input_v2.submission_service import (
    HumanInputFormError,
    HumanInputSubmissionService,
    IMFormActor,
    ServiceAPIFormActor,
    WebAppFormActor,
)
from tests.helpers.unit.model_factories import make_upload_file
from tests.unit_tests.services.human_input_v2.test_form_delivery_runtime import Context, PublicFormApproval

pytest_plugins = (
    "tests.unit_tests.services.human_input_v2.test_form_delivery_runtime",
    "tests.unit_tests.services.human_input_v2.test_im_webhook_runtime",
)


@pytest.mark.parametrize("transfer_method", [FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL])
@pytest.mark.parametrize(
    ("form_tenant", "form_app", "form_run", "status", "accessible"),
    [
        ("tenant", "app", "run", HumanInputFormStatus.SUBMITTED, True),
        ("other-tenant", "app", "run", HumanInputFormStatus.SUBMITTED, False),
        ("tenant", "other-app", "run", HumanInputFormStatus.SUBMITTED, False),
        ("tenant", "app", "other-run", HumanInputFormStatus.SUBMITTED, False),
        ("tenant", "app", "run", HumanInputFormStatus.WAITING, False),
        ("tenant", "app", "run", HumanInputFormStatus.TIMEOUT, False),
        ("tenant", "app", "run", HumanInputFormStatus.EXPIRED, False),
    ],
)
def test_restored_file_access_requires_an_accepted_submission_in_the_current_run(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    transfer_method: FileTransferMethod,
    form_tenant: str,
    form_app: str,
    form_run: str,
    status: HumanInputFormStatus,
    accessible: bool,
) -> None:
    uploaded = make_upload_file(tenant_id="tenant", created_by="approver")
    list_uploaded = make_upload_file(tenant_id="tenant", created_by="approver")
    unrelated = make_upload_file(tenant_id="tenant", created_by="approver")
    files = [
        File(
            file_type=FileType.DOCUMENT,
            transfer_method=transfer_method,
            reference=build_file_reference(record_id=record.id),
            remote_url="https://example.com/document.txt" if transfer_method == FileTransferMethod.REMOTE_URL else None,
            filename=record.name,
            extension=".txt",
            mime_type=record.mime_type,
            size=record.size,
        )
        for record in (uploaded, list_uploaded)
    ]
    now = naive_utc_now()
    with sqlite_session_factory.begin() as session:
        session.add_all([uploaded, list_uploaded, unrelated])
        repository = SQLAlchemyFormRepository(session, TenantId(form_tenant), form_app)
        form = repository.create_form(
            FormCreateParams(
                workflow_run_id=form_run,
                node_execution_id=str(uuid4()),
                resolved_form=ResolvedForm(title="Approval", parts=(), actions=(), legacy_form_content=""),
                expiration_time=now + timedelta(hours=1),
                global_timeout_deadline=now + timedelta(days=1),
            )
        )
        if status == HumanInputFormStatus.SUBMITTED:
            accepted = repository.submit_form(
                form.id,
                submitted_by_recipient_id=RecipientId("recipient"),
                submitted_by_delivery_id="delivery",
                selected_action_id="approve",
                raw_submission_inputs={"untrusted_file": unrelated.id},
                normalized_submission_data={
                    "single": FileSegment(value=files[0]),
                    "multiple": ArrayFileSegment(value=[files[1]]),
                    "empty": ArrayFileSegment(value=[]),
                    "text": StringSegment(value=unrelated.id),
                },
            )
            assert isinstance(accepted, Form)
        else:
            session.get_one(HumanInputForm, form.id).status = status

    runtime = DifyWorkflowFileRuntime(file_access_controller=DatabaseFileAccessController())
    monkeypatch.setattr(runtime, "_secret_key", lambda: b"test-key")
    scope = FileAccessScope(
        tenant_id="tenant", user_id="end-user", user_from=UserFrom.END_USER, invoke_from=InvokeFrom.WEB_APP
    )
    service = HumanInputSubmissionService(session_factory=sqlite_session_factory)
    with bind_file_access_scope(scope):
        service.grant_submitted_file_access(app_id="app", workflow_run_id="run")
        for record in (uploaded, list_uploaded):
            if accessible:
                assert runtime.resolve_upload_file_uri(upload_file_id=record.id).startswith(
                    f"/files/{record.id}/file-preview?"
                )
            else:
                with pytest.raises(ValueError, match="not found"):
                    runtime.resolve_upload_file_uri(upload_file_id=record.id)
        with pytest.raises(ValueError, match="not found"):
            runtime.resolve_upload_file_uri(upload_file_id=unrelated.id)

    with bind_file_access_scope(scope), pytest.raises(ValueError, match="not found"):
        runtime.resolve_upload_file_uri(upload_file_id=uploaded.id)


@pytest.mark.parametrize("account_scope", [False, True], ids=["no-scope", "account"])
def test_restoring_file_access_outside_end_user_scope_does_not_read_storage(
    unbound_session_factory: sessionmaker[Session], account_scope: bool
) -> None:
    scope = FileAccessScope(
        tenant_id="tenant", user_id="account", user_from=UserFrom.ACCOUNT, invoke_from=InvokeFrom.DEBUGGER
    )
    with bind_file_access_scope(scope) if account_scope else nullcontext():
        HumanInputSubmissionService(session_factory=unbound_session_factory).grant_submitted_file_access(
            app_id="app", workflow_run_id="run"
        )


@pytest.fixture(params=[False, True], ids=["commit", "rollback-then-retry"])
def fail_commit(request: pytest.FixtureRequest) -> bool:
    return request.param is True


@pytest.fixture
def submission_service(context: Context, monkeypatch: pytest.MonkeyPatch) -> HumanInputSubmissionService:
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    monkeypatch.setattr(resume_app_execution, "apply_async", lambda **_kwargs: None)
    return HumanInputSubmissionService(session_factory=context.sessions)


def _assert_delivery_attribution(
    context: Context,
    form_id: str,
    token: str,
    submit: Callable[[str], None],
    *,
    fail_commit: bool,
    im_retry: bool = False,
) -> None:
    with context.sessions.begin() as session:
        deliveries = SQLAlchemyDeliveryRepository(session)
        original = deliveries.get_delivery_by_token_hash(sha256(token.encode()).hexdigest())
        assert original is not None
        newer_token = f"{token}-newer"
        newer = deliveries.create_delivery(
            tenant_id=original.tenant_id,
            form_id=form_id,
            params=DeliveryCreateParams(
                recipient_id=original.recipient_id,
                token_hash=sha256(newer_token.encode()).hexdigest(),
                auth_type=original.auth_type,
                target_snapshot=original.target_snapshot,
            ),
        )
        assert newer.id != original.id

    if fail_commit:

        def reject_commit(session: Session) -> None:
            if session.get_one(HumanInputForm, form_id).status == HumanInputFormStatus.SUBMITTED:
                raise ConnectionError("Submission commit failed")

        event.listen(context.sessions, "before_commit", reject_commit)
        try:
            with pytest.raises(ConnectionError, match="Submission commit failed"):
                submit(token)
        finally:
            event.remove(context.sessions, "before_commit", reject_commit)
        with context.sessions() as session:
            stored = session.get_one(HumanInputForm, form_id)
            assert stored.status == HumanInputFormStatus.WAITING
            assert stored.submitted_by_recipient_id is None
            assert stored.submitted_by_delivery_id is None

    submit(token)
    with context.sessions() as session:
        stored = session.get_one(HumanInputForm, form_id)
        assert stored.submitted_by_delivery_id == original.id
        assert stored.submitted_by_recipient_id == original.recipient_id
        repository = SQLAlchemyFormRepository(session, original.tenant_id, stored.app_id)
        accepted = repository.get_form_by_id(form_id)
        assert accepted is not None
        assert accepted.submission is not None
        assert accepted.submission.submitted_by_delivery_id == original.id

    for duplicate_token in (token, newer_token):
        if im_retry:
            submit(duplicate_token)
        else:
            with pytest.raises((HumanInputFormError, EmailOtpError)):
                submit(duplicate_token)
        with context.sessions() as session:
            assert (
                SQLAlchemyFormRepository(session, original.tenant_id, stored.app_id).get_form_by_id(form_id) == accepted
            )


def test_console_submission_records_authenticated_delivery(
    context: Context,
    console_approval: tuple[str, str],
    submission_service: HumanInputSubmissionService,
    fail_commit: bool,
) -> None:
    form_id, token = console_approval
    initiator = context.execution.initiator
    assert isinstance(initiator, AccountInitiator)
    _assert_delivery_attribution(
        context,
        form_id,
        token,
        lambda token: submission_service.submit_console_form(
            account_id=initiator.account_id, form_token=token, action="approve", inputs={"note": "Approved"}
        ),
        fail_commit=fail_commit,
    )


@pytest.mark.parametrize("surface", ["web_app", "service_api"])
def test_end_user_submission_records_authenticated_delivery(
    context: Context,
    web_app_approval: tuple[FlaskClient, str, str, dict[str, str], str],
    submission_service: HumanInputSubmissionService,
    fail_commit: bool,
    surface: str,
) -> None:
    _, form_id, token, _, end_user_id = web_app_approval
    tenant_id, app_id = context.execution.tenant_id, context.execution.app_id

    def submit(token: str) -> None:
        if surface == "web_app":
            submission_service.submit_web_app_form(
                actor=WebAppFormActor(tenant_id, app_id, end_user_id),
                form_token=token,
                action="approve",
                inputs={"note": "Approved"},
            )
        else:
            submission_service.submit_service_api_form(
                actor=ServiceAPIFormActor(tenant_id, app_id),
                end_user_id=end_user_id,
                form_token=token,
                action="approve",
                inputs={"note": "Approved"},
            )

    _assert_delivery_attribution(context, form_id, token, submit, fail_commit=fail_commit)


def test_public_email_submission_records_authenticated_delivery(
    context: Context,
    public_form_approval: PublicFormApproval,
    submission_service: HumanInputSubmissionService,
    fail_commit: bool,
) -> None:
    from controllers.web.human_input_form_access_request import build_email_otp_service

    approval = public_form_approval
    _assert_delivery_attribution(
        context,
        approval.form_id,
        approval.token,
        lambda token: submission_service.submit_public_form(
            email_otp_service=build_email_otp_service(),
            form_token=token,
            action="approve",
            inputs={"note": "Approved"},
            challenge_token=approval.challenge.challenge_token,
            otp_code=approval.otp_code,
            ip_address=None,
        ),
        fail_commit=fail_commit,
    )


def test_im_submission_records_authenticated_delivery(
    context: Context,
    approval: tuple[str, IMChannelId],
    submission_service: HumanInputSubmissionService,
    fail_commit: bool,
) -> None:
    form_id, channel_id = approval
    _assert_delivery_attribution(
        context,
        form_id,
        "slack-approval-correlation-token",
        lambda token: submission_service.submit_im_form(
            actor=IMFormActor(channel_id, IMProvider.SLACK, "T012SANITIZED", "U012SANITIZED"),
            form_token=token,
            action="approve",
            inputs={"note": "Approved", "decision": "选项 α"},
        ),
        fail_commit=fail_commit,
        im_retry=True,
    )
