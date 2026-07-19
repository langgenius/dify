from datetime import UTC, datetime

import pytest

from core.workflow.human_input_adapter import (
    DeliveryMethodType,
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
)
from graphon.runtime import VariablePool
from models.human_input import (
    EmailExternalRecipientPayload,
    EmailMemberRecipientPayload,
    HumanInputDelivery,
    HumanInputForm,
    HumanInputFormRecipient,
    RecipientType,
    StandaloneWebAppRecipientPayload,
)
from services import human_input_form_delivery_provider as provider_module
from services.human_input_form_delivery_provider import (
    EmailHumanInputFormDeliveryProvider,
    HumanInputFormDeliveryContext,
    HumanInputFormDeliveryProviderRegistry,
)


class _DummyMail:
    def __init__(self) -> None:
        self.sent: list[dict[str, str]] = []

    def send(self, *, to: str, subject: str, html: str) -> None:
        self.sent.append({"to": to, "subject": subject, "html": html})


class _DummyProvider:
    delivery_method_type = DeliveryMethodType.EMAIL

    def __init__(self) -> None:
        self.contexts: list[HumanInputFormDeliveryContext] = []

    def send(self, *, context: HumanInputFormDeliveryContext) -> None:
        self.contexts.append(context)


def _make_form() -> HumanInputForm:
    form = HumanInputForm(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        conversation_id=None,
        node_id="node-1",
        form_definition="{}",
        rendered_content="Rendered",
        expiration_time=datetime.now(UTC),
    )
    form.id = "form-1"
    return form


def _make_delivery(*, method_type: DeliveryMethodType, payload: str = "{}") -> HumanInputDelivery:
    delivery = HumanInputDelivery(
        form_id="form-1",
        delivery_method_type=method_type,
        delivery_config_id=None,
        channel_payload=payload,
    )
    delivery.id = f"delivery-{method_type}"
    return delivery


def _make_recipient(*, payload: str, token: str | None = "token-1") -> HumanInputFormRecipient:
    recipient = HumanInputFormRecipient(
        form_id="form-1",
        delivery_id="delivery-email",
        recipient_type=RecipientType.EMAIL_EXTERNAL,
        recipient_payload=payload,
        access_token=token,
    )
    recipient.id = f"recipient-{token or 'missing'}"
    return recipient


def _make_email_payload(*, subject: str = "Subject", body: str = "Body {{#url#}}") -> str:
    method = EmailDeliveryMethod(
        config=EmailDeliveryConfig(
            recipients=EmailRecipients(include_bound_group=False, items=[]),
            subject=subject,
            body=body,
        )
    )
    return method.model_dump_json()


def test_registry_dispatches_by_delivery_method_type() -> None:
    provider = _DummyProvider()
    registry = HumanInputFormDeliveryProviderRegistry([provider])
    context = HumanInputFormDeliveryContext(
        form=_make_form(),
        delivery=_make_delivery(method_type=DeliveryMethodType.EMAIL),
        recipients=[],
    )

    assert registry.dispatch(context=context) is True
    assert provider.contexts == [context]


def test_registry_skips_unsupported_delivery_method(caplog: pytest.LogCaptureFixture) -> None:
    registry = HumanInputFormDeliveryProviderRegistry()
    context = HumanInputFormDeliveryContext(
        form=_make_form(),
        delivery=_make_delivery(method_type=DeliveryMethodType.WEBAPP),
        recipients=[],
    )

    with caplog.at_level("WARNING"):
        assert registry.dispatch(context=context) is False

    assert "No human input form delivery provider registered" in caplog.text


def test_email_provider_renders_form_link_per_recipient(monkeypatch: pytest.MonkeyPatch) -> None:
    mail = _DummyMail()
    monkeypatch.setattr(provider_module.dify_config, "APP_WEB_URL", "https://app.example.com/")
    variable_pool = VariablePool()
    variable_pool.add(["node1", "value"], "OK")
    context = HumanInputFormDeliveryContext(
        form=_make_form(),
        delivery=_make_delivery(
            method_type=DeliveryMethodType.EMAIL,
            payload=_make_email_payload(
                subject="Notice\r\nBCC:attacker@example.com <b>Alert</b>",
                body="Link {{#url#}} value {{#node1.value#}}",
            ),
        ),
        recipients=[
            _make_recipient(
                payload=EmailMemberRecipientPayload(user_id="user-1", email="member@example.com").model_dump_json(),
                token="member-token",
            ),
            _make_recipient(
                payload=EmailExternalRecipientPayload(email="external@example.com").model_dump_json(),
                token="external-token",
            ),
        ],
        variable_pool=variable_pool,
    )

    EmailHumanInputFormDeliveryProvider(mail_client=mail).send(context=context)

    assert [message["to"] for message in mail.sent] == ["member@example.com", "external@example.com"]
    assert all(message["subject"] == "Notice BCC:attacker@example.com Alert" for message in mail.sent)
    assert "https://app.example.com/form/member-token" in mail.sent[0]["html"]
    assert "https://app.example.com/form/external-token" in mail.sent[1]["html"]
    assert all("value OK" in message["html"] for message in mail.sent)


def test_email_provider_ignores_non_email_recipients() -> None:
    mail = _DummyMail()
    context = HumanInputFormDeliveryContext(
        form=_make_form(),
        delivery=_make_delivery(method_type=DeliveryMethodType.EMAIL, payload=_make_email_payload()),
        recipients=[
            _make_recipient(payload=StandaloneWebAppRecipientPayload().model_dump_json(), token="web-token"),
        ],
    )

    EmailHumanInputFormDeliveryProvider(mail_client=mail).send(context=context)

    assert mail.sent == []


def test_email_provider_skips_invalid_delivery_payload(caplog: pytest.LogCaptureFixture) -> None:
    mail = _DummyMail()
    context = HumanInputFormDeliveryContext(
        form=_make_form(),
        delivery=_make_delivery(method_type=DeliveryMethodType.EMAIL, payload='{"invalid": true}'),
        recipients=[],
    )

    with caplog.at_level("WARNING"):
        EmailHumanInputFormDeliveryProvider(mail_client=mail).send(context=context)

    assert mail.sent == []
    assert "Invalid human input email delivery payload" in caplog.text
