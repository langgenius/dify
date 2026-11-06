"""Workspace-scoped dependencies for one editor's message-template test."""

from sqlalchemy.orm import Session, sessionmaker

from core.app.file_access import DatabaseFileAccessController
from core.human_input_v2.im_integration.adapters.factory import build_im_provider_adapter
from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
from core.human_input_v2.shared.values import AccountId, TenantId
from extensions.ext_database import db
from extensions.ext_key_provider import key_provider_manager
from extensions.ext_storage import storage
from graphon.variable_loader import VariableLoader
from repositories.human_input_v2.email_channel.repository import SQLAlchemyEmailChannelRepository
from repositories.human_input_v2.im_channel_repository import IMChannel
from repositories.workflow.draft_variable_repository import WorkflowDraftVariableRepository
from services.human_input_v2.form_service import HumanInputDeliveryTestFormService
from services.human_input_v2.im_credential_codec import IMCredentialCodec
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher
from services.human_input_v2.message_template_test_service import MessageTemplateTestService
from services.human_input_v2.resend_channel import ResendProviderGateway
from services.workflow.draft_variable_service import DraftVarLoader
from services.workflow.variable_file_gateway import WorkflowVariableFileGateway


def build_message_template_test_service(
    *, tenant_id: str, account_id: str, account_email: str
) -> MessageTemplateTestService:
    sessions = sessionmaker[Session](bind=db.engine, expire_on_commit=False)
    draft_variables = WorkflowDraftVariableRepository(sessions=sessions)
    variable_files = WorkflowVariableFileGateway(sessions, DatabaseFileAccessController())

    def build_adapter(channel: IMChannel) -> IMProviderAdapter:
        cipher = TenantBoundCredentialCipher(key_provider_manager.provider, tenant_id)
        credentials = IMCredentialCodec(cipher).load(channel.provider, channel.encrypted_credentials)
        return build_im_provider_adapter(credentials)

    def build_variable_loader(app_id: str) -> VariableLoader:
        return DraftVarLoader(
            draft_variables,
            app_id,
            tenant_id,
            account_id,
            load_file=storage.load,
            file_inputs=variable_files,
        )

    return MessageTemplateTestService(
        session_factory=sessions,
        tenant_id=TenantId(tenant_id),
        account_id=AccountId(account_id),
        account_email=account_email,
        email_repository_factory=SQLAlchemyEmailChannelRepository,
        email_gateway=ResendProviderGateway(),
        im_adapter_factory=build_adapter,
        form_service=HumanInputDeliveryTestFormService(
            session_factory=sessions,
            tenant_id=TenantId(tenant_id),
            account_id=AccountId(account_id),
            variable_loader_factory=build_variable_loader,
        ),
    )
