"""Production composition for Workspace IM Channel management."""

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.human_input_v2.shared import AccountId, TenantId
from extensions.ext_database import db
from extensions.ext_key_provider import key_provider_manager
from libs.credential_cipher import BoundCredentialCipher
from services.deployment_credential_composition import build_deployment_credential_cipher
from services.human_input_v2.im_channel_service import DeploymentIMChannelService, WorkspaceIMChannelService


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


class _DeploymentCipher:
    """Resolve read-only key state on credential use; discovery and empty lists need no key."""

    def __init__(self) -> None:
        self._cipher: BoundCredentialCipher | None = None

    def _resolve(self) -> BoundCredentialCipher:
        if self._cipher is None:
            self._cipher = build_deployment_credential_cipher()
        return self._cipher

    def encrypt(self, plaintext: str) -> bytes:
        return self._resolve().encrypt(plaintext)

    def decrypt(self, ciphertext: bytes) -> str:
        return self._resolve().decrypt(ciphertext)


def build_deployment_im_channel_service() -> DeploymentIMChannelService:
    """Bind deployment owner and cipher; no provisioning or provider calls during construction."""
    return DeploymentIMChannelService(
        sessionmaker(bind=db.engine, expire_on_commit=False),
        _DeploymentCipher(),
        dify_config.HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE,
    )


__all__ = ["build_deployment_im_channel_service", "build_workspace_im_channel_service"]
