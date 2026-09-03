from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from models.human_input import HumanInputForm
from tasks import mail_human_input_delivery_task as task_module


class _DummyMail:
    def __init__(self):
        self.sent: list[dict[str, str]] = []
        self._inited = True

    def is_inited(self) -> bool:
        return self._inited

    def send(self, *, to: str, subject: str, html: str):
        self.sent.append({"to": to, "subject": subject, "html": html})


def _form(*, workflow_run_id: str | None = None) -> HumanInputForm:
    return HumanInputForm(
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        workflow_run_id=workflow_run_id,
        conversation_id=None,
        node_id="human-input",
        form_definition="{}",
        rendered_content="content",
        expiration_time=datetime.now(UTC) + timedelta(hours=1),
    )


def _build_job(recipient_count: int = 1) -> task_module._EmailDeliveryJob:
    recipients: list[task_module._EmailRecipient] = []
    for idx in range(recipient_count):
        recipients.append(task_module._EmailRecipient(email=f"user{idx}@example.com", token=f"token-{idx}"))

    return task_module._EmailDeliveryJob(
        form_id="form-1",
        subject="Subject",
        body="Body for {{#url}}",
        form_content="content",
        recipients=recipients,
    )


@pytest.mark.parametrize("sqlite_session", [(HumanInputForm,)], indirect=True)
def test_dispatch_human_input_email_task_sends_to_each_recipient(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session: Session
):
    mail = _DummyMail()
    form = _form()
    sqlite_session.add(form)
    sqlite_session.commit()

    monkeypatch.setattr(task_module, "mail", mail)
    monkeypatch.setattr(
        task_module.FeatureService,
        "get_features",
        lambda _tenant_id, **_kwargs: SimpleNamespace(human_input_email_delivery_enabled=True),
    )
    jobs: Sequence[task_module._EmailDeliveryJob] = [_build_job(recipient_count=2)]
    monkeypatch.setattr(task_module, "_load_email_jobs", lambda _session, _form: jobs)

    task_module.dispatch_human_input_email_task(
        form_id=form.id,
        node_title="Approve",
        session_factory=sessionmaker(bind=sqlite_engine, expire_on_commit=False),
    )

    assert len(mail.sent) == 2
    assert all(payload["subject"] == "Subject" for payload in mail.sent)
    assert all("Body for" in payload["html"] for payload in mail.sent)


@pytest.mark.parametrize("sqlite_session", [(HumanInputForm,)], indirect=True)
def test_dispatch_human_input_email_task_skips_when_feature_disabled(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session: Session
):
    mail = _DummyMail()
    form = _form()
    sqlite_session.add(form)
    sqlite_session.commit()

    monkeypatch.setattr(task_module, "mail", mail)
    monkeypatch.setattr(
        task_module.FeatureService,
        "get_features",
        lambda _tenant_id, **_kwargs: SimpleNamespace(human_input_email_delivery_enabled=False),
    )
    monkeypatch.setattr(task_module, "_load_email_jobs", lambda _session, _form: [])

    task_module.dispatch_human_input_email_task(
        form_id=form.id,
        node_title="Approve",
        session_factory=sessionmaker(bind=sqlite_engine, expire_on_commit=False),
    )

    assert mail.sent == []


@pytest.mark.parametrize("sqlite_session", [(HumanInputForm,)], indirect=True)
def test_dispatch_human_input_email_task_replaces_body_variables(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session: Session
):
    mail = _DummyMail()
    form = _form(workflow_run_id=str(uuid4()))
    sqlite_session.add(form)
    sqlite_session.commit()
    job = task_module._EmailDeliveryJob(
        form_id="form-1",
        subject="Subject",
        body="Body {{#node1.value#}}",
        form_content="content",
        recipients=[task_module._EmailRecipient(email="user@example.com", token="token-1")],
    )

    variable_pool = task_module.VariablePool()
    variable_pool.add(["node1", "value"], "OK")

    monkeypatch.setattr(task_module, "mail", mail)
    monkeypatch.setattr(
        task_module.FeatureService,
        "get_features",
        lambda _tenant_id, **_kwargs: SimpleNamespace(human_input_email_delivery_enabled=True),
    )
    monkeypatch.setattr(task_module, "_load_email_jobs", lambda _session, _form: [job])
    monkeypatch.setattr(task_module, "_load_variable_pool", lambda _workflow_run_id: variable_pool)

    task_module.dispatch_human_input_email_task(
        form_id=form.id,
        node_title="Approve",
        session_factory=sessionmaker(bind=sqlite_engine, expire_on_commit=False),
    )

    assert mail.sent[0]["html"] == "<p>Body OK</p>"


@pytest.mark.parametrize("line_break", ["\r\n", "\r", "\n"])
@pytest.mark.parametrize("sqlite_session", [(HumanInputForm,)], indirect=True)
def test_dispatch_human_input_email_task_sanitizes_subject(
    monkeypatch: pytest.MonkeyPatch,
    line_break: str,
    sqlite_engine: Engine,
    sqlite_session: Session,
):
    mail = _DummyMail()
    form = _form()
    sqlite_session.add(form)
    sqlite_session.commit()
    job = task_module._EmailDeliveryJob(
        form_id="form-1",
        subject=f"Notice{line_break}BCC:attacker@example.com <b>Alert</b>",
        body="Body",
        form_content="content",
        recipients=[task_module._EmailRecipient(email="user@example.com", token="token-1")],
    )

    monkeypatch.setattr(task_module, "mail", mail)
    monkeypatch.setattr(
        task_module.FeatureService,
        "get_features",
        lambda _tenant_id, **_kwargs: SimpleNamespace(human_input_email_delivery_enabled=True),
    )
    monkeypatch.setattr(task_module, "_load_email_jobs", lambda _session, _form: [job])
    monkeypatch.setattr(task_module, "_load_variable_pool", lambda _workflow_run_id: None)

    task_module.dispatch_human_input_email_task(
        form_id=form.id,
        node_title="Approve",
        session_factory=sessionmaker(bind=sqlite_engine, expire_on_commit=False),
    )

    assert mail.sent[0]["subject"] == "Notice BCC:attacker@example.com Alert"
