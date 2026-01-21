from types import SimpleNamespace

import pytest

from core.workflow.nodes.human_input.entities import (
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    ExternalRecipient,
)
from core.workflow.runtime import VariablePool
from services import human_input_delivery_test_service as service_module
from services.human_input_delivery_test_service import (
    DeliveryTestContext,
    DeliveryTestError,
    EmailDeliveryTestHandler,
)


def _make_email_method() -> EmailDeliveryMethod:
    return EmailDeliveryMethod(
        config=EmailDeliveryConfig(
            recipients=EmailRecipients(
                whole_workspace=False,
                items=[ExternalRecipient(email="tester@example.com")],
            ),
            subject="Test subject",
            body="Test body",
        )
    )


def test_email_delivery_test_handler_rejects_when_feature_disabled(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        service_module.FeatureService,
        "get_features",
        lambda _tenant_id: SimpleNamespace(human_input_email_delivery_enabled=False),
    )

    handler = EmailDeliveryTestHandler(session_factory=object())
    context = DeliveryTestContext(
        tenant_id="tenant-1",
        app_id="app-1",
        node_id="node-1",
        node_title="Human Input",
        rendered_content="content",
    )
    method = _make_email_method()

    with pytest.raises(DeliveryTestError, match="Email delivery is not available"):
        handler.send_test(context=context, method=method)


def test_email_delivery_test_handler_replaces_body_variables(monkeypatch: pytest.MonkeyPatch):
    class DummyMail:
        def __init__(self):
            self.sent: list[dict[str, str]] = []

        def is_inited(self) -> bool:
            return True

        def send(self, *, to: str, subject: str, html: str):
            self.sent.append({"to": to, "subject": subject, "html": html})

    mail = DummyMail()
    monkeypatch.setattr(service_module, "mail", mail)
    monkeypatch.setattr(service_module, "render_email_template", lambda template, _substitutions: template)
    monkeypatch.setattr(
        service_module.FeatureService,
        "get_features",
        lambda _tenant_id: SimpleNamespace(human_input_email_delivery_enabled=True),
    )

    handler = EmailDeliveryTestHandler(session_factory=object())
    handler._resolve_recipients = lambda **_kwargs: ["tester@example.com"]  # type: ignore[assignment]

    method = EmailDeliveryMethod(
        config=EmailDeliveryConfig(
            recipients=EmailRecipients(whole_workspace=False, items=[ExternalRecipient(email="tester@example.com")]),
            subject="Subject",
            body="Value {{#node1.value#}}",
        )
    )
    variable_pool = VariablePool()
    variable_pool.add(["node1", "value"], "OK")
    context = DeliveryTestContext(
        tenant_id="tenant-1",
        app_id="app-1",
        node_id="node-1",
        node_title="Human Input",
        rendered_content="content",
        variable_pool=variable_pool,
    )

    handler.send_test(context=context, method=method)

    assert mail.sent[0]["html"] == "Value OK"
