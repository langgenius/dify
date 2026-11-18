"""Determine and send initial notifications for committed recipients.

The runtime invokes this after the form service commits first initialization,
and waits for the recorded result before deciding whether delivery succeeded.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from collections.abc import Callable, Mapping, Sequence
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
from core.human_input_v2.im_integration.adapters.message_locator import MessageLocator
from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
from core.human_input_v2.shared.values import ContactId, IMBindingId
from core.workflow.human_input_adapter import EmailDeliveryConfig
from core.workflow.nodes.human_input_v2.entities import Initiator
from core.workflow.nodes.human_input_v2.runtime import HumanInputDeliveryError
from extensions.ext_key_provider import key_provider_manager
from models.model import EndUser
from repositories.human_input_v2.contact import Contact, ContactType
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
from services.feature_service import FeatureService
from services.human_input_v2.email_client import EmailClient
from services.human_input_v2.im_credential_codec import IMCredentialCodec, IMCredentialError
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher

logger = logging.getLogger(__name__)
_CONSOLE_FORM_PAGE_PATH = "/human-input"
_PUBLIC_V2_FORM_PAGE_PATH = "/form-v2"
_LEGACY_FORM_PAGE_PATH = "/form"


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
    binding_id: IMBindingId
    user_id: ProviderUserId


type _DeliveryTarget = _InitiatorTarget | _EmailTarget | _IMTarget


@dataclass(frozen=True, slots=True)
class _RecipientContext:
    form: Form
    recipient: Recipient
    auth_type: SubmissionAuthType
    targets: tuple[_DeliveryTarget, ...]


class HumanInputDeliveryService:
    """Determine and send deliveries for a committed initialization round.

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
        return self.deliver_many(
            form=form,
            recipients=(recipient,),
            message_template=message_template,
            debug_channels=debug_channels,
        )[0]

    def deliver_many(
        self,
        *,
        form: Form,
        recipients: Sequence[Recipient],
        message_template: ResolvedMessageTemplate,
        debug_channels: tuple[DebugChannel, ...] | None = None,
    ) -> tuple[RecipientDeliveryResult, ...]:
        """Send a committed form's recipients using one round-scoped current view.

        Require every recipient to belong to the supplied tenant and form.
        Reload membership, visible Contacts, Channel, effective Bindings and
        Identities before any send; unavailable subjects yield empty results.
        Return one result per input in input order, preserving independent
        deliveries and attempts even for shared addresses or provider users.
        Empty input performs no I/O. Invalid membership raises
        HumanInputDeliveryError before sending.

        The prepared view is local to this call, never cached between rounds.
        It selects notification endpoints, not submission authority: submission
        owners still recheck current authorization. No read transaction or lock
        spans credential/provider I/O; each delivery and attempt keeps its own
        short write transaction, including when other sends fail.
        """
        contexts = self._load_contexts(form, recipients)
        return tuple(self._deliver_context(context, message_template, debug_channels) for context in contexts)

    def _deliver_context(
        self,
        context: _RecipientContext | None,
        message_template: ResolvedMessageTemplate,
        debug_channels: tuple[DebugChannel, ...] | None,
    ) -> RecipientDeliveryResult:
        """Send a detached context outside its read transaction and persist outcomes.

        An unavailable subject returns no attempts or initiator token. Provider
        failures retain recorded attempts without cancelling other targets.
        """
        if context is None:
            return RecipientDeliveryResult((), None)
        form = context.form
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

    def _load_contexts(self, form: Form, recipients: Sequence[Recipient]) -> tuple[_RecipientContext | None, ...]:
        """Reload owner-scoped facts and detach contexts before any external I/O.

        Inputs are committed form/recipient snapshots. Reject missing recipient
        membership, preserve input order and omit unavailable subject targets.
        Reads use one service-owned transaction with session-bound repositories;
        they do not lock state across sends or confer submission authority.
        """
        if not recipients:
            return ()
        with self._session_factory() as session, session.begin():
            current_recipients = {
                recipient.id: recipient
                for recipient in SQLAlchemyRecipientRepository(session, form.tenant_id, form.id).list_recipients()
            }
            if any(recipient.id not in current_recipients for recipient in recipients):
                raise HumanInputDeliveryError("Recipient does not belong to this form")
            recipients = tuple(current_recipients[recipient.id] for recipient in recipients)
            contact_ids = tuple(
                recipient.subject.contact_id
                for recipient in recipients
                if isinstance(recipient.subject, ContactRecipientSubject)
            )
            contacts = {
                contact.id: contact
                for contact in SQLAlchemyContactRepository(session).get_contacts_by_ids(form.tenant_id, contact_ids)
            }
            im_targets = self._load_im_targets(
                session,
                form,
                tuple(contact.id for contact in contacts.values() if contact.type != ContactType.EXTERNAL),
            )
            end_user_ids = tuple(
                recipient.subject.end_user_id
                for recipient in recipients
                if isinstance(recipient.subject, EndUserRecipientSubject)
            )
            available_end_users = (
                set(
                    session.scalars(
                        sa.select(EndUser.id).where(
                            EndUser.id.in_(end_user_ids),
                            EndUser.tenant_id == form.tenant_id,
                            EndUser.app_id == form.app_id,
                        )
                    )
                )
                if end_user_ids
                else set()
            )
            return tuple(
                self._resolve_context(form, recipient, contacts, im_targets, available_end_users)
                for recipient in recipients
            )

    @staticmethod
    def _load_im_targets(session: Session, form: Form, contact_ids: Sequence[ContactId]) -> dict[ContactId, _IMTarget]:
        """Read one owner Channel and batch its effective targets in the caller's transaction.

        Require visible internal Contacts. Disconnected/missing Channels and
        missing Bindings or Identities yield no IM target; no external I/O occurs.
        """
        if not contact_ids:
            return {}
        # TODO(QuantumGhost): maybe the channel creation logic below should be unified?
        channel = (
            DeploymentIMChannelReader(session).get()
            if FeatureService.is_im_centrally_managed()
            else WorkspaceIMChannelReader(session, form.tenant_id).get()
        )
        if channel is None or channel.status != IMChannelStatus.CONNECTED:
            return {}
        bindings = SQLAlchemyIMBindingRepository(session, channel.id).get_effective_many(form.tenant_id, contact_ids)
        identities = {
            identity.id: identity
            for identity in SQLAlchemyIMIdentityRepository(session, channel.id).get_many(
                tuple(binding.identity_id for binding in bindings)
            )
        }
        return {
            binding.contact_id: _IMTarget(
                channel, binding.id, ProviderUserId(identities[binding.identity_id].provider_user_id)
            )
            for binding in bindings
            if binding.identity_id in identities
        }

    @staticmethod
    def _resolve_context(
        form: Form,
        recipient: Recipient,
        contacts: Mapping[ContactId, Contact],
        im_targets: Mapping[ContactId, _IMTarget],
        available_end_users: set[str],
    ) -> _RecipientContext | None:
        """Choose notification targets and authentication from already scoped facts.

        Return None for unavailable subjects. This performs no I/O and does not
        re-resolve frozen recipient sources or grant submission authority.
        """
        email = None
        targets: list[_DeliveryTarget] = []
        auth_type = SubmissionAuthType.EMAIL_OTP
        match recipient.subject:
            case ContactRecipientSubject(contact_id):
                contact = contacts.get(contact_id)
                if contact is None:
                    logger.warning("Human Input contact unavailable: form_id=%s recipient_id=%s", form.id, recipient.id)
                    return None
                email = contact.email
                if contact.type != ContactType.EXTERNAL:
                    auth_type = SubmissionAuthType.CONSOLE
                    if any(isinstance(source, Initiator) for source in recipient.sources):
                        targets.append(_InitiatorTarget())
                    im_target = im_targets.get(contact_id)
                    if im_target is not None:
                        targets.append(im_target)
            case EmailRecipientSubject(address):
                email = address.value
            case EndUserRecipientSubject(end_user_id):
                if end_user_id not in available_end_users:
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

    def _record(
        self, delivery: Delivery, outcome: DeliveryAttemptCreateParams, *, message_locator: MessageLocator | None
    ) -> DeliveryAttempt:
        with self._session_factory() as session, session.begin():
            if message_locator is not None:
                updated = SQLAlchemyDeliveryRepository(session).set_im_message_locator(
                    tenant_id=delivery.tenant_id,
                    form_id=delivery.form_id,
                    delivery_id=delivery.id,
                    message_locator=message_locator,
                )
                if updated is None:
                    raise ValueError("The original delivery is missing while recording its message identity")
            # The accepted message identity and send outcome must commit together.
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
                if FeatureService.is_im_centrally_managed():
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
                im_binding_id=target.binding_id,
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
                    body = template.body.replace(
                        EmailDeliveryConfig.URL_PLACEHOLDER, build_form_request_url(token, auth_type)
                    )
                    result = adapter.messaging.send_text(user_id, body, subject=template.subject)
            except DynamicCardMessagingError:
                result = MessageSendingError("The provider could not send the assessed card")
            message_locator = None
            if isinstance(result, MessageAccepted):
                message_locator = result.locator
                outcome = DeliveryAttemptCreateParams(
                    DeliveryStatus.SUCCEEDED, None, {"accepted": True, "message_locator": str(result.locator)}
                )
            else:
                outcome = DeliveryAttemptCreateParams(
                    DeliveryStatus.FAILED, "IM provider did not confirm acceptance", {"accepted": False}
                )
            return self._record(delivery, outcome, message_locator=message_locator)
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
        body = template.body.replace(
            EmailDeliveryConfig.URL_PLACEHOLDER, build_form_request_url(token, context.auth_type)
        )
        html = EmailDeliveryConfig.render_markdown_body(body)
        try:
            client.send(to=target.email, subject=template.subject, html=html)
        except (EmailProviderOperationError, EmailProviderValidationError, SMTPException, OSError, httpx.RequestError):
            outcome = DeliveryAttemptCreateParams(
                DeliveryStatus.FAILED, "Email provider did not confirm acceptance", {"accepted": False}
            )
        else:
            outcome = DeliveryAttemptCreateParams(DeliveryStatus.SUCCEEDED, None, {"accepted": True})
        return self._record(delivery, outcome, message_locator=None)

    @staticmethod
    def _warn(context: _RecipientContext, reason: str) -> None:
        logger.warning(
            "Human Input channel skipped: tenant_id=%s form_id=%s recipient_id=%s reason=%s",
            context.form.tenant_id,
            context.form.id,
            context.recipient.id,
            reason,
        )


def build_form_request_url(token: SecretStr, auth_type: SubmissionAuthType) -> str:
    """Select the form entry point from its authentication contract."""
    if auth_type == SubmissionAuthType.CONSOLE:
        base_url = dify_config.CONSOLE_WEB_URL
        page_path = _CONSOLE_FORM_PAGE_PATH
        required_setting = "CONSOLE_WEB_URL"
    else:
        base_url = dify_config.APP_WEB_URL
        page_path = _PUBLIC_V2_FORM_PAGE_PATH if auth_type == SubmissionAuthType.EMAIL_OTP else _LEGACY_FORM_PAGE_PATH
        required_setting = "APP_WEB_URL"
    if not base_url:
        raise ValueError(f"{required_setting} is required for Human Input approval links")
    return f"{base_url.rstrip('/')}{page_path}/{quote(token.get_secret_value(), safe='')}"
