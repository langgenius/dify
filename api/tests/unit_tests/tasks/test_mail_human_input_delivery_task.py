import types
from collections.abc import Sequence

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
    def __enter__(self):
        return None

    def __exit__(self, exc_type, exc_val, exc_tb):
        return False


def _build_job(recipient_count: int = 1) -> task_module._EmailDeliveryJob:
    recipients: list[task_module._EmailRecipient] = []
    for idx in range(recipient_count):
        recipients.append(task_module._EmailRecipient(email=f"user{idx}@example.com", token=f"token-{idx}"))

    return task_module._EmailDeliveryJob(
        form_id="form-1",
        workflow_run_id="run-1",
        subject="Subject for {{ form_token }}",
        body="Body for {{ form_link }}",
        form_content="content",
        recipients=recipients,
    )


def test_dispatch_human_input_email_task_sends_to_each_recipient(monkeypatch: pytest.MonkeyPatch):
    mail = _DummyMail()

    def fake_render(template: str, substitutions: dict[str, str]) -> str:
        return template.replace("{{ form_token }}", substitutions["form_token"]).replace(
            "{{ form_link }}", substitutions["form_link"]
        )

    monkeypatch.setattr(task_module, "mail", mail)
    monkeypatch.setattr(task_module, "render_email_template", fake_render)
    jobs: Sequence[task_module._EmailDeliveryJob] = [_build_job(recipient_count=2)]
    monkeypatch.setattr(task_module, "_load_email_jobs", lambda _session, _form_id: jobs)

    task_module.dispatch_human_input_email_task(
        form_id="form-1",
        node_title="Approve",
        session_factory=lambda: _DummySession(),
    )

    assert len(mail.sent) == 2
    assert all(payload["subject"].startswith("Subject for token-") for payload in mail.sent)
    assert all("Body for" in payload["html"] for payload in mail.sent)
