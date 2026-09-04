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
    InstantMessageRecipientPayload,
    RecipientType,
    StandaloneWebAppRecipientPayload,
)
from services import human_input_form_delivery_provider as provider_module
from services.human_input_form_delivery_provider import (
    EmailHumanInputFormDeliveryProvider,
    HumanInputFormDeliveryContext,
    HumanInputFormDeliveryDispatcher,
    HumanInputFormDeliveryProviderRegistry,
    HumanInputFormDeliveryRecipientContext,
    UnsupportedInstantMessageHumanInputFormDeliveryProvider,
)


class _DummyMail:
    def __init__(self) -> None:
        self.sent: list[dict[str, str]] = []

    def send(self, *, to: str, subject: str, html: str) -> None:
        self.sent.append({"to": to, "subject": subject, "html": html})


class _DummyProvider:
    delivery_method_type: DeliveryMethodType

    def __init__(self, delivery_method_type: DeliveryMethodType = DeliveryMethodType.EMAIL) -> None:
        self.delivery_method_type = delivery_method_type
        self.contexts: list[HumanInputFormDeliveryContext] = []

    def send(self, *, context: HumanInputFormDeliveryContext) -> None:
        self.contexts.append(context)


class _FailingProvider:
    delivery_method_type: DeliveryMethodType

    def __init__(self, delivery_method_type: DeliveryMethodType = DeliveryMethodType.EMAIL) -> None:
        self.delivery_method_type = delivery_method_type

    def send(self, *, context: HumanInputFormDeliveryContext) -> None:
        del context
        raise TimeoutError("provider timed out")


class _ScalarResult:
    def __init__(self, values: list[object]) -> None:
        self._values = values

    def all(self) -> list[object]:
        return self._values


class _DummySession:
    def __init__(self, values: list[list[object]]) -> None:
        self._values = values
        self.statements: list[object] = []
        self.closed = False

    def __enter__(self) -> "_DummySession":
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        self.closed = True

    def scalars(self, statement: object) -> _ScalarResult:
        self.statements.append(statement)
        return _ScalarResult(self._values.pop(0))


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


def _make_recipient(
    *,
    payload: str,
    token: str | None = "token-1",
    recipient_type: RecipientType = RecipientType.EMAIL_EXTERNAL,
) -> HumanInputFormRecipient:
    recipient = HumanInputFormRecipient(
        form_id="form-1",
        delivery_id="delivery-email",
        recipient_type=recipient_type,
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


def _make_recipient_context(*, recipient: HumanInputFormRecipient) -> HumanInputFormDeliveryRecipientContext:
    return HumanInputFormDeliveryRecipientContext(
        recipient_id=recipient.id,
        recipient_type=recipient.recipient_type,
        recipient_payload=recipient.recipient_payload,
        access_token=recipient.access_token,
    )


def _make_context(
    *,
    form: HumanInputForm | None = None,
    delivery: HumanInputDelivery | None = None,
    recipients: list[HumanInputFormRecipient] | None = None,
    variable_pool: VariablePool | None = None,
) -> HumanInputFormDeliveryContext:
    form = form or _make_form()
    delivery = delivery or _make_delivery(method_type=DeliveryMethodType.EMAIL, payload=_make_email_payload())
    return HumanInputFormDeliveryContext(
        form_id=form.id,
        tenant_id=form.tenant_id,
        app_id=form.app_id,
        workflow_run_id=form.workflow_run_id,
        rendered_content=form.rendered_content,
        delivery_id=delivery.id,
        delivery_method_type=delivery.delivery_method_type,
        delivery_config_id=delivery.delivery_config_id,
        channel_payload=delivery.channel_payload,
        recipients=tuple(_make_recipient_context(recipient=recipient) for recipient in recipients or []),
        variable_pool=variable_pool,
    )


def test_registry_dispatches_by_delivery_method_type() -> None:
    provider = _DummyProvider()
    registry = HumanInputFormDeliveryProviderRegistry([provider])
    context = _make_context(delivery=_make_delivery(method_type=DeliveryMethodType.EMAIL))

    assert registry.dispatch(context=context) is True
    assert provider.contexts == [context]


def test_registry_skips_unsupported_delivery_method(caplog: pytest.LogCaptureFixture) -> None:
    registry = HumanInputFormDeliveryProviderRegistry()
    context = _make_context(delivery=_make_delivery(method_type=DeliveryMethodType.WEBAPP))

    with caplog.at_level("WARNING"):
        assert registry.dispatch(context=context) is False

    assert "No human input form delivery provider registered" in caplog.text


def test_dispatcher_continues_when_provider_fails(caplog: pytest.LogCaptureFixture) -> None:
    failing_provider = _FailingProvider(DeliveryMethodType.EMAIL)
    next_provider = _DummyProvider(DeliveryMethodType.IM)
    dispatcher = HumanInputFormDeliveryDispatcher(
        registry=HumanInputFormDeliveryProviderRegistry([failing_provider, next_provider])
    )
    email_context = _make_context(delivery=_make_delivery(method_type=DeliveryMethodType.EMAIL))
    im_context = _make_context(delivery=_make_delivery(method_type=DeliveryMethodType.IM))

    with caplog.at_level("ERROR"):
        dispatcher.dispatch_contexts((email_context, im_context))

    assert next_provider.contexts == [im_context]
    assert "Failed to dispatch human input form delivery" in caplog.text
    assert "form_id=form-1" in caplog.text
    assert f"delivery_id={email_context.delivery_id}" in caplog.text
    assert "method=email" in caplog.text


def test_dispatcher_loads_contexts_in_session_and_dispatches_after_session_exit() -> None:
    provider = _DummyProvider()
    dispatcher = HumanInputFormDeliveryDispatcher(registry=HumanInputFormDeliveryProviderRegistry([provider]))
    form = _make_form()
    delivery = _make_delivery(method_type=DeliveryMethodType.EMAIL)
    recipient = _make_recipient(
        payload=EmailExternalRecipientPayload(email="external@example.com").model_dump_json(),
    )
    variable_pool = VariablePool()
    session = _DummySession([[delivery], [recipient]])

    with session:
        contexts = dispatcher.load_form_contexts(
            session=session,
            form=form,
            variable_pool=variable_pool,
            delivery_method_types=(DeliveryMethodType.EMAIL,),
        )
        assert provider.contexts == []

    dispatcher.dispatch_contexts(contexts)

    assert len(session.statements) == 2
    assert len(provider.contexts) == 1
    context = provider.contexts[0]
    assert session.closed is True
    assert context.form_id == form.id
    assert context.delivery_id == delivery.id
    assert context.recipients == (_make_recipient_context(recipient=recipient),)
    assert context.variable_pool is variable_pool


def test_email_provider_renders_form_link_per_recipient(monkeypatch: pytest.MonkeyPatch) -> None:
    mail = _DummyMail()
    monkeypatch.setattr(provider_module.dify_config, "APP_WEB_URL", "https://app.example.com/")
    variable_pool = VariablePool()
    variable_pool.add(["node1", "value"], "OK")
    context = _make_context(
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
    context = _make_context(
        delivery=_make_delivery(method_type=DeliveryMethodType.EMAIL, payload=_make_email_payload()),
        recipients=[
            _make_recipient(payload=StandaloneWebAppRecipientPayload().model_dump_json(), token="web-token"),
        ],
    )

    EmailHumanInputFormDeliveryProvider(mail_client=mail).send(context=context)

    assert mail.sent == []


def test_email_provider_skips_invalid_recipient_payload_and_sends_valid_recipient(
    caplog: pytest.LogCaptureFixture,
) -> None:
    mail = _DummyMail()
    context = _make_context(
        delivery=_make_delivery(method_type=DeliveryMethodType.EMAIL, payload=_make_email_payload()),
        recipients=[
            _make_recipient(payload='{"TYPE":"email_external","email":123}', token="invalid-token"),
            _make_recipient(
                payload=EmailExternalRecipientPayload(email="external@example.com").model_dump_json(),
                token="external-token",
            ),
        ],
    )

    with caplog.at_level("WARNING"):
        EmailHumanInputFormDeliveryProvider(mail_client=mail).send(context=context)

    assert [message["to"] for message in mail.sent] == ["external@example.com"]
    assert "Invalid human input recipient payload, recipient_id=recipient-invalid-token" in caplog.text


def test_email_provider_skips_invalid_delivery_payload(caplog: pytest.LogCaptureFixture) -> None:
    mail = _DummyMail()
    context = _make_context(delivery=_make_delivery(method_type=DeliveryMethodType.EMAIL, payload='{"invalid": true}'))

    with caplog.at_level("WARNING"):
        EmailHumanInputFormDeliveryProvider(mail_client=mail).send(context=context)

    assert mail.sent == []
    assert "Invalid human input email delivery payload" in caplog.text


def test_instant_message_provider_safely_skips_without_network(caplog: pytest.LogCaptureFixture) -> None:
    context = _make_context(
        delivery=_make_delivery(
            method_type=DeliveryMethodType.IM, payload='{"type":"im","config":{"provider":"slack"}}'
        ),
        recipients=[
            _make_recipient(
                payload=InstantMessageRecipientPayload(
                    provider="slack",
                    recipient_kind="channel",
                    channel_id="C123",
                ).model_dump_json(),
                token="im-token",
                recipient_type=RecipientType.INSTANT_MESSAGE,
            )
        ],
    )

    with caplog.at_level("WARNING"):
        UnsupportedInstantMessageHumanInputFormDeliveryProvider().send(context=context)

    assert "Human input instant message delivery is not implemented" in caplog.text


def test_instant_message_provider_skips_invalid_delivery_payload(caplog: pytest.LogCaptureFixture) -> None:
    context = _make_context(
        delivery=_make_delivery(
            method_type=DeliveryMethodType.IM,
            payload='{"type":"im","config":{"provider":123}}',
        ),
    )

    with caplog.at_level("WARNING"):
        UnsupportedInstantMessageHumanInputFormDeliveryProvider().send(context=context)

    assert "Invalid human input instant message delivery payload" in caplog.text
    assert "Human input instant message delivery is not implemented" not in caplog.text
