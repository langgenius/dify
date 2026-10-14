"""The existing Service API form contract applies to both HITL storage versions."""

import hashlib
import json
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import timedelta
from threading import Barrier
from types import SimpleNamespace
from typing import NoReturn
from uuid import uuid4

import pytest
import sqlalchemy as sa
from flask import Flask
from flask import request as flask_request
from flask.testing import FlaskClient
from flask_login import LoginManager
from kombu.exceptions import OperationalError
from pydantic import JsonValue
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, scoped_session, sessionmaker
from werkzeug.exceptions import Unauthorized
from werkzeug.test import TestResponse

from controllers.service_api import wraps
from controllers.service_api.app import human_input_form as controller
from core.human_input import ButtonStyle
from core.human_input_v2.resolved_form import (
    FileInput,
    FileListInput,
    ParagraphInput,
    ResolvedForm,
    SelectInput,
    UserAction,
)
from core.human_input_v2.shared.values import TenantId
from core.workflow.nodes.human_input.entities import FormDefinition
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input_v2.entities import Initiator
from extensions.storage.storage_type import StorageType
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from graphon.file.enums import FileTransferMethod, FileType
from graphon.variables.segments import ArrayFileSegment, FileSegment
from libs.datetime_utils import naive_utc_now
from libs.external_api import ExternalApi
from models.account import TenantAccountJoin, TenantAccountRole
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.human_input import HumanInputForm as LegacyForm
from models.human_input import HumanInputFormRecipient as LegacyRecipient
from models.human_input import RecipientType
from models.human_input_v2 import HumanInputAuditEvent, HumanInputDelivery, RecipientSubjectType
from models.human_input_v2 import HumanInputForm as V2Form
from models.human_input_v2 import HumanInputRecipient as V2Recipient
from models.model import ApiToken, AppMode, EndUser, UploadFile
from models.workflow import WorkflowPause, WorkflowRun
from repositories.human_input_v2.delivery_repository import DeliveryCreateParams, InitiatorSnapshot, SubmissionAuthType
from repositories.human_input_v2.form_repository import FormCreateParams
from repositories.human_input_v2.recipient_repository import EndUserRecipientSubject, RecipientCreateParams
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from repositories.human_input_v2.sqlalchemy_recipient_repository import SQLAlchemyRecipientRepository
from tasks.app_generate.workflow_execute_task import resume_app_execution
from tests.unit_tests.model_factories import make_account, make_app, make_tenant

_NOW = naive_utc_now().replace(microsecond=0)
_TOKEN = "service-approval-token"
_PATH = f"/v1/form/human_input/{_TOKEN}"
_HEADERS = {"Authorization": "Bearer test-app-key"}
_CONTENT = "Review {{#$output.note#}}: {{#$output.choice#}}"
_INPUTS: dict[str, JsonValue] = {"note": "Approved", "choice": "Yes"}


@dataclass
class Approval:
    client: FlaskClient
    sessions: sessionmaker[Session]
    version: str
    tenant_id: str
    app_id: str
    run_id: str
    form_id: str
    recipient_id: str
    submitter_id: str
    published: list[dict[str, object]]

    def submit(self, *, inputs: dict[str, JsonValue], action: str = "approve", user: str = "reviewer") -> TestResponse:
        return self.client.post(_PATH, headers=_HEADERS, json={"user": user, "action": action, "inputs": inputs})

    def submission(self) -> dict[str, JsonValue] | None:
        with self.sessions() as session:
            if self.version == "1":
                form = session.get(LegacyForm, self.form_id)
                assert form is not None
                return json.loads(form.submitted_data) if form.submitted_data is not None else None
            form = session.get(V2Form, self.form_id)
            assert form is not None
            return json.loads(form.raw_submission_inputs) if form.raw_submission_inputs is not None else None


@pytest.fixture(params=["1", "2"])
def approval(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    request: pytest.FixtureRequest,
) -> Iterator[Approval]:
    version = request.param
    tenant = make_tenant(tenant_id=str(uuid4()))
    owner = make_account(account_id=str(uuid4()))
    application = make_app(app_id=str(uuid4()), tenant_id=tenant.id, mode=AppMode.WORKFLOW)
    initiator = EndUser(
        id=str(uuid4()),
        tenant_id=tenant.id,
        app_id=application.id,
        type=EndUserType.SERVICE_API,
        external_user_id="initiator",
        session_id="initiator",
    )
    submitter = EndUser(
        id=str(uuid4()),
        tenant_id=tenant.id,
        app_id=application.id,
        type=EndUserType.SERVICE_API,
        external_user_id="reviewer",
        session_id="reviewer",
    )
    run = WorkflowRun(
        id=str(uuid4()),
        tenant_id=tenant.id,
        app_id=application.id,
        workflow_id=str(uuid4()),
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        status=WorkflowExecutionStatus.PAUSED,
        created_by_role=CreatorUserRole.END_USER,
        created_by=initiator.id,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([tenant, owner, application, initiator, submitter, run])
        session.add(TenantAccountJoin(tenant_id=tenant.id, account_id=owner.id, role=TenantAccountRole.OWNER))
        if version == "1":
            definition = FormDefinition.model_validate(
                {
                    "form_content": _CONTENT,
                    "rendered_content": _CONTENT,
                    "inputs": [
                        {
                            "type": "paragraph",
                            "output_variable_name": "note",
                            "default": {"type": "constant", "value": "Draft"},
                        },
                        {
                            "type": "select",
                            "output_variable_name": "choice",
                            "option_source": {"type": "constant", "value": ["Yes", "No"]},
                        },
                    ],
                    "default_values": {"note": "Draft"},
                    "expiration_time": _NOW + timedelta(hours=1),
                    "user_actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
                }
            )
            legacy = LegacyForm(
                id=str(uuid4()),
                tenant_id=tenant.id,
                app_id=application.id,
                workflow_run_id=run.id,
                node_id="approval",
                form_definition=definition.model_dump_json(),
                rendered_content=_CONTENT,
                expiration_time=_NOW + timedelta(hours=1),
                created_at=_NOW,
            )
            recipient = LegacyRecipient(
                id=str(uuid4()),
                form_id=legacy.id,
                delivery_id=str(uuid4()),
                recipient_type=RecipientType.STANDALONE_WEB_APP,
                recipient_payload='{"TYPE":"standalone_web_app"}',
                access_token=_TOKEN,
            )
            session.add_all([legacy, recipient])
            form_id, recipient_id = legacy.id, recipient.id
        else:
            form = SQLAlchemyFormRepository(session, TenantId(tenant.id), application.id).create_form(
                FormCreateParams(
                    workflow_run_id=run.id,
                    node_execution_id=str(uuid4()),
                    expiration_time=_NOW + timedelta(hours=1),
                    global_timeout_deadline=_NOW + timedelta(hours=2),
                    resolved_form=ResolvedForm(
                        title="Review",
                        legacy_form_content=_CONTENT,
                        parts=(
                            ParagraphInput(output_variable_name="note", default_value="Draft"),
                            SelectInput(output_variable_name="choice", options=("Yes", "No"), default_value=None),
                        ),
                        actions=(UserAction(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY),),
                    ),
                )
            )
            v2_recipient = SQLAlchemyRecipientRepository(session, form.tenant_id, form.id).create_recipients(
                [
                    RecipientCreateParams(
                        subject=EndUserRecipientSubject(initiator.id), sources=(Initiator(),), name=None
                    )
                ]
            )[0]
            SQLAlchemyDeliveryRepository(session).create_delivery(
                tenant_id=form.tenant_id,
                form_id=form.id,
                params=DeliveryCreateParams(
                    recipient_id=v2_recipient.id,
                    token_hash=hashlib.sha256(_TOKEN.encode()).hexdigest(),
                    auth_type=SubmissionAuthType.WEB_APP,
                    target_snapshot=InitiatorSnapshot(protected_form_token="unused-by-token-lookup"),
                ),
            )
            session.add(
                WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="checkpoint")
            )
            form_id, recipient_id = form.id, str(v2_recipient.id)

    database_sessions = scoped_session(sqlite_session_factory)
    database = SimpleNamespace(engine=sqlite_engine, session=database_sessions)
    monkeypatch.setattr(wraps, "db", database)
    monkeypatch.setattr(controller, "db", database)

    def authenticate(_token_type: str) -> ApiToken:
        if flask_request.headers.get("Authorization") != _HEADERS["Authorization"]:
            raise Unauthorized("Invalid API token")
        return ApiToken(app_id=application.id, type="app", token="test-app-key")

    def get_end_user(tenant_id: str, app_id: str, external_user_id: str | None) -> EndUser:
        with sqlite_session_factory() as session:
            end_user = session.scalar(
                sa.select(EndUser).where(
                    EndUser.tenant_id == tenant_id,
                    EndUser.app_id == app_id,
                    EndUser.external_user_id == external_user_id,
                )
            )
            assert end_user is not None
            return end_user

    monkeypatch.setattr(wraps, "validate_and_get_api_token", authenticate)
    monkeypatch.setattr(
        wraps,
        "application_services",
        lambda: SimpleNamespace(
            app_scoped_end_users=SimpleNamespace(commands=SimpleNamespace(get_or_create_end_user=get_end_user)),
        ),
    )
    monkeypatch.setattr("services.human_input_service.naive_utc_now", lambda: _NOW)
    monkeypatch.setattr("services.human_input_v2.submission_service.naive_utc_now", lambda: _NOW)
    published: list[dict[str, object]] = []

    def publish(*, kwargs: dict[str, object]) -> None:
        with sqlite_session_factory() as session:
            model = session.get(LegacyForm, form_id) if version == "1" else session.get(V2Form, form_id)
            assert model is not None
            assert model.status == HumanInputFormStatus.SUBMITTED
        published.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", publish)
    application_http = Flask(__name__)
    LoginManager().init_app(application_http)
    ExternalApi(application_http, register_default_root=False).add_namespace(controller.service_api_ns, path="/v1")
    yield Approval(
        application_http.test_client(),
        sqlite_session_factory,
        version,
        tenant.id,
        application.id,
        run.id,
        form_id,
        recipient_id,
        submitter.id,
        published,
    )
    database_sessions.remove()


def test_get_without_user_returns_the_existing_form_definition(approval: Approval) -> None:
    response = approval.client.get(_PATH, headers=_HEADERS)
    assert response.status_code == 200, response.json
    assert response.json == {
        "form_content": _CONTENT,
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
        ],
        "resolved_default_values": {"note": "Draft"},
        "user_actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
        "expiration_time": int((_NOW + timedelta(hours=1)).timestamp()),
    }
    assert approval.submission() is None
    assert approval.published == []


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_requires_an_app_api_token(approval: Approval, method: str) -> None:
    response = approval.client.open(
        _PATH, method=method, json={"user": "reviewer", "action": "approve", "inputs": _INPUTS}
    )
    assert response.status_code == 401
    assert approval.submission() is None


def test_post_accepts_a_different_user_and_resumes_after_commit(approval: Approval) -> None:
    response = approval.submit(inputs=_INPUTS)
    assert response.status_code == 200, response.json
    assert response.json == {}
    assert approval.submission() == _INPUTS
    assert approval.published == [{"payload": {"workflow_run_id": approval.run_id}}]
    with approval.sessions() as session:
        if approval.version == "1":
            legacy = session.get(LegacyForm, approval.form_id)
            assert legacy is not None
            assert legacy.submission_end_user_id == approval.submitter_id
        else:
            audits = session.scalars(
                sa.select(HumanInputAuditEvent).where(
                    HumanInputAuditEvent.tenant_id == approval.tenant_id,
                    HumanInputAuditEvent.form_id == approval.form_id,
                )
            ).all()
            assert [audit.payload.model_dump(mode="json") for audit in audits] == [
                {
                    "type": "form_submission",
                    "recipient_id": approval.recipient_id,
                    "end_user_id": approval.submitter_id,
                }
            ]


@pytest.mark.parametrize("note", ["  Unchanged  ", 123, False, None, {"detail": "approved"}, ["approved"]])
def test_preserves_paragraph_json_values_and_ignores_extra_input_fields(approval: Approval, note: JsonValue) -> None:
    inputs: dict[str, JsonValue] = {"note": note, "choice": "Yes", "extra": {"metadata": True}}
    response = approval.submit(inputs=inputs)
    assert response.status_code == 200, response.json
    assert approval.submission() == inputs
    if approval.version == "2":
        with approval.sessions() as session:
            form = SQLAlchemyFormRepository(session, TenantId(approval.tenant_id), approval.app_id).get_form_by_id(
                approval.form_id
            )
            assert form is not None
            assert form.submission is not None
            assert {
                name: segment.to_object() for name, segment in form.submission.normalized_submission_data.items()
            } == {
                "note": note,
                "choice": "Yes",
            }


@pytest.mark.parametrize(
    ("action", "inputs"),
    [
        ("unknown", _INPUTS),
        ("approve", {"note": "Approved"}),
        ("approve", {"note": "Approved", "choice": "unknown"}),
        ("approve", {"note": "Approved", "choice": 123}),
    ],
)
def test_invalid_form_data_does_not_submit_or_resume(
    approval: Approval, action: str, inputs: dict[str, JsonValue]
) -> None:
    response = approval.submit(inputs=inputs, action=action)
    assert response.status_code == 400, response.json
    assert response.json is not None
    assert response.json["code"] == "invalid_form_data"
    assert approval.submission() is None
    assert approval.published == []


def test_post_requires_user(approval: Approval) -> None:
    response = approval.client.post(_PATH, headers=_HEADERS, json={"action": "approve", "inputs": _INPUTS})
    assert response.status_code == 400
    assert approval.submission() is None


def test_post_ignores_additional_request_fields(approval: Approval) -> None:
    response = approval.client.post(
        _PATH,
        headers=_HEADERS,
        json={"user": "reviewer", "action": "approve", "inputs": _INPUTS, "metadata": {"client": "legacy-sdk"}},
    )
    assert response.status_code == 200, response.json
    assert response.json == {}


def test_accepted_submission_stays_successful_when_the_resume_broker_is_unavailable(
    approval: Approval,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def reject_enqueue(**_kwargs: object) -> NoReturn:
        raise OperationalError("Broker unavailable")

    monkeypatch.setattr(resume_app_execution, "apply_async", reject_enqueue)
    response = approval.submit(inputs=_INPUTS)
    assert response.status_code == 200, response.json
    assert response.json == {}
    assert approval.submission() == _INPUTS


def test_duplicate_submission_preserves_first_response_and_returns_412(approval: Approval) -> None:
    assert approval.submit(inputs=_INPUTS).status_code == 200
    response = approval.submit(inputs={"note": "Changed", "choice": "No"}, user="initiator")
    assert response.status_code == 412, response.json
    assert response.json is not None
    assert response.json["code"] == "human_input_form_submitted"
    assert approval.submission() == _INPUTS
    assert len(approval.published) == 1
    read = approval.client.get(_PATH, headers=_HEADERS)
    assert read.status_code == 412
    assert read.json is not None
    assert read.json["code"] == "human_input_form_submitted"


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_unknown_token_returns_not_found(approval: Approval, method: str) -> None:
    response = approval.client.open(
        "/v1/form/human_input/unknown",
        method=method,
        headers=_HEADERS,
        json={"user": "reviewer", "action": "approve", "inputs": _INPUTS},
    )
    assert response.status_code == 404
    assert response.json is not None
    assert response.json["code"] == "not_found"


@pytest.mark.parametrize("method", ["GET", "POST"])
@pytest.mark.parametrize("owner", ["tenant_id", "app_id"])
def test_rejects_forms_outside_the_authenticated_application(approval: Approval, method: str, owner: str) -> None:
    model = LegacyForm if approval.version == "1" else V2Form
    with approval.sessions.begin() as session:
        session.execute(sa.update(model).where(model.id == approval.form_id).values({owner: str(uuid4())}))
    response = approval.client.open(
        _PATH,
        method=method,
        headers=_HEADERS,
        json={"user": "reviewer", "action": "approve", "inputs": _INPUTS},
    )
    assert response.status_code == 404
    assert approval.submission() is None
    assert approval.published == []


@pytest.mark.parametrize("method", ["GET", "POST"])
@pytest.mark.parametrize("expiration", ["node", "global", "timeout", "expired"])
def test_expired_forms_return_412_without_submission(approval: Approval, method: str, expiration: str) -> None:
    model = LegacyForm if approval.version == "1" else V2Form
    with approval.sessions.begin() as session:
        updates: dict[str, object]
        match expiration:
            case "node":
                updates = {"expiration_time": _NOW}
            case "global":
                updates = (
                    {"created_at": _NOW - timedelta(days=365)}
                    if approval.version == "1"
                    else {"global_timeout_deadline": _NOW}
                )
            case "timeout":
                updates = {"status": HumanInputFormStatus.TIMEOUT}
            case _:
                updates = {"status": HumanInputFormStatus.EXPIRED}
        session.execute(sa.update(model).where(model.id == approval.form_id).values(updates))
    response = approval.client.open(
        _PATH,
        method=method,
        headers=_HEADERS,
        json={"user": "reviewer", "action": "approve", "inputs": _INPUTS},
    )
    assert response.status_code == 412, response.json
    assert response.json is not None
    assert response.json["code"] == "human_input_form_expired"
    assert approval.submission() is None
    assert approval.published == []


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_rejects_console_recipient_tokens(approval: Approval, method: str) -> None:
    with approval.sessions.begin() as session:
        if approval.version == "1":
            session.execute(
                sa.update(LegacyRecipient)
                .where(LegacyRecipient.id == approval.recipient_id)
                .values(
                    recipient_type=RecipientType.CONSOLE,
                    recipient_payload='{"TYPE":"console"}',
                )
            )
        else:
            session.execute(
                sa.update(V2Recipient)
                .where(V2Recipient.id == approval.recipient_id)
                .values(
                    subject_type=RecipientSubjectType.CONTACT,
                    subject_value=str(uuid4()),
                )
            )
    response = approval.client.open(
        _PATH,
        method=method,
        headers=_HEADERS,
        json={"user": "reviewer", "action": "approve", "inputs": _INPUTS},
    )
    assert response.status_code == 404
    assert approval.submission() is None
    assert approval.published == []


def test_submits_existing_upload_references_for_file_and_file_list_inputs(approval: Approval) -> None:
    upload = UploadFile(
        tenant_id=approval.tenant_id,
        storage_type=StorageType.LOCAL,
        key="approval/report.txt",
        name="report.txt",
        size=8,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.END_USER,
        created_by=approval.submitter_id,
        created_at=_NOW,
        used=False,
    )
    file_parts = (
        FileInput(
            output_variable_name="attachment",
            allowed_file_types=(FileType.DOCUMENT,),
            allowed_file_extensions=(".txt",),
            allowed_file_upload_methods=(FileTransferMethod.LOCAL_FILE,),
        ),
        FileListInput(
            output_variable_name="attachments",
            allowed_file_types=(FileType.DOCUMENT,),
            allowed_file_extensions=(".txt",),
            allowed_file_upload_methods=(FileTransferMethod.LOCAL_FILE,),
            number_limits=2,
        ),
    )
    with approval.sessions.begin() as session:
        session.add(upload)
        if approval.version == "1":
            legacy = session.get(LegacyForm, approval.form_id)
            assert legacy is not None
            definition = json.loads(legacy.form_definition)
            definition["inputs"].extend(
                [
                    {
                        "type": "file",
                        "output_variable_name": "attachment",
                        "allowed_file_types": ["document"],
                        "allowed_file_extensions": [".txt"],
                        "allowed_file_upload_methods": ["local_file"],
                    },
                    {
                        "type": "file-list",
                        "output_variable_name": "attachments",
                        "allowed_file_types": ["document"],
                        "allowed_file_extensions": [".txt"],
                        "allowed_file_upload_methods": ["local_file"],
                        "number_limits": 2,
                    },
                ]
            )
            legacy.form_definition = json.dumps(definition)
        else:
            form = session.get(V2Form, approval.form_id)
            assert form is not None
            form.resolved_form = form.resolved_form.model_copy(
                update={"parts": (*form.resolved_form.parts, *file_parts)}
            )
    mapping: dict[str, JsonValue] = {"transfer_method": "local_file", "upload_file_id": upload.id, "type": "document"}
    response = approval.submit(inputs={**_INPUTS, "attachment": mapping, "attachments": [mapping]})
    assert response.status_code == 200, response.json
    assert response.json == {}
    with approval.sessions() as session:
        if approval.version == "1":
            legacy = session.get(LegacyForm, approval.form_id)
            assert legacy is not None
            assert legacy.submitted_data is not None
            submitted = json.loads(legacy.submitted_data)
            assert submitted["attachment"]["related_id"] == upload.id
            assert submitted["attachments"][0]["related_id"] == upload.id
        else:
            form_snapshot = SQLAlchemyFormRepository(
                session, TenantId(approval.tenant_id), approval.app_id
            ).get_form_by_id(approval.form_id)
            assert form_snapshot is not None
            assert form_snapshot.submission is not None
            attachment = form_snapshot.submission.normalized_submission_data["attachment"]
            attachments = form_snapshot.submission.normalized_submission_data["attachments"]
            assert isinstance(attachment, FileSegment)
            assert attachment.value.related_id == upload.id
            assert isinstance(attachments, ArrayFileSegment)
            assert attachments.value[0].related_id == upload.id
    assert len(approval.published) == 1


@pytest.mark.parametrize("approval", ["2"], indirect=True)
@pytest.mark.parametrize("method", ["GET", "POST"])
@pytest.mark.parametrize("auth_type", [SubmissionAuthType.CONSOLE, SubmissionAuthType.EMAIL_OTP, SubmissionAuthType.IM])
def test_v2_rejects_tokens_from_other_authentication_surfaces(
    approval: Approval,
    method: str,
    auth_type: SubmissionAuthType,
) -> None:
    with approval.sessions.begin() as session:
        session.execute(
            sa.update(HumanInputDelivery)
            .where(HumanInputDelivery.form_id == approval.form_id)
            .values(
                auth_type=auth_type,
            )
        )
    response = approval.client.open(
        _PATH,
        method=method,
        headers=_HEADERS,
        json={"user": "reviewer", "action": "approve", "inputs": _INPUTS},
    )
    assert response.status_code == 404
    assert approval.submission() is None
    assert approval.published == []


@pytest.mark.parametrize("approval", ["2"], indirect=True)
@pytest.mark.parametrize("checkpoint", ["missing", "resumed", "run_not_paused"])
def test_v2_requires_an_active_paused_workflow_before_accepting_submission(approval: Approval, checkpoint: str) -> None:
    with approval.sessions.begin() as session:
        match checkpoint:
            case "missing":
                session.execute(sa.delete(WorkflowPause).where(WorkflowPause.workflow_run_id == approval.run_id))
            case "resumed":
                session.execute(
                    sa.update(WorkflowPause)
                    .where(WorkflowPause.workflow_run_id == approval.run_id)
                    .values(
                        resumed_at=_NOW,
                    )
                )
            case _:
                session.execute(
                    sa.update(WorkflowRun)
                    .where(WorkflowRun.id == approval.run_id)
                    .values(
                        status=WorkflowExecutionStatus.RUNNING,
                    )
                )
    response = approval.submit(inputs=_INPUTS)
    assert response.status_code == 400, response.json
    assert response.json is not None
    assert response.json["code"] == "bad_request"
    assert approval.submission() is None
    assert approval.published == []
    with approval.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputAuditEvent)) == 0


@pytest.mark.parametrize("approval", ["2"], indirect=True)
def test_concurrent_v2_submissions_accept_only_one_response(approval: Approval) -> None:
    ready = Barrier(2)

    def submit(note: str) -> int:
        ready.wait(timeout=10)
        with approval.client.application.test_client() as client:
            response = client.post(
                _PATH,
                headers=_HEADERS,
                json={"user": "reviewer", "action": "approve", "inputs": {"note": note, "choice": "Yes"}},
            )
        return response.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(submit, ["First", "Second"]))
    assert sorted(statuses) == [200, 412]
    assert len(approval.published) == 1
    with approval.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(HumanInputAuditEvent)) == 1
