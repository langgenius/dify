"""Protect Resend authentication credentials with the shared Channel envelope."""

from core.helper import encrypter
from core.human_input_v2.shared import TenantId
from repositories.human_input_v2.channel_credentials import ChannelEncryptedCredentials
from repositories.human_input_v2.email_channel.entities import ResendCredentials


def seal_email_credentials(tenant_id: TenantId, credentials: ResendCredentials) -> ChannelEncryptedCredentials:
    ciphertext = encrypter.encrypt_token(str(tenant_id), credentials.model_dump_json())
    return ChannelEncryptedCredentials(ciphertext=ciphertext)


def load_email_credentials(tenant_id: TenantId, envelope: ChannelEncryptedCredentials) -> ResendCredentials:
    plaintext = encrypter.decrypt_token(str(tenant_id), envelope.ciphertext)
    return ResendCredentials.model_validate_json(plaintext)
