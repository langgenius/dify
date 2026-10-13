"""V2 upload admission, tenant/creator isolation, and persisted file restoration."""

import hashlib
import io
from dataclasses import dataclass
from datetime import timedelta
from unittest.mock import Mock
from uuid import uuid4

import httpx
import jwt
import pytest
import sqlalchemy as sa
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from controllers.web import human_input_form_access_request as token_controller
from controllers.web import human_input_v2_file_upload as controller
from core.human_input import ButtonStyle
from core.human_input_v2.resolved_form import FileInput, ResolvedForm, UserAction
from core.human_input_v2.shared.values import AccountId, NormalizedEmail, TenantId
from core.workflow.nodes.human_input_v2.entities import OnetimeEmail
from extensions.ext_storage import storage
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from graphon.file.enums import FileTransferMethod, FileType
from graphon.variables.segments import FileSegment
from libs.datetime_utils import naive_utc_now
from libs.external_api import ExternalApi
from models.account import TenantAccountJoin, TenantAccountRole
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.human_input_v2 import HumanInputDelivery, HumanInputForm
from models.model import UploadFile
from models.workflow import WorkflowPause, WorkflowRun
from repositories.human_input_v2.delivery_repository import (
    DeliveryCreateParams,
    EmailTargetSnapshot,
    SubmissionAuthType,
)
from repositories.human_input_v2.form_repository import FormCreateParams
from repositories.human_input_v2.recipient_repository import (
    EmailRecipientSubject,
    RecipientCreateParams,
)
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from repositories.human_input_v2.sqlalchemy_recipient_repository import SQLAlchemyRecipientRepository
from services.file_service import FileService
from services.human_input_file_upload_service import InvalidUploadTokenError
from services.human_input_v2.file_upload_service import V2_UPLOAD_TOKEN_PREFIX, HumanInputV2FileUploadService
from services.human_input_v2.submission_service import (
    HumanInputFormError,
    HumanInputFormErrorCode,
    HumanInputSubmissionService,
)
from services.remote_file_service import RemoteFileService
from tests.unit_tests.model_factories import make_account, make_app, make_end_user, make_tenant


@dataclass
class Approval:
    sessions: sessionmaker[Session]
    service: HumanInputV2FileUploadService
    tenant_id: TenantId
    app_id: str
    account_id: AccountId
    end_user_id: str
    form_id: str
    delivery_id: str
    token: str
    owner_role: CreatorUserRole

    def issue(self):
        return self.service.issue_public_upload_token(self.token)


@pytest.fixture(params=[CreatorUserRole.ACCOUNT, CreatorUserRole.END_USER])
def approval(sqlite_session_factory, monkeypatch, request) -> Approval:
    monkeypatch.setattr(dify_config, "SECRET_KEY", "v2-upload-test-key-long-enough-for-hs256")
    monkeypatch.setattr(storage, "save", lambda *_args: None)
    tenant_id, app_id, account_id, end_user_id, run_id = [str(uuid4()) for _ in range(5)]
    owner_role = request.param
    now = naive_utc_now()
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                make_tenant(tenant_id=tenant_id, name="Uploads"),
                make_account(account_id=account_id, name="Initiator", email="initiator@example.com"),
                TenantAccountJoin(tenant_id=tenant_id, account_id=account_id, role=TenantAccountRole.NORMAL),
                make_app(app_id=app_id, tenant_id=tenant_id, name="Approval", created_by=account_id),
                make_end_user(end_user_id=end_user_id, tenant_id=tenant_id, app_id=app_id, session_id="original"),
                WorkflowRun(
                    id=run_id,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    workflow_id=str(uuid4()),
                    type=WorkflowType.WORKFLOW,
                    triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                    version="1",
                    status=WorkflowExecutionStatus.PAUSED,
                    created_by_role=owner_role,
                    created_by=end_user_id if owner_role == CreatorUserRole.END_USER else account_id,
                ),
            ]
        )
        session.flush()
        form = SQLAlchemyFormRepository(session, TenantId(tenant_id), app_id).create_form(
            FormCreateParams(
                workflow_run_id=run_id,
                node_execution_id=str(uuid4()),
                expiration_time=now + timedelta(minutes=10),
                global_timeout_deadline=now + timedelta(minutes=5),
                resolved_form=ResolvedForm(
                    title="Upload",
                    legacy_form_content="{{#$output.file#}}",
                    parts=(
                        FileInput(
                            output_variable_name="file",
                            allowed_file_types=(FileType.DOCUMENT,),
                            allowed_file_extensions=(".txt",),
                            allowed_file_upload_methods=(FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL),
                        ),
                    ),
                    actions=(UserAction(id="approve", title="Approve", button_style=ButtonStyle.DEFAULT),),
                ),
            )
        )
        subject = EmailRecipientSubject(NormalizedEmail("approver@example.com"))
        auth_type = SubmissionAuthType.EMAIL_OTP
        target = EmailTargetSnapshot(email_address="approver@example.com")
        recipient = SQLAlchemyRecipientRepository(session, TenantId(tenant_id), form.id).create_recipients(
            [
                RecipientCreateParams(
                    subject=subject,
                    sources=(OnetimeEmail(email="approver@example.com"),),
                    name="Approver",
                )
            ]
        )[0]
        token = "v2-delivery-" + str(uuid4())
        delivery = SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=TenantId(tenant_id),
            form_id=form.id,
            params=DeliveryCreateParams(
                recipient_id=recipient.id,
                auth_type=auth_type,
                target_snapshot=target,
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
            ),
        )
    files = FileService(sqlite_session_factory)
    service = HumanInputV2FileUploadService(
        session_factory=sqlite_session_factory, files=files, remote_files=RemoteFileService(files=files)
    )
    monkeypatch.setattr(controller, "build_file_upload_service", lambda: service)
    monkeypatch.setattr(token_controller, "build_file_upload_service", lambda: service)
    return Approval(
        sqlite_session_factory,
        service,
        TenantId(tenant_id),
        app_id,
        AccountId(account_id),
        end_user_id,
        form.id,
        delivery.id,
        token,
        owner_role,
    )


def test_uploads_local_and_remote_files_as_the_original_initiator(approval: Approval, monkeypatch):
    grant = approval.issue()
    with approval.sessions() as session:
        form = session.get(HumanInputForm, approval.form_id)
        assert grant.expires_at == form.global_timeout_deadline
    app = Flask(__name__)
    ExternalApi(app).add_namespace(controller.web_ns)
    client = app.test_client()
    headers = {"Authorization": "Bearer " + grant.upload_token}
    local = client.post("/human-input/v2/files", headers=headers, data={"file": (io.BytesIO(b"review"), "review.txt")})
    assert local.status_code == 201, local.json
    assert local.json["name"] == "review.txt"
    assert local.json["url"]

    def fetch(method, url, **_kwargs):
        return httpx.Response(
            200,
            headers={"Content-Type": "text/plain", "Content-Length": "6"},
            content=b"review" if method == "GET" else b"",
            request=httpx.Request(method, url),
        )

    monkeypatch.setattr("core.file.remote_fetcher.make_request", fetch)
    remote = client.post(
        "/human-input/v2/files/remote", headers=headers, json={"url": "https://example.com/remote.txt"}
    )
    assert remote.status_code == 201, remote.json
    with approval.sessions() as session:
        files = list(session.scalars(sa.select(UploadFile)))
        assert {file.id for file in files} == {local.json["id"], remote.json["id"]}
        for file in files:
            assert file.tenant_id == approval.tenant_id
            assert file.created_by == (
                approval.end_user_id if approval.owner_role == CreatorUserRole.END_USER else approval.account_id
            )
            assert file.created_by_role == (
                CreatorUserRole.END_USER if approval.owner_role == CreatorUserRole.END_USER else CreatorUserRole.ACCOUNT
            )


@pytest.mark.parametrize("change", ["submitted", "node_deadline", "global_deadline", "recipient_revoked"])
def test_rechecks_form_and_delivery_before_using_a_grant(approval: Approval, change):
    grant = approval.issue()
    with approval.sessions.begin() as session:
        form = session.get(HumanInputForm, approval.form_id)
        if change == "submitted":
            delivery = session.get(HumanInputDelivery, approval.delivery_id)
            SQLAlchemyFormRepository(session, approval.tenant_id, approval.app_id).submit_form(
                form.id,
                submitted_by_recipient_id=delivery.recipient_id,
                selected_action_id="approve",
                raw_submission_inputs={},
                normalized_submission_data={},
            )
        elif change == "node_deadline":
            form.expiration_time = naive_utc_now() - timedelta(seconds=1)
        elif change == "global_deadline":
            form.global_timeout_deadline = naive_utc_now() - timedelta(seconds=1)
        else:
            delivery = session.get(HumanInputDelivery, approval.delivery_id)
            session.delete(delivery)
    with pytest.raises(HumanInputFormError) as caught:
        approval.service.validate_upload_token(grant.upload_token)
    assert (
        caught.value.code
        == {
            "submitted": HumanInputFormErrorCode.ALREADY_SUBMITTED,
            "node_deadline": HumanInputFormErrorCode.EXPIRED,
            "global_deadline": HumanInputFormErrorCode.EXPIRED,
            "recipient_revoked": HumanInputFormErrorCode.NOT_FOUND,
        }[change]
    )


def test_rejects_tampered_expired_or_legacy_grants(approval: Approval):
    grant = approval.issue()
    claims = jwt.decode(grant.upload_token.removeprefix(V2_UPLOAD_TOKEN_PREFIX), options={"verify_signature": False})
    claims["exp"] = 1
    expired = V2_UPLOAD_TOKEN_PREFIX + jwt.encode(claims, dify_config.SECRET_KEY, algorithm="HS256")
    claims["exp"] = 1900000000
    forged = V2_UPLOAD_TOKEN_PREFIX + jwt.encode(claims, "a-different-signing-key-with-32-bytes", algorithm="HS256")
    for token in [expired, forged, "hitl_upload_legacy", "hitl_v2_upload_malformed"]:
        with pytest.raises(InvalidUploadTokenError):
            approval.service.validate_upload_token(token)


@pytest.mark.parametrize("auth_type", [SubmissionAuthType.CONSOLE, SubmissionAuthType.WEB_APP, SubmissionAuthType.IM])
def test_public_upload_rejects_other_delivery_authentication(approval: Approval, auth_type):
    with approval.sessions.begin() as session:
        delivery = session.get(HumanInputDelivery, approval.delivery_id)
        assert delivery is not None
        delivery.auth_type = auth_type
    with pytest.raises(HumanInputFormError) as caught:
        approval.issue()
    assert caught.value.code == HumanInputFormErrorCode.NOT_FOUND


def test_public_uploaded_file_can_be_submitted_and_restored(approval: Approval, monkeypatch):
    grant = approval.issue()
    context = approval.service.validate_upload_token(grant.upload_token)
    uploaded = approval.service.upload_local_file(
        context=context, filename="review.txt", content=b"review", mimetype="text/plain"
    )
    with approval.sessions.begin() as session:
        form = session.get(HumanInputForm, approval.form_id)
        run = session.get(WorkflowRun, form.workflow_run_id)
        session.add(WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="checkpoint"))
    monkeypatch.setattr(
        "tasks.app_generate.workflow_execute_task.resume_app_execution.apply_async", lambda **_kwargs: None
    )
    service = HumanInputSubmissionService(session_factory=approval.sessions)
    from services.human_input_v2.email_otp_service import EmailOtpService, EmailSubject, VerifiedEmail

    with approval.sessions() as session:
        delivery = SQLAlchemyDeliveryRepository(session).get_delivery_by_token_hash(
            hashlib.sha256(approval.token.encode()).hexdigest()
        )
    assert delivery is not None
    email_otp = Mock(spec=EmailOtpService)
    email_otp.verify.return_value = VerifiedEmail(
        delivery, EmailSubject(email="approver@example.com"), approval.app_id, "verified-challenge"
    )
    service.submit_public_form(
        email_otp_service=email_otp,
        challenge_token="verified-challenge",
        otp_code="123456",
        ip_address=None,
        form_token=approval.token,
        action="approve",
        inputs={"file": {"type": "document", "transfer_method": "local_file", "upload_file_id": uploaded.id}},
    )
    with approval.sessions() as session:
        restored = SQLAlchemyFormRepository(session, approval.tenant_id, approval.app_id).get_form_by_id(
            approval.form_id
        )
        assert restored.submission is not None
        segment = restored.submission.normalized_submission_data["file"]
        assert isinstance(segment, FileSegment)
        assert segment.value.related_id == uploaded.id
