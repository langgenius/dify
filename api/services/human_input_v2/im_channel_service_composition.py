"""Production composition for Workspace IM Channel management."""

from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.shared import AccountId, TenantId
from extensions.ext_database import db
from extensions.ext_key_provider import key_provider_manager
from services.human_input_v2.im_channel_service import WorkspaceIMChannelService


def build_workspace_im_channel_service(
    tenant_id: TenantId,
    account_id: AccountId,
) -> WorkspaceIMChannelService:
    operation_sessions = sessionmaker[Session](bind=db.engine, expire_on_commit=False)
    return WorkspaceIMChannelService(
        operation_sessions,
        tenant_id,
        account_id,
        key_provider_manager.provider,
    )


__all__ = ["build_workspace_im_channel_service"]
