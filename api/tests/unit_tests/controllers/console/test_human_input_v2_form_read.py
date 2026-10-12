"""Read Console v2 forms through their registered HTTP and authorization boundaries."""

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
import sqlalchemy as sa
from flask import Response, g
from flask.testing import FlaskClient
from sqlalchemy.orm import Session, sessionmaker

from controllers.console.human_input_v2 import form as controller
from core.human_input import ButtonStyle
from core.human_input_v2.resolved_form import MarkdownFragment, ParagraphInput, ResolvedForm, UserAction
from core.human_input_v2.shared.values import ContactId, TenantId
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from core.workflow.nodes.human_input_v2.entities import Contact
from dify_app import DifyApp
from enums import DeploymentEdition
from extensions.ext_login import DifyLoginManager
from graphon.variables.segments import StringSegment
from libs.external_api import ExternalApi
from models.account import Account, AccountStatus, TenantAccountJoin, TenantAccountRole
from models.human_input_v2 import (
    ContactSubjectType,
    HumanInputContactIdentity,
    HumanInputDelivery,
    HumanInputForm,
    HumanInputPlatformContactWorkspaceEntry,
)
from repositories.human_input_v2.delivery_repository import DeliveryCreateParams, InitiatorSnapshot, SubmissionAuthType
from repositories.human_input_v2.form_repository import Form, FormCreateParams
from repositories.human_input_v2.recipient_repository import ContactRecipientSubject, Recipient, RecipientCreateParams
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from repositories.human_input_v2.sqlalchemy_recipient_repository import SQLAlchemyRecipientRepository
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account, make_tenant

_NOW = datetime(2030, 1, 1)
_TOKEN = "console-v2-read-token"
_PATH = f"/console/api/form/human-input/v2/{_TOKEN}"


@dataclass
class ConsoleForm:
    client: FlaskClient
    sessions: sessionmaker[Session]
    form: Form
    recipient: Recipient
    contact_id: ContactId
    actor: Account | None


@pytest.fixture
def console_form(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> ConsoleForm:
    tenant = make_tenant(tenant_id=str(uuid4()))
    active_tenant = make_tenant(tenant_id=str(uuid4()))
    account = make_account(account_id=str(uuid4()), tenant=active_tenant)
    identity = HumanInputContactIdentity(subject_type=ContactSubjectType.ACCOUNT, account_id=account.id)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                tenant,
                active_tenant,
                account,
                identity,
                TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.NORMAL),
                TenantAccountJoin(tenant_id=active_tenant.id, account_id=account.id, role=TenantAccountRole.NORMAL),
            ]
        )
        form = SQLAlchemyFormRepository(session, TenantId(tenant.id), str(uuid4())).create_form(
            FormCreateParams(
                workflow_run_id=None,
                node_execution_id=None,
                form_kind=HumanInputFormKind.DELIVERY_TEST,
                resolved_form=ResolvedForm(
                    title="Frozen approval",
                    parts=(
                        MarkdownFragment(text="Review: "),
                        ParagraphInput(output_variable_name="note", default_value="Draft"),
                    ),
                    actions=(UserAction(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY),),
                    legacy_form_content="Review: {{#$output.note#}}",
                ),
                expiration_time=_NOW + timedelta(hours=1),
                global_timeout_deadline=_NOW + timedelta(hours=2),
            )
        )
        recipient = SQLAlchemyRecipientRepository(session, form.tenant_id, form.id).create_recipients(
            [
                RecipientCreateParams(
                    ContactRecipientSubject(ContactId(identity.id)), (Contact(contact_id=identity.id),), account.name
                )
            ]
        )[0]
        SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=form.tenant_id,
            form_id=form.id,
            params=DeliveryCreateParams(
                recipient_id=recipient.id,
                token_hash=hashlib.sha256(_TOKEN.encode()).hexdigest(),
                auth_type=SubmissionAuthType.CONSOLE,
                target_snapshot=InitiatorSnapshot(protected_form_token="encrypted-token"),
            ),
        )

    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, LOGIN_DISABLED=False)
    monkeypatch.setattr("services.human_input_v2.submission_service.naive_utc_now", lambda: _NOW)
    # Isolate session decoding and CSRF; keep the route's login and Contact authorization real.
    monkeypatch.setattr("libs.login.check_csrf_token", lambda _request, _user_id: None)
    app = DifyApp(__name__)
    manager = DifyLoginManager(app)

    @manager.unauthorized_handler
    def unauthorized() -> Response:
        return Response("{}", status=401, mimetype="application/json")

    scenario = ConsoleForm(app.test_client(), sqlite_session_factory, form, recipient, ContactId(identity.id), account)

    @app.before_request
    def load_session_actor() -> None:
        g._login_user = scenario.actor

    ExternalApi(app).add_namespace(controller.console_ns, path="/console/api")
    return scenario


def test_reads_frozen_form_from_its_workspace_without_mutating_it(console_form: ConsoleForm) -> None:
    response = console_form.client.get(_PATH)

    assert response.status_code == 200
    assert response.json == {
        "resolved_form": {
            "title": "Frozen approval",
            "parts": [
                {"type": "markdown_fragment", "text": "Review: "},
                {"type": "paragraph_input", "output_variable_name": "note", "default_value": "Draft"},
            ],
            "actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
            "legacy_form_content": "Review: {{#$output.note#}}",
        },
        "expiration_time": 1893459600,
    }
    with console_form.sessions() as session:
        form = session.get(HumanInputForm, console_form.form.id)
        assert form is not None
        assert form.status == HumanInputFormStatus.WAITING
        assert form.updated_at == console_form.form.updated_at
        assert form.submitted_at is None


def test_requires_console_login(console_form: ConsoleForm) -> None:
    console_form.actor = None
    assert console_form.client.get(_PATH).status_code == 401


def test_unknown_token_is_not_found(console_form: ConsoleForm) -> None:
    response = console_form.client.get("/console/api/form/human-input/v2/unknown")
    assert response.status_code == 404
    assert response.json is not None
    assert response.json["code"] == "not_found"


@pytest.mark.parametrize("auth_type", [SubmissionAuthType.EMAIL_OTP, SubmissionAuthType.WEB_APP, SubmissionAuthType.IM])
def test_rejects_tokens_owned_by_other_surfaces(console_form: ConsoleForm, auth_type: SubmissionAuthType) -> None:
    with console_form.sessions.begin() as session:
        session.execute(
            sa.update(HumanInputDelivery)
            .where(HumanInputDelivery.form_id == console_form.form.id)
            .values(auth_type=auth_type)
        )
    response = console_form.client.get(_PATH)
    assert response.status_code == 404
    assert response.json is not None
    assert response.json["code"] == "not_found"


@pytest.mark.parametrize("revocation", ["membership", "contact", "account"])
def test_rechecks_current_contact_authorization(console_form: ConsoleForm, revocation: str) -> None:
    assert console_form.client.get(_PATH).status_code == 200
    assert console_form.actor is not None
    with console_form.sessions.begin() as session:
        match revocation:
            case "membership":
                session.execute(
                    sa.delete(TenantAccountJoin).where(TenantAccountJoin.tenant_id == console_form.form.tenant_id)
                )
            case "contact":
                session.execute(
                    sa.delete(HumanInputContactIdentity).where(HumanInputContactIdentity.id == console_form.contact_id)
                )
            case "account":
                session.execute(
                    sa.update(Account).where(Account.id == console_form.actor.id).values(status=AccountStatus.BANNED)
                )
    response = console_form.client.get(_PATH)
    assert response.status_code == 404
    assert response.json is not None
    assert response.json["code"] == "not_found"


def test_platform_contact_remains_authorized_without_workspace_membership(console_form: ConsoleForm) -> None:
    assert console_form.actor is not None
    with console_form.sessions.begin() as session:
        session.execute(sa.delete(TenantAccountJoin).where(TenantAccountJoin.tenant_id == console_form.form.tenant_id))
        session.add(
            HumanInputPlatformContactWorkspaceEntry(
                tenant_id=console_form.form.tenant_id,
                contact_id=console_form.contact_id,
                added_by_account_id=console_form.actor.id,
            )
        )
    assert console_form.client.get(_PATH).status_code == 200


def test_another_account_cannot_read_the_form(console_form: ConsoleForm) -> None:
    assert console_form.actor is not None
    console_form.actor = make_account(account_id=str(uuid4()), tenant=console_form.actor.current_tenant)
    response = console_form.client.get(_PATH)
    assert response.status_code == 404
    assert response.json is not None
    assert response.json["code"] == "not_found"


@pytest.mark.parametrize("deadline", ["expiration_time", "global_timeout_deadline"])
def test_waiting_form_is_unavailable_at_either_deadline(console_form: ConsoleForm, deadline: str) -> None:
    with console_form.sessions.begin() as session:
        session.execute(
            sa.update(HumanInputForm).where(HumanInputForm.id == console_form.form.id).values({deadline: _NOW})
        )
    response = console_form.client.get(_PATH)
    assert response.status_code == 410
    assert response.json is not None
    assert response.json["code"] == "expired"


def test_response_uses_the_earlier_global_deadline(console_form: ConsoleForm) -> None:
    with console_form.sessions.begin() as session:
        session.execute(
            sa.update(HumanInputForm)
            .where(HumanInputForm.id == console_form.form.id)
            .values(global_timeout_deadline=_NOW + timedelta(minutes=30))
        )
    response = console_form.client.get(_PATH)
    assert response.status_code == 200
    assert response.json is not None
    assert response.json["expiration_time"] == 1893457800


@pytest.mark.parametrize("status", [HumanInputFormStatus.TIMEOUT, HumanInputFormStatus.EXPIRED])
def test_rejects_terminal_forms(console_form: ConsoleForm, status: HumanInputFormStatus) -> None:
    with console_form.sessions.begin() as session:
        session.execute(
            sa.update(HumanInputForm).where(HumanInputForm.id == console_form.form.id).values(status=status)
        )
    response = console_form.client.get(_PATH)
    assert response.status_code == 410
    assert response.json is not None
    assert response.json["code"] == "expired"


def test_submitted_form_is_reported_only_to_its_recipient(console_form: ConsoleForm) -> None:
    with console_form.sessions.begin() as session:
        SQLAlchemyFormRepository(session, console_form.form.tenant_id, console_form.form.app_id).submit_form(
            console_form.form.id,
            submitted_by_recipient_id=console_form.recipient.id,
            selected_action_id="approve",
            raw_submission_inputs={"note": "Approved"},
            normalized_submission_data={"note": StringSegment(value="Approved")},
        )
    response = console_form.client.get(_PATH)
    assert response.status_code == 409
    assert response.json is not None
    assert response.json["code"] == "already_submitted"
    assert console_form.actor is not None
    console_form.actor = make_account(account_id=str(uuid4()), tenant=console_form.actor.current_tenant)
    assert console_form.client.get(_PATH).status_code == 404
