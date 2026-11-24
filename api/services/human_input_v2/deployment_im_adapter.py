"""Build deployment IM adapters exclusively with the installation-bound cipher."""

from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.im_integration.adapters.factory import build_im_provider_adapter
from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
from libs.credential_cipher import CredentialCipherError
from repositories.human_input_v2.im_channel_repository import IMChannel
from services.deployment_credential_composition import build_deployment_credential_cipher
from services.human_input_v2.im_credential_codec import IMCredentialCodec, IMCredentialError


def build_deployment_im_adapter(
    channel: IMChannel, *, session_maker: sessionmaker[Session] | None = None
) -> IMProviderAdapter:
    """Require a deployment Channel and provisioned key; return its provider adapter.

    Read the installation key without provisioning or falling back to tenant keys.
    Missing key state and invalid ciphertext fail with a sanitized credential error.
    """
    try:
        cipher = build_deployment_credential_cipher(session_maker=session_maker)
        credentials = IMCredentialCodec(cipher).load(channel.provider, channel.encrypted_credentials)
    except CredentialCipherError:
        raise IMCredentialError("IM credential configuration is unavailable") from None
    return build_im_provider_adapter(credentials)
