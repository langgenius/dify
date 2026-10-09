"""Determine and send initial notifications for one committed recipient.

The runtime invokes this after the form service commits first initialization,
and waits for the recorded result before deciding whether delivery succeeded.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from collections.abc import Callable
from dataclasses import dataclass, field
from smtplib import SMTPException
from typing import assert_never
from urllib.parse import quote

import httpx
import sqlalchemy as sa
from pydantic import SecretStr, ValidationError
from sqlalchemy.orm import Session

from configs import dify_config
from core.helper import encrypter
from core.human_input_v2.entities import DebugChannel
from core.human_input_v2.im_integration.adapters import factory as im_adapter_factory_module
from core.human_input_v2.im_integration.adapters.entities import (
    CorrelationToken,
    DynamicCardMessagingError,
    MessageAccepted,
    MessageSendingError,
    ProviderUserId,
)
from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
from core.workflow.human_input_adapter import EmailDeliveryConfig
from core.workflow.nodes.human_input_v2.entities import Initiator
from enums import DeploymentEdition
from extensions.ext_key_provider import key_provider_manager
from models.model import EndUser
from repositories.human_input_v2.contact import ContactType
from repositories.human_input_v2.delivery_attempt_repository import (
    DeliveryAttempt,
    DeliveryAttemptCreateParams,
    DeliveryStatus,
)
from repositories.human_input_v2.delivery_repository import (
    Delivery,
    DeliveryCreateParams,
    EmailTargetSnapshot,
    IMMessageType,
    IMUserTargetSnapshot,
    InitiatorSnapshot,
    SubmissionAuthType,
    TargetSnapshot,
)
from repositories.human_input_v2.email_channel.ports import EmailProviderOperationError, EmailProviderValidationError
from repositories.human_input_v2.form_repository import Form
from repositories.human_input_v2.im_channel_repository import IMChannel, IMChannelStatus
from repositories.human_input_v2.recipient_repository import (
    ContactRecipientSubject,
    EmailRecipientSubject,
    EndUserRecipientSubject,
    Recipient,
)
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from repositories.human_input_v2.sqlalchemy_delivery_attempt_repository import SQLAlchemyDeliveryAttemptRepository
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import (
    DeploymentIMChannelReader,
    WorkspaceIMChannelReader,
)
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository
from repositories.human_input_v2.sqlalchemy_recipient_repository import SQLAlchemyRecipientRepository
from services.human_input_v2.email_client import EmailClient
from services.human_input_v2.im_credential_codec import IMCredentialCodec, IMCredentialError
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ResolvedMessageTemplate:
    """Notification text resolved for the initial delivery round.

    The body retains the single Request URL slot for the delivery-specific URL.
    Actual approval content and actions come from Form.resolved_form instead.
    """

    subject: str = field(repr=False)
    body: str = field(repr=False)


@dataclass(frozen=True, slots=True)
class RecipientDeliveryResult:
    """Results for one recipient, including its usable initiator entry if any.

    attempts contains only actual sends; skipped channels do not fabricate
    successful attempts. form_token is present only for a usable Current
    Initiator interaction surface, never for an Email or IM notification.
    """

    attempts: tuple[DeliveryAttempt, ...]
    form_token: SecretStr | None = field(repr=False)


@dataclass(frozen=True, slots=True)
class _InitiatorTarget:
    pass


@dataclass(frozen=True, slots=True)
class _EmailTarget:
    email: str


@dataclass(frozen=True, slots=True)
class _IMTarget:
    channel: IMChannel
    user_id: ProviderUserId


type _DeliveryTarget = _InitiatorTarget | _EmailTarget | _IMTarget


@dataclass(frozen=True, slots=True)
class _RecipientContext:
    form: Form
    recipient: Recipient
    auth_type: SubmissionAuthType
    targets: tuple[_DeliveryTarget, ...]


class HumanInputDeliveryService:
    """Determine and send deliveries for one persisted recipient.

    Accept only detached, committed inputs. Provider I/O runs without an open
    database transaction; creating deliveries and recording attempts use this
    service's own short transactions.
    No caller-owned Session or transaction participates in this operation.
    """

    def __init__(
        self,
        *,
        session_factory: Callable[[], Session],
        email_client: EmailClient | None,
        im_adapter_factory: Callable[[IMChannel], IMProviderAdapter] | None = None,
    ) -> None:
        """Use a tenant-bound email client; None means no email channel is available.

        An EE owner may also supply its credential-bound IM adapter factory.
        """
        self._session_factory = session_factory
        self._email_client = email_client
        self._im_adapter_factory = im_adapter_factory

    def deliver(
        self,
        *,
        form: Form,
        recipient: Recipient,
        message_template: ResolvedMessageTemplate,
        debug_channels: tuple[DebugChannel, ...] | None = None,
    ) -> RecipientDeliveryResult:
        """Commit chosen deliveries before sending, and record each actual result.

        During form initialization, recipient configurations that resolve to the
        same subject produce one recipient within that form. Deliver to distinct
        recipients separately, even when they share a delivery address.
        SubmissionAuthType governs authentication;
        message_type records the IM presentation chosen by capability assessment.
        A provider error records failure; it never silently changes card to link.
        Form and workflow state do not cancel delivery. Submission eligibility
        and card state synchronization belong to their respective owners.
        """
        context = self._load_context(form, recipient)
        if context is None:
            return RecipientDeliveryResult((), None)
        initiator_form_token = None
        if debug_channels is None and any(isinstance(target, _InitiatorTarget) for target in context.targets):
            token = SecretStr(secrets.token_urlsafe(32))
            ciphertext = encrypter.encrypt_token(str(form.tenant_id), token.get_secret_value())
            self._prepare_delivery(
                context, InitiatorSnapshot(protected_form_token=ciphertext), context.auth_type, token
            )
            initiator_form_token = token

        attempts: list[DeliveryAttempt] = []
        for target in context.targets:
            match target:
                case _InitiatorTarget():
                    continue
                case _IMTarget():
                    if debug_channels is not None and not any(
                        value.value == target.channel.provider.value for value in debug_channels
                    ):
                        continue
                    attempt = self._deliver_im(context, target, message_template)
                case _EmailTarget():
                    if debug_channels is not None and DebugChannel.EMAIL not in debug_channels:
                        continue
                    attempt = self._deliver_email(context, target, message_template)
                case _:
                    assert_never(target)
            if attempt is not None:
                attempts.append(attempt)
        if not attempts and initiator_form_token is None:
            self._warn(context, "recipient_no_available_channel")
        return RecipientDeliveryResult(tuple(attempts), initiator_form_token)

    def _load_context(self, form: Form, recipient: Recipient) -> _RecipientContext | None:
        with self._session_factory() as session, session.begin():
            recipient_record = SQLAlchemyRecipientRepository(session, form.tenant_id, form.id).get_recipient(
                recipient.id
            )
            if recipient_record is None:
                raise ValueError("Recipient does not belong to this form")
            recipient = recipient_record
            email = None
            targets: list[_DeliveryTarget] = []
            auth_type = SubmissionAuthType.EMAIL_OTP
            match recipient.subject:
                case ContactRecipientSubject(contact_id):
                    contact = SQLAlchemyContactRepository(session).get_contacts_by_id(form.tenant_id, contact_id)
                    if contact is None:
                        logger.warning(
                            "Human Input contact unavailable: form_id=%s recipient_id=%s", form.id, recipient.id
                        )
                        return None
                    email = contact.email
                    if contact.type != ContactType.EXTERNAL:
                        auth_type = SubmissionAuthType.CONSOLE
                        if any(isinstance(source, Initiator) for source in recipient.sources):
                            targets.append(_InitiatorTarget())
                        # TODO(QuantumGhost): maybe the channel creation logic below should be unified?
                        channel = (
                            DeploymentIMChannelReader(session).get()
                            if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE
                            else WorkspaceIMChannelReader(session, form.tenant_id).get()
                        )
                        if channel is not None and channel.status == IMChannelStatus.CONNECTED:
                            binding = SQLAlchemyIMBindingRepository(session, channel.id).get_effective(
                                form.tenant_id, contact.id
                            )
                            identity = (
                                SQLAlchemyIMIdentityRepository(session, channel.id).get(binding.identity_id)
                                if binding is not None
                                else None
                            )
                            if identity is not None:
                                targets.append(_IMTarget(channel, ProviderUserId(identity.provider_user_id)))
                case EmailRecipientSubject(address):
                    email = address.value
                case EndUserRecipientSubject(end_user_id):
                    end_user = session.scalar(
                        sa.select(EndUser).where(
                            EndUser.id == end_user_id,
                            EndUser.tenant_id == form.tenant_id,
                            EndUser.app_id == form.app_id,
                        )
                    )
                    if end_user is None:
                        return None
                    if any(isinstance(source, Initiator) for source in recipient.sources):
                        targets.append(_InitiatorTarget())
                    auth_type = SubmissionAuthType.WEB_APP
                case _:
                    assert_never(recipient.subject)
            if email:
                targets.append(_EmailTarget(email))
            return _RecipientContext(form, recipient, auth_type, tuple(targets))

    def _prepare_delivery(
        self,
        context: _RecipientContext,
        target: TargetSnapshot,
        auth_type: SubmissionAuthType,
        token: SecretStr,
    ) -> Delivery:
        with self._session_factory() as session, session.begin():
            form = context.form
            delivery = SQLAlchemyDeliveryRepository(session).create_delivery(
                tenant_id=form.tenant_id,
                form_id=form.id,
                params=DeliveryCreateParams(
                    recipient_id=context.recipient.id,
                    token_hash=hashlib.sha256(token.get_secret_value().encode()).hexdigest(),
                    auth_type=auth_type,
                    target_snapshot=target,
                ),
            )
        return delivery

    def _record(self, delivery: Delivery, outcome: DeliveryAttemptCreateParams) -> DeliveryAttempt:
        with self._session_factory() as session, session.begin():
            attempt = SQLAlchemyDeliveryAttemptRepository(session, delivery.tenant_id, delivery.form_id).record_attempt(
                delivery.id, outcome
            )
            if attempt is None:
                raise ValueError("The original delivery is missing while recording its result")
        return attempt

    def _deliver_im(
        self, context: _RecipientContext, target: _IMTarget, template: ResolvedMessageTemplate
    ) -> DeliveryAttempt | None:
        channel = target.channel
        user_id = target.user_id
        try:
            if self._im_adapter_factory is not None:
                adapter = self._im_adapter_factory(channel)
            else:
                if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE:
                    # TODO(QuantumGhost): Dify EE Adapter creation.
                    raise IMCredentialError("The deployment's credential-bound adapter factory is required")
                cipher = TenantBoundCredentialCipher(key_provider_manager.provider, str(context.form.tenant_id))
                credentials = IMCredentialCodec(cipher).load(channel.provider, channel.encrypted_credentials)
                adapter = im_adapter_factory_module.build_im_provider_adapter(credentials)
        except IMCredentialError:
            self._warn(context, "im_credentials_unavailable")
            return None
        try:
            card = adapter.dynamic_card_messaging
            message_type = (
                IMMessageType.CARD
                if card is not None and card.assess(context.form.resolved_form).representable
                else IMMessageType.LINK
            )
            auth_type = SubmissionAuthType.IM if message_type == IMMessageType.CARD else context.auth_type
            token = SecretStr(secrets.token_urlsafe(32))
            snapshot = IMUserTargetSnapshot(
                im_provider=channel.provider,
                im_tenant_id=channel.provider_tenant_id,
                im_provider_user_id=user_id,
                message_type=message_type,
            )
            delivery = self._prepare_delivery(context, snapshot, auth_type, token)
            try:
                if message_type == IMMessageType.CARD:
                    assert card is not None
                    result = card.send_card(
                        user_id, context.form.resolved_form, CorrelationToken(token.get_secret_value())
                    )
                else:
                    body = template.body.replace(EmailDeliveryConfig.URL_PLACEHOLDER, self._request_url(token))
                    result = adapter.messaging.send_text(user_id, f"{template.subject}\n\n{body}")
            except DynamicCardMessagingError:
                result = MessageSendingError("The provider could not send the assessed card")
            if isinstance(result, MessageAccepted):
                outcome = DeliveryAttemptCreateParams(
                    DeliveryStatus.SUCCEEDED, None, {"accepted": True, "message_locator": str(result.locator)}
                )
            else:
                outcome = DeliveryAttemptCreateParams(
                    DeliveryStatus.FAILED, "IM provider did not confirm acceptance", {"accepted": False}
                )
            return self._record(delivery, outcome)
        finally:
            adapter.close()

    def _deliver_email(
        self, context: _RecipientContext, target: _EmailTarget, template: ResolvedMessageTemplate
    ) -> DeliveryAttempt | None:
        client = self._email_client
        if client is None:
            self._warn(context, "email_channel_unavailable")
            return None
        try:
            snapshot = EmailTargetSnapshot(email_address=target.email)
        except ValidationError:
            self._warn(context, "invalid_email")
            return None
        token = SecretStr(secrets.token_urlsafe(32))
        delivery = self._prepare_delivery(context, snapshot, context.auth_type, token)
        body = template.body.replace(EmailDeliveryConfig.URL_PLACEHOLDER, self._request_url(token))
        html = EmailDeliveryConfig.render_markdown_body(body)
        try:
            client.send(to=target.email, subject=template.subject, html=html)
        except (EmailProviderOperationError, EmailProviderValidationError, SMTPException, OSError, httpx.RequestError):
            outcome = DeliveryAttemptCreateParams(
                DeliveryStatus.FAILED, "Email provider did not confirm acceptance", {"accepted": False}
            )
        else:
            outcome = DeliveryAttemptCreateParams(DeliveryStatus.SUCCEEDED, None, {"accepted": True})
        return self._record(delivery, outcome)

    @staticmethod
    def _request_url(token: SecretStr) -> str:
        base_url = dify_config.APP_WEB_URL
        if not base_url:
            raise ValueError("APP_WEB_URL is required for Human Input approval links")
        return f"{base_url.rstrip('/')}/form/{quote(token.get_secret_value(), safe='')}"

    @staticmethod
    def _warn(context: _RecipientContext, reason: str) -> None:
        logger.warning(
            "Human Input channel skipped: tenant_id=%s form_id=%s recipient_id=%s reason=%s",
            context.form.tenant_id,
            context.form.id,
            context.recipient.id,
            reason,
        )
