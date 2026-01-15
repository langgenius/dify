from types import SimpleNamespace

import pytest

from core.workflow.nodes.human_input.entities import (
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    ExternalRecipient,
)
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
