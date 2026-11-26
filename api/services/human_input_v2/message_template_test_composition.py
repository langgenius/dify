"""Workspace-scoped dependencies for one editor's message-template test."""

from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
from core.human_input_v2.shared.values import AccountId, TenantId
from extensions.ext_database import db
from graphon.variable_loader import VariableLoader
from repositories.human_input_v2.email_channel.repository import SQLAlchemyEmailChannelRepository
from repositories.human_input_v2.im_channel_repository import IMChannel
from services.human_input_v2.form_service import HumanInputDeliveryTestFormService
from services.human_input_v2.im_channel_runtime import build_im_channel_adapter, workspace_runtime_im_scope
from services.human_input_v2.message_template_test_service import MessageTemplateTestService
from services.workflow_draft_variable_service import DraftVarLoader


def build_message_template_test_service(
    *, tenant_id: str, account_id: str, account_email: str
) -> MessageTemplateTestService:
    """Bind a test send to the editor, workspace, and the runtime's credential owner."""
    sessions = sessionmaker[Session](bind=db.engine, expire_on_commit=False)
    owner_scope = workspace_runtime_im_scope(TenantId(tenant_id))

    def build_adapter(channel: IMChannel) -> IMProviderAdapter:
        return build_im_channel_adapter(channel, owner_scope, session_maker=sessions)

    def build_variable_loader(app_id: str) -> VariableLoader:
        return DraftVarLoader(engine=db.engine, app_id=app_id, tenant_id=tenant_id, user_id=account_id)

    return MessageTemplateTestService(
        session_factory=sessions,
        tenant_id=TenantId(tenant_id),
        account_id=AccountId(account_id),
        account_email=account_email,
        email_repository_factory=SQLAlchemyEmailChannelRepository,
        im_adapter_factory=build_adapter,
        form_service=HumanInputDeliveryTestFormService(
            session_factory=sessions,
            tenant_id=TenantId(tenant_id),
            account_id=AccountId(account_id),
            variable_loader_factory=build_variable_loader,
        ),
    )
