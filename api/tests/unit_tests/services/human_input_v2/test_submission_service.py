"""Accepted submissions retain the exact authenticated delivery across all surfaces."""

from collections.abc import Callable
from hashlib import sha256

import pytest
from flask.testing import FlaskClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from core.human_input_v2.entities import IMProvider
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from models.human_input_v2 import HumanInputForm
from repositories.human_input_v2.delivery_repository import DeliveryCreateParams
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
from tests.unit_tests.services.human_input_v2.test_form_delivery_runtime import Context, PublicFormApproval

pytest_plugins = (
    "tests.unit_tests.services.human_input_v2.test_form_delivery_runtime",
    "tests.unit_tests.services.human_input_v2.test_im_webhook_runtime",
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
