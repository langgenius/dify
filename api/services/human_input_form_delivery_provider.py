"""Providers for delivering human input forms through configured channels.

Dispatch has two explicit phases: load immutable DTOs while a SQLAlchemy session
is active, then perform provider I/O after the session context has closed.
Providers must not depend on live ORM instances because email and future IM
clients can block or retry independently from database transaction lifetimes.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.workflow.human_input_adapter import DeliveryMethodType, EmailDeliveryConfig, EmailDeliveryMethod
from extensions.ext_mail import mail
from graphon.runtime import VariablePool
from models.human_input import (
    EmailExternalRecipientPayload,
    EmailMemberRecipientPayload,
    HumanInputDelivery,
    HumanInputForm,
    HumanInputFormRecipient,
    InstantMessageRecipientPayload,
    RecipientPayload,
    RecipientType,
)

logger = logging.getLogger(__name__)

_RECIPIENT_PAYLOAD_ADAPTER = TypeAdapter(RecipientPayload)


@dataclass(frozen=True)
class HumanInputFormDeliveryRecipientContext:
    recipient_id: str
    recipient_type: RecipientType
    recipient_payload: str
    access_token: str | None


@dataclass(frozen=True)
class HumanInputFormDeliveryContext:
    form_id: str
    tenant_id: str
    app_id: str
    workflow_run_id: str | None
    rendered_content: str
    delivery_id: str
    delivery_method_type: DeliveryMethodType
    delivery_config_id: str | None
    channel_payload: str
    recipients: tuple[HumanInputFormDeliveryRecipientContext, ...]
    variable_pool: VariablePool | None = None


class HumanInputFormDeliveryProvider(Protocol):
    """Sends a persisted human input form through one delivery method."""

    delivery_method_type: DeliveryMethodType

    def send(self, *, context: HumanInputFormDeliveryContext) -> None: ...


class HumanInputFormMailClient(Protocol):
    def send(self, *, to: str, subject: str, html: str) -> None: ...


class HumanInputFormDeliveryProviderRegistry:
    _providers: dict[DeliveryMethodType, HumanInputFormDeliveryProvider]

    def __init__(self, providers: Sequence[HumanInputFormDeliveryProvider] | None = None) -> None:
        self._providers: dict[DeliveryMethodType, HumanInputFormDeliveryProvider] = {}
        for provider in providers or ():
            self.register(provider)

    def register(self, provider: HumanInputFormDeliveryProvider) -> None:
        self._providers[provider.delivery_method_type] = provider

    def dispatch(self, *, context: HumanInputFormDeliveryContext) -> bool:
        provider = self._providers.get(context.delivery_method_type)
        if provider is None:
            logger.warning(
                "No human input form delivery provider registered, form_id=%s, delivery_id=%s, method=%s",
                context.form_id,
                context.delivery_id,
                context.delivery_method_type,
            )
            return False

        provider.send(context=context)
        return True

    @classmethod
    def default(cls, *, mail_client: HumanInputFormMailClient = mail) -> HumanInputFormDeliveryProviderRegistry:
        return cls(
            [
                EmailHumanInputFormDeliveryProvider(mail_client=mail_client),
                UnsupportedInstantMessageHumanInputFormDeliveryProvider(),
            ]
        )


class HumanInputFormDeliveryDispatcher:
    _registry: HumanInputFormDeliveryProviderRegistry

    def __init__(self, registry: HumanInputFormDeliveryProviderRegistry | None = None) -> None:
        self._registry = registry or HumanInputFormDeliveryProviderRegistry.default()

    def load_form_contexts(
        self,
        *,
        session: Session,
        form: HumanInputForm,
        variable_pool: VariablePool | None = None,
        delivery_method_types: Sequence[DeliveryMethodType] | None = None,
    ) -> tuple[HumanInputFormDeliveryContext, ...]:
        stmt = select(HumanInputDelivery).where(HumanInputDelivery.form_id == form.id)
        if delivery_method_types:
            stmt = stmt.where(HumanInputDelivery.delivery_method_type.in_(delivery_method_types))

        deliveries = session.scalars(stmt).all()
        contexts: list[HumanInputFormDeliveryContext] = []
        for delivery in deliveries:
            recipients = session.scalars(
                select(HumanInputFormRecipient).where(HumanInputFormRecipient.delivery_id == delivery.id),
            ).all()
            contexts.append(
                _build_delivery_context(
                    form=form,
                    delivery=delivery,
                    recipients=recipients,
                    variable_pool=variable_pool,
                )
            )
        return tuple(contexts)

    def dispatch_contexts(self, contexts: Sequence[HumanInputFormDeliveryContext]) -> None:
        for context in contexts:
            self._registry.dispatch(context=context)


def _build_delivery_context(
    *,
    form: HumanInputForm,
    delivery: HumanInputDelivery,
    recipients: Sequence[HumanInputFormRecipient],
    variable_pool: VariablePool | None,
) -> HumanInputFormDeliveryContext:
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
        recipients=tuple(
            HumanInputFormDeliveryRecipientContext(
                recipient_id=recipient.id,
                recipient_type=recipient.recipient_type,
                recipient_payload=recipient.recipient_payload,
                access_token=recipient.access_token,
            )
            for recipient in recipients
        ),
        variable_pool=variable_pool,
    )


@dataclass(frozen=True)
class _EmailRecipient:
    email: str
    token: str


class EmailHumanInputFormDeliveryProvider:
    _mail: HumanInputFormMailClient

    delivery_method_type = DeliveryMethodType.EMAIL

    def __init__(self, *, mail_client: HumanInputFormMailClient = mail) -> None:
        self._mail = mail_client

    def send(self, *, context: HumanInputFormDeliveryContext) -> None:
        try:
            delivery_method = EmailDeliveryMethod.model_validate_json(context.channel_payload)
        except ValidationError:
            # Persisted payloads can be stale or manually corrupted; skip only this delivery.
            logger.warning(
                "Invalid human input email delivery payload, form_id=%s, delivery_id=%s",
                context.form_id,
                context.delivery_id,
                exc_info=True,
            )
            return

        recipients = self._resolve_recipients(context.recipients)
        if not recipients:
            return

        subject = EmailDeliveryConfig.sanitize_subject(delivery_method.config.subject)
        for recipient in recipients:
            form_link = _build_form_link(recipient.token)
            body = _render_body(
                delivery_method.config.body,
                form_link,
                variable_pool=context.variable_pool,
            )
            self._mail.send(
                to=recipient.email,
                subject=subject,
                html=body,
            )

    @staticmethod
    def _resolve_recipients(recipients: Sequence[HumanInputFormDeliveryRecipientContext]) -> list[_EmailRecipient]:
        resolved: list[_EmailRecipient] = []
        for recipient in recipients:
            payload = _parse_email_recipient_payload(recipient)
            if payload is None:
                continue
            token = recipient.access_token
            if not token:
                continue
            resolved.append(_EmailRecipient(email=payload.email, token=token))
        return resolved


class UnsupportedInstantMessageHumanInputFormDeliveryProvider:
    delivery_method_type = DeliveryMethodType.IM

    def send(self, *, context: HumanInputFormDeliveryContext) -> None:
        valid_recipients = 0
        for recipient in context.recipients:
            if _parse_instant_message_recipient_payload(recipient) is not None:
                valid_recipients += 1
        logger.warning(
            "Human input instant message delivery is not implemented, form_id=%s, delivery_id=%s, recipients=%s",
            context.form_id,
            context.delivery_id,
            valid_recipients,
        )


def _build_form_link(token: str) -> str:
    base_url = dify_config.APP_WEB_URL
    return f"{base_url.rstrip('/')}/form/{token}"


def _parse_email_recipient_payload(
    recipient: HumanInputFormDeliveryRecipientContext,
) -> EmailMemberRecipientPayload | EmailExternalRecipientPayload | None:
    try:
        payload = _RECIPIENT_PAYLOAD_ADAPTER.validate_json(recipient.recipient_payload)
    except ValidationError:
        # Recipient payloads are persisted per delivery; a bad row should not block other recipients.
        logger.warning(
            "Invalid human input recipient payload, recipient_id=%s",
            recipient.id,
            exc_info=True,
        )
        return None

    match payload:
        case EmailMemberRecipientPayload() | EmailExternalRecipientPayload():
            if payload.email:
                return payload
            return None
        case _:
            return None


def _parse_instant_message_recipient_payload(
    recipient: HumanInputFormDeliveryRecipientContext,
) -> InstantMessageRecipientPayload | None:
    try:
        payload = _RECIPIENT_PAYLOAD_ADAPTER.validate_json(recipient.recipient_payload)
    except ValidationError:
        logger.warning(
            "Invalid human input instant message recipient payload, recipient_id=%s",
            recipient.recipient_id,
            exc_info=True,
        )
        return None

    if isinstance(payload, InstantMessageRecipientPayload):
        return payload
    return None


def _render_body(
    body_template: str,
    form_link: str,
    *,
    variable_pool: VariablePool | None,
) -> str:
    body = EmailDeliveryConfig.render_body_template(
        body=body_template,
        url=form_link,
        variable_pool=variable_pool,
    )
    return EmailDeliveryConfig.render_markdown_body(body)
