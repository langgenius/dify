"""Deployment IM credentials stay encrypted in Enterprise, never under tenant keys."""

from typing import override

import httpx
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.human_input_v2.im_integration.adapters.factory import build_im_provider_adapter
from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
from enums import DeploymentEdition
from repositories.human_input_v2.im_channel_repository import IMChannel
from repositories.human_input_v2.sqlalchemy_im_channel_repository import (
    DeploymentIMChannelReader,
    DeploymentIMChannelWriter,
)
from services.enterprise.base import EnterpriseRequest
from services.errors.enterprise import EnterpriseAPIError
from services.human_input_v2.im_channel_service import IMChannelService
from services.human_input_v2.im_credential_codec import IMCredentialCodec, IMCredentialError


class EnterpriseIMCipher:
    """Store immutable encrypted secrets remotely; resolve only active channel references.

    Calls require Enterprise inner authentication. Failed route writes can leave an
    unreachable encrypted record, but can never activate credentials for a channel.
    """

    def encrypt(self, plaintext: str) -> bytes:
        try:
            result = EnterpriseRequest.send_request(
                "POST", "/integrations/im/credentials:seal", json={"credentials": plaintext}
            )
        except (EnterpriseAPIError, httpx.HTTPError):
            raise IMCredentialError("Deployment IM credentials are unavailable") from None
        reference = result.get("reference")
        if not isinstance(reference, str) or not reference:
            raise IMCredentialError("Deployment IM credentials are unavailable")
        return reference.encode()

    def decrypt(self, ciphertext: bytes) -> str:
        try:
            result = EnterpriseRequest.send_request(
                "POST", "/integrations/im/credentials:resolve", json={"reference": ciphertext.decode()}
            )
            credentials = result.get("credentials")
            if not isinstance(credentials, str):
                raise IMCredentialError("Deployment IM credentials are unavailable")
            return credentials
        except (EnterpriseAPIError, httpx.HTTPError, UnicodeError, ValueError):
            raise IMCredentialError("Deployment IM credentials are unavailable") from None


def build_deployment_im_adapter(channel: IMChannel) -> IMProviderAdapter:
    """Build an adapter only for the current persisted deployment channel.

    Resolve credentials through Enterprise; no tenant key or plaintext persistence
    is permitted. Enterprise verifies the immutable reference against the route.
    """
    if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
        raise IMCredentialError("Deployment IM credentials require Enterprise")
    credentials = IMCredentialCodec(EnterpriseIMCipher()).load(channel.provider, channel.encrypted_credentials)
    return build_im_provider_adapter(credentials)


class DeploymentIMChannelService(IMChannelService):
    """Reuse channel CAS and provider validation with an Enterprise-owned cipher."""

    def __init__(self, sessions: sessionmaker[Session]) -> None:
        super().__init__(
            sessions, IMCredentialCodec(EnterpriseIMCipher()), dify_config.HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE
        )

    @override
    def _new_reader(self, session: Session) -> DeploymentIMChannelReader:
        return DeploymentIMChannelReader(session)

    @override
    def _new_writer(self, session: Session) -> DeploymentIMChannelWriter:
        return DeploymentIMChannelWriter(session)
