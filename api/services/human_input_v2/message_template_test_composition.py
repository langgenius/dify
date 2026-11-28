"""Select deployment-owned discovery and workspace-scoped message-template dependencies."""

from collections.abc import Callable

from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.im_integration.adapters.factory import build_im_provider_adapter
from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
from core.human_input_v2.shared.values import AccountId, TenantId
from extensions.ext_database import db
from extensions.ext_key_provider import key_provider_manager
from extensions.ext_mail import mail
from graphon.variable_loader import VariableLoader
from repositories.human_input_v2.email_channel.repository import SQLAlchemyEmailChannelRepository
from repositories.human_input_v2.im_channel_repository import IMChannel
from repositories.human_input_v2.sqlalchemy_im_channel_repository import (
    DeploymentIMChannelReader,
    WorkspaceIMChannelReader,
)
from services.feature_service import FeatureService
from services.human_input_v2.form_service import HumanInputDeliveryTestFormService
from services.human_input_v2.im_credential_codec import IMCredentialCodec
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher
from services.human_input_v2.message_template_test_service import MessageTemplateTestService
from services.human_input_v2.resend_channel import ResendProviderGateway
from services.workflow_draft_variable_service import DraftVarLoader


def build_message_template_test_service(
    *, tenant_id: str, account_id: str, account_email: str
) -> MessageTemplateTestService:
    """Build an editor-scoped service with discovery sources fixed for this deployment.

    Requires an admitted tenant and account. Channel discovery is read-only;
    this function only selects dependencies and performs no provider I/O.
    """
    sessions = sessionmaker[Session](bind=db.engine, expire_on_commit=False)
    scoped_tenant_id = TenantId(tenant_id)

    def read_deployment_im(session: Session) -> IMChannel | None:
        """Read the deployment channel from an open session; leave it unchanged."""
        return DeploymentIMChannelReader(session).get()

    def read_workspace_im(session: Session) -> IMChannel | None:
        """Read this tenant's channel from an open session; leave it unchanged."""
        return WorkspaceIMChannelReader(session, scoped_tenant_id).get()

    def global_email_available(_session: Session) -> bool:
        """Report initialized global mail without contacting its provider."""
        return mail.is_inited()

    def tenant_email_available(session: Session) -> bool:
        """Report whether this tenant has Email configured, without decrypting it."""
        return SQLAlchemyEmailChannelRepository(session).load(scoped_tenant_id) is not None

    def no_email_available(_session: Session) -> bool:
        """Report no Email channel for editions without Email discovery."""
        return False

    if FeatureService.is_im_centrally_managed():
        discovery_im_reader: Callable[[Session], IMChannel | None] = read_deployment_im
        discovery_email_available: Callable[[Session], bool] = global_email_available
    else:
        discovery_im_reader = read_workspace_im
        if FeatureService.use_tenant_scoped_email_config():
            discovery_email_available = tenant_email_available
        else:
            discovery_email_available = no_email_available

    def build_adapter(channel: IMChannel) -> IMProviderAdapter:
        cipher = TenantBoundCredentialCipher(key_provider_manager.provider, tenant_id)
        credentials = IMCredentialCodec(cipher).load(channel.provider, channel.encrypted_credentials)
        return build_im_provider_adapter(credentials)

    def build_variable_loader(app_id: str) -> VariableLoader:
        return DraftVarLoader(engine=db.engine, app_id=app_id, tenant_id=tenant_id, user_id=account_id)

    return MessageTemplateTestService(
        session_factory=sessions,
        tenant_id=scoped_tenant_id,
        account_id=AccountId(account_id),
        account_email=account_email,
        email_repository_factory=SQLAlchemyEmailChannelRepository,
        email_gateway=ResendProviderGateway(),
        im_adapter_factory=build_adapter,
        discovery_im_reader=discovery_im_reader,
        discovery_email_available=discovery_email_available,
        form_service=HumanInputDeliveryTestFormService(
            session_factory=sessions,
            tenant_id=scoped_tenant_id,
            account_id=AccountId(account_id),
            variable_loader_factory=build_variable_loader,
        ),
    )
