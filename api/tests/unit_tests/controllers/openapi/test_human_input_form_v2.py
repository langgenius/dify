"""OpenAPI form operations preserve v2 ownership and first-success submission."""

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from hashlib import sha256
from io import BytesIO
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from constants.oauth_bearer import TokenType
from core.human_input_v2.resolved_form import ParagraphInput, ResolvedForm, UserAction
from core.human_input_v2.shared.values import ContactId, TenantId
from core.workflow.nodes.human_input.enums import ButtonStyle, HumanInputFormStatus
from core.workflow.nodes.human_input_v2.entities import Initiator
from enums import DeploymentEdition, WebAppAccessMode
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from libs.oauth_bearer import AuthContext, BearerAuthenticator
from models import Account, App
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.human_input_v2 import (
    ContactSubjectType,
    HumanInputContactIdentity,
    HumanInputDelivery,
    HumanInputForm,
    HumanInputRecipient,
    RecipientSubjectType,
)
from models.model import AppMode, EndUser
from models.workflow import WorkflowPause, WorkflowRun, WorkflowType
from repositories.human_input_v2.delivery_repository import (
    DeliveryCreateParams,
    DeliveryTargetType,
    EmailTargetSnapshot,
    InitiatorSnapshot,
    SubmissionAuthType,
)
from repositories.human_input_v2.form_repository import FormCreateParams
from repositories.human_input_v2.recipient_repository import ContactRecipientSubject, RecipientCreateParams
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from repositories.human_input_v2.sqlalchemy_recipient_repository import SQLAlchemyRecipientRepository
from services.entities.feature_entities import SystemFeatureModel
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld


@dataclass(frozen=True)
class Approval:
    form_id: str
    run_id: str
    account_id: str
    token: str

    def url(self, app_id: str) -> str:
        return f"/openapi/v1/apps/{app_id}/human-input-forms/{self.token}"


@pytest.fixture
def approval(admitted_bearer: AdmittedWorld, sqlite_session_factory: sessionmaker[Session]) -> Approval:
    tenant_id = TenantId(admitted_bearer.workspace_id)
    app_id = admitted_bearer.app_id
    run_id, contact_id, token = str(uuid4()), ContactId(str(uuid4())), "v2-initiator-token"
    now = naive_utc_now()
    with sqlite_session_factory.begin() as session:
        account = session.scalars(select(Account)).one()
        account_id = account.id
        identity = HumanInputContactIdentity(subject_type=ContactSubjectType.ACCOUNT, account_id=account_id)
        identity.id = contact_id
        session.add(identity)
        run = WorkflowRun(
            id=run_id,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=str(uuid4()),
            type=WorkflowType.WORKFLOW,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="2",
            status=WorkflowExecutionStatus.PAUSED,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account_id,
        )
        session.add_all(
            [run, WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run_id, state_object_key="checkpoint")]
        )
        form = SQLAlchemyFormRepository(session, tenant_id, app_id).create_form(
            FormCreateParams(
                workflow_run_id=run_id,
                node_execution_id=str(uuid4()),
                expiration_time=now + timedelta(hours=1),
                global_timeout_deadline=now + timedelta(days=1),
                resolved_form=ResolvedForm(
                    title="Approval",
                    parts=(ParagraphInput(output_variable_name="note", resolved_default_value="Draft"),),
                    actions=(UserAction(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY),),
                    legacy_form_content="Review: {{#$output.note#}}",
                ),
            )
        )
        recipient = SQLAlchemyRecipientRepository(session, tenant_id, form.id).create_recipients(
            (RecipientCreateParams(ContactRecipientSubject(contact_id), (Initiator(),), "Caller"),)
        )[0]
        SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=tenant_id,
            form_id=form.id,
            params=DeliveryCreateParams(
                recipient_id=recipient.id,
                token_hash=sha256(token.encode()).hexdigest(),
                auth_type=SubmissionAuthType.CONSOLE,
                target_snapshot=InitiatorSnapshot(protected_form_token="encrypted"),
            ),
        )
    return Approval(form.id, run_id, account_id, token)


@pytest.fixture
def resumed(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> list[str]:
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    runs: list[str] = []

    def enqueue(*, kwargs: dict[str, dict[str, str]]) -> None:
        run_id = kwargs["payload"]["workflow_run_id"]
        with sqlite_session_factory() as session:
            form = session.scalars(select(HumanInputForm).where(HumanInputForm.workflow_run_id == run_id)).one()
            assert form.status == HumanInputFormStatus.SUBMITTED
        runs.append(run_id)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    return runs


def test_account_reads_and_submits_v2_form_once(
    admitted_bearer: AdmittedWorld,
    approval: Approval,
    resumed: list[str],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    client, headers = admitted_bearer.client, admitted_bearer.headers
    url = approval.url(admitted_bearer.app_id)

    read = client.get(url, headers=headers)
    assert read.status_code == 200
    assert read.json is not None
    assert read.json["form_content"] == "Review: {{#$output.note#}}"
    assert read.json["inputs"][0]["output_variable_name"] == "note"
    assert read.json["resolved_default_values"] == {"note": "Draft"}
    assert read.json["user_actions"][0]["id"] == "approve"

    submitted = client.post(
        f"{url}:submit", headers=headers, json={"action": "approve", "inputs": {"note": "Accepted"}}
    )
    assert submitted.status_code == 200
    assert submitted.json is not None
    assert submitted.json["hints"][0]["input"]["run_id"] == approval.run_id
    assert resumed == [approval.run_id]

    duplicate = client.post(f"{url}:submit", headers=headers, json={"action": "approve", "inputs": {"note": "Changed"}})
    assert duplicate.status_code == 409
    assert duplicate.json is not None
    assert duplicate.json["code"] == "already_submitted"
    assert resumed == [approval.run_id]
    with sqlite_session_factory() as session:
        stored = session.get_one(HumanInputForm, approval.form_id)
        assert stored.selected_action_id == "approve"
        assert stored.raw_submission_inputs is not None
        assert json.loads(stored.raw_submission_inputs) == {"note": "Accepted"}


@pytest.mark.parametrize(
    ("mismatch", "status"),
    [
        (mismatch, status)
        for mismatch in ["account", "tenant", "notification", "email_otp"]
        for status in [HumanInputFormStatus.WAITING, HumanInputFormStatus.TIMEOUT]
    ]
    + [("app", HumanInputFormStatus.WAITING)],
)
def test_v2_tokens_require_the_current_initiator_and_owning_app(
    admitted_bearer: AdmittedWorld,
    approval: Approval,
    resumed: list[str],
    sqlite_session_factory: sessionmaker[Session],
    mismatch: str,
    status: HumanInputFormStatus,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.get_one(HumanInputForm, approval.form_id).status = status
        if mismatch == "account":
            session.scalars(select(HumanInputRecipient)).one().subject_value = str(uuid4())
        elif mismatch == "app":
            other_app = App(
                tenant_id=admitted_bearer.workspace_id,
                name="Other app",
                mode=AppMode.WORKFLOW,
                enable_site=True,
                enable_api=True,
            )
            session.add(other_app)
            session.flush()
            session.get_one(HumanInputForm, approval.form_id).app_id = other_app.id
        elif mismatch == "tenant":
            session.get_one(HumanInputForm, approval.form_id).tenant_id = str(uuid4())
        else:
            delivery = session.scalars(select(HumanInputDelivery)).one()
            delivery.target_type = DeliveryTargetType.EMAIL
            delivery.target_snapshot = EmailTargetSnapshot(email_address="recipient@example.com")
            if mismatch == "email_otp":
                delivery.auth_type = SubmissionAuthType.EMAIL_OTP

    url = approval.url(admitted_bearer.app_id)
    read = admitted_bearer.client.get(url, headers=admitted_bearer.headers)
    submitted = admitted_bearer.client.post(
        f"{url}:submit", headers=admitted_bearer.headers, json={"action": "approve", "inputs": {"note": "Rejected"}}
    )
    assert (read.status_code, submitted.status_code) == (404, 404)
    assert read.json is not None
    assert submitted.json is not None
    assert read.json["code"] == submitted.json["code"] == "form_not_found"
    assert resumed == []
    with sqlite_session_factory() as session:
        assert session.get_one(HumanInputForm, approval.form_id).status == status


@pytest.mark.parametrize("expired", [False, True])
def test_v2_form_failures_do_not_change_or_resume_the_run(
    admitted_bearer: AdmittedWorld,
    approval: Approval,
    resumed: list[str],
    sqlite_session_factory: sessionmaker[Session],
    expired: bool,
) -> None:
    if expired:
        with sqlite_session_factory.begin() as session:
            session.get_one(HumanInputForm, approval.form_id).expiration_time = naive_utc_now() - timedelta(hours=1)
    response = admitted_bearer.client.post(
        f"{approval.url(admitted_bearer.app_id)}:submit",
        headers=admitted_bearer.headers,
        json={"action": "approve", "inputs": {"note": "Accepted"} if expired else {}},
    )
    assert response.status_code == (410 if expired else 400)
    assert response.json is not None
    assert response.json["code"] == ("expired" if expired else "invalid_input")
    assert resumed == []
    with sqlite_session_factory() as session:
        assert session.get_one(HumanInputForm, approval.form_id).status == HumanInputFormStatus.WAITING


def test_unauthorized_v2_form_cannot_store_uploaded_files(
    admitted_bearer: AdmittedWorld,
    approval: Approval,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.scalars(select(HumanInputRecipient)).one().subject_value = str(uuid4())

    def reject_upload(*_args: object, **_kwargs: object) -> None:
        pytest.fail("An unauthorized form must not store uploaded files")

    monkeypatch.setattr("controllers.openapi._files.upload", reject_upload)
    response = admitted_bearer.client.post(
        f"{approval.url(admitted_bearer.app_id)}:submit",
        headers=admitted_bearer.headers,
        data={"action": '"approve"', "inputs": "{}", "files[note]": (BytesIO(b"Private"), "note.txt")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 404


@pytest.mark.parametrize("original_end_user", [False, True])
def test_external_sso_can_only_approve_its_own_initiator_grant(
    admitted_bearer: AdmittedWorld,
    approval: Approval,
    resumed: list[str],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    original_end_user: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(
        "services.system_feature_service.SystemFeatureService.get_public_system_features",
        lambda: SystemFeatureModel(
            deployment_edition=DeploymentEdition.ENTERPRISE, agent_tracing_api_collection_enabled=False
        ),
    )
    monkeypatch.setattr(
        "controllers.openapi.auth.requirements.CheckAppAccess._access_mode",
        lambda _self, _app_id: WebAppAccessMode.PUBLIC,
    )
    email = "external@example.com"
    with sqlite_session_factory.begin() as session:
        end_user = EndUser(
            tenant_id=admitted_bearer.workspace_id,
            app_id=admitted_bearer.app_id,
            type=EndUserType.OPENAPI,
            session_id=email,
            external_user_id=email,
        )
        session.add(end_user)
        session.flush()
        recipient = session.scalars(select(HumanInputRecipient)).one()
        recipient.subject_type = RecipientSubjectType.END_USER
        recipient.subject_value = end_user.id if original_end_user else str(uuid4())
        session.scalars(select(HumanInputDelivery)).one().auth_type = SubmissionAuthType.WEB_APP
    token = AuthContext(
        token_type=TokenType.OAUTH_EXTERNAL_SSO,
        subject_email=email,
        subject_issuer="https://sso.example.com",
        account_id=None,
        client_id="difyctl",
        token_id=uuid4(),
        expires_at=None,
    )
    authenticator = BearerAuthenticator({})
    monkeypatch.setattr(authenticator, "authenticate", lambda _token: token)
    monkeypatch.setattr("controllers.openapi.auth.router.get_authenticator", lambda: authenticator)
    url = approval.url(admitted_bearer.app_id)
    read = admitted_bearer.client.get(url, headers=admitted_bearer.headers)
    submitted = admitted_bearer.client.post(
        f"{url}:submit", headers=admitted_bearer.headers, json={"action": "approve", "inputs": {"note": "Accepted"}}
    )
    assert (read.status_code, submitted.status_code) == ((200, 200) if original_end_user else (404, 404))
    assert resumed == ([approval.run_id] if original_end_user else [])
