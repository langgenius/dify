"""Workspace-scoped dependencies for one editor's message-template test."""

from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.im_integration.adapters.factory import build_im_provider_adapter
from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
from core.human_input_v2.shared.values import AccountId, TenantId
from extensions.ext_database import db
from extensions.ext_key_provider import key_provider_manager
from repositories.human_input_v2.email_channel.repository import SQLAlchemyEmailChannelRepository
from repositories.human_input_v2.im_channel_repository import IMChannel
from services.human_input_v2.im_credential_codec import IMCredentialCodec
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher
from services.human_input_v2.message_template_test_service import MessageTemplateTestService
from services.human_input_v2.resend_channel import ResendProviderGateway


def build_message_template_test_service(
    *, tenant_id: str, account_id: str, account_email: str
) -> MessageTemplateTestService:
    sessions = sessionmaker[Session](bind=db.engine, expire_on_commit=False)

    def build_adapter(channel: IMChannel) -> IMProviderAdapter:
        cipher = TenantBoundCredentialCipher(key_provider_manager.provider, tenant_id)
        credentials = IMCredentialCodec(cipher).load(channel.provider, channel.encrypted_credentials)
        return build_im_provider_adapter(credentials)

    return MessageTemplateTestService(
        session_factory=sessions,
        tenant_id=TenantId(tenant_id),
        account_id=AccountId(account_id),
        account_email=account_email,
        email_repository=SQLAlchemyEmailChannelRepository(sessions),
        email_gateway=ResendProviderGateway(),
        im_adapter_factory=build_adapter,
    )
