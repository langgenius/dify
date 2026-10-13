"""Public form definitions require a delivery token, independently of email proof."""

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import NoReturn
from uuid import uuid4

import pytest
import sqlalchemy as sa
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session, sessionmaker

from controllers.web import human_input_form_access_request as controller
from core.human_input import ButtonStyle
from core.human_input_v2.resolved_form import (
    FileInput,
    FileListInput,
    MarkdownFragment,
    ParagraphInput,
    ResolvedForm,
    SelectInput,
    UserAction,
)
from core.human_input_v2.shared.values import ContactId, NormalizedEmail, TenantId
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from core.workflow.nodes.human_input_v2.entities import Contact, DynamicEmail, OnetimeEmail
from graphon.file.enums import FileTransferMethod, FileType
from graphon.variables.segments import StringSegment
from libs.external_api import ExternalApi
from models.human_input_v2 import (
    HumanInputAuditEvent,
    HumanInputContactIdentity,
    HumanInputDelivery,
    HumanInputExternalContactProfile,
    HumanInputForm,
    HumanInputRecipient,
)
from models.model import App, AppMode
from repositories.human_input_v2.contact import ExternalContact
from repositories.human_input_v2.delivery_repository import (
    DeliveryCreateParams,
    EmailTargetSnapshot,
    InitiatorSnapshot,
    SubmissionAuthType,
)
from repositories.human_input_v2.form_repository import Form, FormCreateParams
from repositories.human_input_v2.recipient_repository import (
    ContactRecipientSubject,
    EmailRecipientSubject,
    Recipient,
    RecipientCreateParams,
)
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from repositories.human_input_v2.sqlalchemy_recipient_repository import SQLAlchemyRecipientRepository
from services.human_input_v2.email_otp_service import EmailOtpService
from tests.unit_tests.model_factories import make_tenant

_NOW = datetime(2030, 1, 1)
_TOKEN = "public-v2-read-token"
_PATH = f"/api/form/human-input/v2/public/{_TOKEN}"


@dataclass
class PublicForm:
    client: FlaskClient
    sessions: sessionmaker[Session]
    form: Form
    recipient: Recipient


@pytest.fixture(params=["email", "dynamic_email", "external_contact"])
def public_form(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest
) -> PublicForm:
    tenant = make_tenant(tenant_id=str(uuid4()))
    app_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(tenant)
        session.add(
            App(
                id=app_id,
                tenant_id=tenant.id,
                name="Email approval",
                mode=AppMode.WORKFLOW,
                enable_site=False,
                enable_api=True,
            )
        )
        form = SQLAlchemyFormRepository(session, TenantId(tenant.id), app_id).create_form(
            FormCreateParams(
                workflow_run_id=None,
                node_execution_id=None,
                form_kind=HumanInputFormKind.DELIVERY_TEST,
                resolved_form=ResolvedForm(
                    title="Frozen approval",
                    legacy_form_content=(
                        "Review {{#$output.note#}}: {{#$output.choice#}} {{#$output.file#}} {{#$output.attachments#}}"
                    ),
                    parts=(
                        MarkdownFragment(text="Review "),
                        ParagraphInput(output_variable_name="note", default_value="Draft"),
                        SelectInput(output_variable_name="choice", options=("Yes", "No"), default_value="No"),
                        FileInput(
                            output_variable_name="file",
                            allowed_file_types=(FileType.DOCUMENT,),
                            allowed_file_extensions=(".txt",),
                            allowed_file_upload_methods=(FileTransferMethod.LOCAL_FILE,),
                        ),
                        FileListInput(
                            output_variable_name="attachments",
                            allowed_file_types=(FileType.IMAGE,),
                            allowed_file_extensions=(),
                            allowed_file_upload_methods=(FileTransferMethod.REMOTE_URL,),
                            number_limits=2,
                        ),
                    ),
                    actions=(UserAction(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY),),
                ),
                expiration_time=_NOW + timedelta(hours=1),
                global_timeout_deadline=_NOW + timedelta(hours=2),
            )
        )
        if request.param == "external_contact":
            contact = SQLAlchemyContactRepository(session).save_external_contact(
                form.tenant_id,
                ExternalContact(
                    id=ContactId(str(uuid4())),
                    name="Approver",
                    email="approver@example.com",
                    avatar_file_id=None,
                    created_at=_NOW,
                ),
            )
            subject = ContactRecipientSubject(contact.id)
            source = Contact(contact_id=contact.id)
        else:
            subject = EmailRecipientSubject(NormalizedEmail("approver@example.com"))
            source = (
                DynamicEmail(selector=["input", "email"])
                if request.param == "dynamic_email"
                else OnetimeEmail(email="approver@example.com")
            )
        recipient = SQLAlchemyRecipientRepository(session, form.tenant_id, form.id).create_recipients(
            [RecipientCreateParams(subject=subject, sources=(source,), name="Approver")]
        )[0]
        SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=form.tenant_id,
            form_id=form.id,
            params=DeliveryCreateParams(
                recipient_id=recipient.id,
                token_hash=hashlib.sha256(_TOKEN.encode()).hexdigest(),
                auth_type=SubmissionAuthType.EMAIL_OTP,
                target_snapshot=EmailTargetSnapshot(email_address="approver@example.com"),
            ),
        )

    # Read before any challenge is issued; OTP operations are not read side effects.
    def reject_otp(*_args: object, **_kwargs: object) -> NoReturn:
        pytest.fail("Form reads must not issue or verify OTP")

    monkeypatch.setattr(EmailOtpService, "request_access", reject_otp)
    monkeypatch.setattr(EmailOtpService, "verify", reject_otp)
    monkeypatch.setattr("services.human_input_v2.submission_service.naive_utc_now", lambda: _NOW)
    app = Flask(__name__)
    ExternalApi(app).add_namespace(controller.web_ns, path="/api")
    return PublicForm(app.test_client(), sqlite_session_factory, form, recipient)


def test_reads_complete_frozen_definition_without_otp_or_session(public_form: PublicForm) -> None:
    response = public_form.client.get(_PATH)
    assert response.status_code == 200, response.json
    assert response.json == {
        "form_content": "Review {{#$output.note#}}: {{#$output.choice#}} {{#$output.file#}} {{#$output.attachments#}}",
        "inputs": [
            {
                "type": "paragraph",
                "output_variable_name": "note",
                "default": {"type": "constant", "selector": [], "value": "Draft"},
            },
            {
                "type": "select",
                "output_variable_name": "choice",
                "option_source": {"type": "constant", "selector": [], "value": ["Yes", "No"]},
            },
            {
                "type": "file",
                "output_variable_name": "file",
                "allowed_file_types": ["document"],
                "allowed_file_extensions": [".txt"],
                "allowed_file_upload_methods": ["local_file"],
            },
            {
                "type": "file-list",
                "output_variable_name": "attachments",
                "allowed_file_types": ["image"],
                "allowed_file_extensions": [],
                "allowed_file_upload_methods": ["remote_url"],
                "number_limits": 2,
            },
        ],
        "resolved_default_values": {"note": "Draft", "choice": "No"},
        "user_actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
        "expiration_time": 1893459600,
    }
    with public_form.sessions() as session:
        form = session.get(HumanInputForm, public_form.form.id)
        assert form is not None
        assert form.status == HumanInputFormStatus.WAITING
        assert form.updated_at == public_form.form.updated_at
        assert form.submitted_at is None
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputAuditEvent)) == 0


def test_unknown_token_is_not_found(public_form: PublicForm) -> None:
    response = public_form.client.get("/api/form/human-input/v2/public/unknown")
    assert response.status_code == 404
    assert response.json is not None
    assert response.json["code"] == "human_input_form_not_found"


@pytest.mark.parametrize("auth_type", [SubmissionAuthType.CONSOLE, SubmissionAuthType.WEB_APP, SubmissionAuthType.IM])
def test_rejects_other_authentication_surfaces(public_form: PublicForm, auth_type: SubmissionAuthType) -> None:
    with public_form.sessions.begin() as session:
        session.execute(
            sa.update(HumanInputDelivery)
            .where(HumanInputDelivery.form_id == public_form.form.id)
            .values(auth_type=auth_type)
        )
    assert public_form.client.get(_PATH).status_code == 404


def test_rejects_non_email_delivery_target(public_form: PublicForm) -> None:
    with public_form.sessions.begin() as session:
        delivery = session.scalar(
            sa.select(HumanInputDelivery).where(HumanInputDelivery.form_id == public_form.form.id)
        )
        assert delivery is not None
        delivery.target_snapshot = InitiatorSnapshot(protected_form_token="ciphertext")
    assert public_form.client.get(_PATH).status_code == 404


@pytest.mark.parametrize(
    "mismatch", ["delivery_tenant", "form_tenant", "app_tenant", "missing_app", "recipient_form", "recipient_tenant"]
)
def test_read_resolves_the_complete_owner_chain(public_form: PublicForm, mismatch: str) -> None:
    with public_form.sessions.begin() as session:
        match mismatch:
            case "delivery_tenant":
                session.execute(
                    sa.update(HumanInputDelivery)
                    .where(HumanInputDelivery.form_id == public_form.form.id)
                    .values(tenant_id=str(uuid4()))
                )
            case "form_tenant":
                session.execute(
                    sa.update(HumanInputForm)
                    .where(HumanInputForm.id == public_form.form.id)
                    .values(tenant_id=str(uuid4()))
                )
            case "app_tenant":
                session.execute(sa.update(App).where(App.id == public_form.form.app_id).values(tenant_id=str(uuid4())))
            case "missing_app":
                session.execute(sa.delete(App).where(App.id == public_form.form.app_id))
            case "recipient_form":
                session.execute(
                    sa.update(HumanInputRecipient)
                    .where(HumanInputRecipient.id == public_form.recipient.id)
                    .values(form_id=str(uuid4()))
                )
            case "recipient_tenant":
                session.execute(
                    sa.update(HumanInputRecipient)
                    .where(HumanInputRecipient.id == public_form.recipient.id)
                    .values(tenant_id=str(uuid4()))
                )
    assert public_form.client.get(_PATH).status_code == 404


def test_removed_recipient_is_not_found(public_form: PublicForm) -> None:
    with public_form.sessions.begin() as session:
        session.execute(sa.delete(HumanInputRecipient).where(HumanInputRecipient.id == public_form.recipient.id))
    assert public_form.client.get(_PATH).status_code == 404


@pytest.mark.parametrize("public_form", ["external_contact"], indirect=True)
@pytest.mark.parametrize("revocation", ["email", "profile", "identity"])
def test_unavailable_or_changed_external_contact_cannot_read(public_form: PublicForm, revocation: str) -> None:
    assert isinstance(public_form.recipient.subject, ContactRecipientSubject)
    with public_form.sessions.begin() as session:
        contact_id = public_form.recipient.subject.contact_id
        match revocation:
            case "email":
                session.execute(
                    sa.update(HumanInputExternalContactProfile)
                    .where(HumanInputExternalContactProfile.contact_id == contact_id)
                    .values(email="changed@example.com", normalized_email="changed@example.com")
                )
            case "profile":
                session.execute(
                    sa.delete(HumanInputExternalContactProfile).where(
                        HumanInputExternalContactProfile.contact_id == contact_id
                    )
                )
            case "identity":
                session.execute(sa.delete(HumanInputContactIdentity).where(HumanInputContactIdentity.id == contact_id))
    assert public_form.client.get(_PATH).status_code == 404


@pytest.mark.parametrize("deadline", ["expiration_time", "global_timeout_deadline"])
def test_waiting_form_is_unavailable_at_either_deadline(public_form: PublicForm, deadline: str) -> None:
    with public_form.sessions.begin() as session:
        session.execute(
            sa.update(HumanInputForm).where(HumanInputForm.id == public_form.form.id).values({deadline: _NOW})
        )
    response = public_form.client.get(_PATH)
    assert response.status_code == 412
    assert response.json is not None
    assert response.json["code"] == "human_input_form_expired"


def test_response_uses_the_earlier_global_deadline(public_form: PublicForm) -> None:
    with public_form.sessions.begin() as session:
        session.execute(
            sa.update(HumanInputForm)
            .where(HumanInputForm.id == public_form.form.id)
            .values(global_timeout_deadline=_NOW + timedelta(minutes=30))
        )
    response = public_form.client.get(_PATH)
    assert response.status_code == 200
    assert response.json is not None
    assert response.json["expiration_time"] == 1893457800


@pytest.mark.parametrize("status", [HumanInputFormStatus.TIMEOUT, HumanInputFormStatus.EXPIRED])
def test_rejects_terminal_forms(public_form: PublicForm, status: HumanInputFormStatus) -> None:
    with public_form.sessions.begin() as session:
        session.execute(sa.update(HumanInputForm).where(HumanInputForm.id == public_form.form.id).values(status=status))
    response = public_form.client.get(_PATH)
    assert response.status_code == 412
    assert response.json is not None
    assert response.json["code"] == "human_input_form_expired"


def test_submitted_form_is_reported_as_complete(public_form: PublicForm) -> None:
    with public_form.sessions.begin() as session:
        SQLAlchemyFormRepository(session, public_form.form.tenant_id, public_form.form.app_id).submit_form(
            public_form.form.id,
            submitted_by_recipient_id=public_form.recipient.id,
            selected_action_id="approve",
            raw_submission_inputs={"note": "Approved"},
            normalized_submission_data={"note": StringSegment(value="Approved")},
        )
    response = public_form.client.get(_PATH)
    assert response.status_code == 412
    assert response.json is not None
    assert response.json["code"] == "human_input_form_submitted"
