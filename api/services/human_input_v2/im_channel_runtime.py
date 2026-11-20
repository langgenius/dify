"""Bind current IM runtime Channels and provider adapters to their credential owners."""

from collections.abc import Callable

from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.im_integration.adapters import factory as im_adapter_factory
from core.human_input_v2.im_integration.adapters.credentials import IMProviderCredentials
from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
from core.human_input_v2.shared import DeploymentScope, DirectoryScope, TenantId, WorkspaceScope
from extensions.ext_key_provider import key_provider_manager
from libs.credential_cipher import BoundCredentialCipher, CredentialCipherError
from repositories.human_input_v2.im_channel_repository import IMChannel
from repositories.human_input_v2.sqlalchemy_im_channel_repository import (
    DeploymentIMChannelReader,
    WorkspaceIMChannelReader,
)
from services import deployment_credential_composition
from services.feature_service import FeatureService
from services.human_input_v2.im_credential_codec import IMCredentialCodec, IMCredentialError
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher


class DifyIMChannelAdapterFactory:
    """Recover one Channel's credentials using an already-selected owner cipher."""

    def __init__(
        self,
        cipher: BoundCredentialCipher,
        adapter_builder: Callable[[IMProviderCredentials], IMProviderAdapter] | None = None,
    ) -> None:
        self._cipher = cipher
        self._adapter_builder = adapter_builder or im_adapter_factory.build_im_provider_adapter

    def __call__(self, channel: IMChannel) -> IMProviderAdapter:
        """Recover matching credentials and return a new adapter for the caller to close."""
        credentials = IMCredentialCodec(self._cipher).load(channel.provider, channel.encrypted_credentials)
        return self._adapter_builder(credentials)


def workspace_runtime_im_scope(tenant_id: TenantId) -> DirectoryScope:
    """Resolve the IM owner for a trusted workspace without accessing credentials."""
    if FeatureService.is_im_centrally_managed():
        return DeploymentScope()
    return WorkspaceScope(tenant_id)


def read_current_im_channel(session: Session, owner_scope: DirectoryScope) -> IMChannel | None:
    """Read the current Channel for the trusted owner inside the caller's transaction."""
    if isinstance(owner_scope, WorkspaceScope):
        return WorkspaceIMChannelReader(session, owner_scope.id).get()
    return DeploymentIMChannelReader(session).get()


def build_im_channel_adapter(
    channel: IMChannel,
    owner_scope: DirectoryScope,
    *,
    session_maker: sessionmaker[Session],
) -> IMProviderAdapter:
    """Open a current Channel with the same trusted owner used to load it.

    Call outside the Channel read transaction. Deployment keys must already be
    provisioned and are read using the supplied session maker. Missing keys or
    invalid credentials fail before adapter construction. The caller owns the
    returned adapter.
    """
    cipher: BoundCredentialCipher
    if isinstance(owner_scope, WorkspaceScope):
        cipher = TenantBoundCredentialCipher(key_provider_manager.provider, str(owner_scope.id))
    else:
        try:
            cipher = deployment_credential_composition.build_deployment_credential_cipher(session_maker=session_maker)
        except CredentialCipherError:
            raise IMCredentialError("IM credential configuration is unavailable") from None
    return DifyIMChannelAdapterFactory(cipher)(channel)
