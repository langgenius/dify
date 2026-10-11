"""Compose authenticated IM intake and durable card approval processing."""

import logging
from datetime import UTC, datetime
from traceback import extract_tb

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from core.db.session_factory import session_factory
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.entities import (
    IMCardEventDecodingError,
    UnrecognizedIMEvent,
    WebhookRequest,
    WebhookResponse,
)
from core.human_input_v2.im_integration.adapters.factory import build_im_provider_adapter
from core.human_input_v2.im_integration.adapters.protocols import IMCardEventDecoder
from core.human_input_v2.im_message_inbox.contracts import IMInboxRecord
from core.human_input_v2.shared import IntegrationId, WorkspaceScope
from dify_app import DifyApp
from extensions.ext_key_provider import key_provider_manager
from libs.key_providers.base import BaseKeyProvider
from repositories.human_input_v2.im_channel_repository import IMChannelId, WebhookId
from repositories.human_input_v2.sqlalchemy_im_channel_repository import SQLAlchemyIMWebhookChannelRepository
from services.human_input_v2.im_credential_codec import IMCredentialCodec, IMCredentialError
from services.human_input_v2.im_message_inbox.processor import IMInboxProcessor
from services.human_input_v2.im_message_inbox.sink import IMMessageInboxSink
from services.human_input_v2.im_message_inbox.storage import IMInboxStorage
from services.human_input_v2.im_message_inbox.telemetry import OpenTelemetryIMInboxMetrics
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher
from services.human_input_v2.submission_service import (
    HumanInputFormError,
    HumanInputFormErrorCode,
    HumanInputSubmissionService,
    IMFormActor,
)
from tasks.im_message_inbox_tasks import configure_im_inbox_task_runtime

logger = logging.getLogger(__name__)


class IMWebhookIngressService:
    """Resolve current routing before recovering Provider credentials."""

    def __init__(self, *, sessions: sessionmaker[Session], key_provider: BaseKeyProvider) -> None:
        self._sessions = sessions
        self._key_provider = key_provider

    def handle(self, webhook_id: WebhookId, request: WebhookRequest) -> WebhookResponse:
        try:
            with self._sessions() as session:
                route = SQLAlchemyIMWebhookChannelRepository(session).find_by_webhook_id(webhook_id)
            if route is None:
                return WebhookResponse(404, (), b"")
            if not isinstance(route.scope, WorkspaceScope):
                # Deployment credential provisioning has an independent owner.
                # Never decrypt a deployment envelope with a workspace key.
                raise IMCredentialError("Deployment IM credentials are unavailable")
            cipher = TenantBoundCredentialCipher(self._key_provider, str(route.scope.id))
            credentials = IMCredentialCodec(cipher).load(route.channel.provider, route.channel.encrypted_credentials)
            adapter = build_im_provider_adapter(credentials)
            try:
                sink = IMMessageInboxSink(
                    # Keep the existing inbox column until its schema migration;
                    # its routing value is the current Channel's identity.
                    integration_id=IntegrationId(str(route.channel.id)),
                    expected_provider=route.channel.provider,
                    expected_provider_tenant_id=route.channel.provider_tenant_id,
                    repository=IMInboxStorage(self._sessions),
                    clock=lambda: datetime.now(UTC),
                    metrics=OpenTelemetryIMInboxMetrics(),
                )
                handler = adapter.create_webhook_handler(sink)
                if handler is None:
                    return WebhookResponse(404, (), b"")
                return handler.handle(request)
            finally:
                adapter.close()
        except (SQLAlchemyError, ValidationError, IMCredentialError, OSError) as error:
            # SDK and database exception text can retain credentials or callback
            # values. Log the type and source frames without messages or locals.
            logger.exception(
                "IM webhook unavailable webhook_id=%s error_type=%s\n%s",
                webhook_id,
                type(error).__name__,
                "".join(
                    f'  File "{frame.filename}", line {frame.lineno}, in {frame.name}\n'
                    for frame in extract_tb(error.__traceback__)
                ),
                exc_info=False,
            )
            return WebhookResponse(503, (), b"")


def build_im_webhook_ingress_service() -> IMWebhookIngressService:
    return IMWebhookIngressService(
        sessions=session_factory.get_session_maker(),
        key_provider=key_provider_manager.provider,
    )


def _card_decoder(provider: IMProvider) -> IMCardEventDecoder | None:
    from core.human_input_v2.im_integration.adapters.dingtalk import DingTalkIMProviderAdapter
    from core.human_input_v2.im_integration.adapters.feishu_lark import FeishuIMProviderAdapter, LarkIMProviderAdapter
    from core.human_input_v2.im_integration.adapters.ms_teams import MSTeamsIMProviderAdapter
    from core.human_input_v2.im_integration.adapters.slack import SlackIMProviderAdapter
    from core.human_input_v2.im_integration.adapters.wecom import WeComIMProviderAdapter

    match provider:
        case IMProvider.SLACK:
            return SlackIMProviderAdapter.card_event_decoder()
        case IMProvider.FEISHU:
            return FeishuIMProviderAdapter.card_event_decoder()
        case IMProvider.LARK:
            return LarkIMProviderAdapter.card_event_decoder()
        case IMProvider.MS_TEAMS:
            return MSTeamsIMProviderAdapter.card_event_decoder()
        case IMProvider.DING_TALK:
            return DingTalkIMProviderAdapter.card_event_decoder()
        case IMProvider.WE_COM:
            return WeComIMProviderAdapter.card_event_decoder()


class IMCardSubmissionConsumer:
    """Authorize the saved delivery against the authenticated Provider actor."""

    def __init__(self, *, sessions: sessionmaker[Session]) -> None:
        self._submission_service = HumanInputSubmissionService(session_factory=sessions)

    def consume(self, record: IMInboxRecord) -> None:
        decoder = _card_decoder(record.event.provider)
        if decoder is None:
            return
        try:
            card = decoder.decode(record.event)
        except IMCardEventDecodingError:
            logger.warning("Rejected IM card record_id=%s reason=invalid_card_payload", record.record_id)
            return
        if isinstance(card, UnrecognizedIMEvent):
            return
        actor = IMFormActor(
            channel_id=IMChannelId(str(record.integration_id)),
            provider=record.event.provider,
            provider_tenant_id=record.event.provider_tenant_id,
            provider_user_id=card.provider_user_id,
        )
        try:
            self._submission_service.submit_im_form(
                actor=actor,
                form_token=card.correlation_token,
                action=card.action_id,
                inputs=card.inputs,
            )
        except HumanInputFormError as error:
            if error.code is HumanInputFormErrorCode.WORKFLOW_NOT_ACTIVE:
                # A card can be clicked before the pause checkpoint commits.
                # Let the existing Celery retry policy wait for that checkpoint.
                raise
            logger.warning(
                "Rejected IM approval record_id=%s channel_id=%s reason=%s",
                record.record_id,
                actor.channel_id,
                error.code.value,
            )


def configure_im_webhook_runtime(app: DifyApp) -> None:
    def processor_factory() -> IMInboxProcessor:
        sessions = session_factory.get_session_maker()
        return IMInboxProcessor(
            repository=IMInboxStorage(sessions),
            consumer=IMCardSubmissionConsumer(sessions=sessions),
            clock=lambda: datetime.now(UTC),
        )

    configure_im_inbox_task_runtime(app, processor_factory=processor_factory)
