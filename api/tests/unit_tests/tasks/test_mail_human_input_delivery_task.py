from collections.abc import Sequence
from types import SimpleNamespace

import pytest

from tasks import mail_human_input_delivery_task as task_module


class _DummyMail:
    def __init__(self):
        self.sent: list[dict[str, str]] = []
        self._inited = True

    def is_inited(self) -> bool:
        return self._inited

    def send(self, *, to: str, subject: str, html: str):
        self.sent.append({"to": to, "subject": subject, "html": html})


class _DummySession:
    def __init__(self, form):
        self._form = form

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        return False

    def get(self, _model, _form_id):
        return self._form


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


def test_dispatch_human_input_email_task_sends_to_each_recipient(monkeypatch: pytest.MonkeyPatch):
    mail = _DummyMail()
    form = SimpleNamespace(id="form-1", tenant_id="tenant-1", workflow_run_id=None)

    monkeypatch.setattr(task_module, "mail", mail)
    monkeypatch.setattr(
        task_module.FeatureService,
        "get_features",
        lambda _tenant_id: SimpleNamespace(human_input_email_delivery_enabled=True),
    )
    jobs: Sequence[task_module._EmailDeliveryJob] = [_build_job(recipient_count=2)]
    monkeypatch.setattr(task_module, "_load_email_jobs", lambda _session, _form: jobs)

    task_module.dispatch_human_input_email_task(
        form_id="form-1",
        node_title="Approve",
        session_factory=lambda: _DummySession(form),
    )

    assert len(mail.sent) == 2
    assert all(payload["subject"] == "Subject" for payload in mail.sent)
    assert all("Body for" in payload["html"] for payload in mail.sent)


def test_dispatch_human_input_email_task_skips_when_feature_disabled(monkeypatch: pytest.MonkeyPatch):
    mail = _DummyMail()
    form = SimpleNamespace(id="form-1", tenant_id="tenant-1", workflow_run_id=None)

    monkeypatch.setattr(task_module, "mail", mail)
    monkeypatch.setattr(
        task_module.FeatureService,
        "get_features",
        lambda _tenant_id: SimpleNamespace(human_input_email_delivery_enabled=False),
    )
    monkeypatch.setattr(task_module, "_load_email_jobs", lambda _session, _form: [])

    task_module.dispatch_human_input_email_task(
        form_id="form-1",
        node_title="Approve",
        session_factory=lambda: _DummySession(form),
    )

    assert mail.sent == []


def test_dispatch_human_input_email_task_replaces_body_variables(monkeypatch: pytest.MonkeyPatch):
    mail = _DummyMail()
    form = SimpleNamespace(id="form-1", tenant_id="tenant-1", workflow_run_id="run-1")
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
        lambda _tenant_id: SimpleNamespace(human_input_email_delivery_enabled=True),
    )
    monkeypatch.setattr(task_module, "_load_email_jobs", lambda _session, _form: [job])
    monkeypatch.setattr(task_module, "_load_variable_pool", lambda _workflow_run_id: variable_pool)

    task_module.dispatch_human_input_email_task(
        form_id="form-1",
        node_title="Approve",
        session_factory=lambda: _DummySession(form),
    )

    assert mail.sent[0]["html"] == "Body OK"
