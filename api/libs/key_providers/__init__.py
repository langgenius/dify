from libs.key_providers.base import BaseKeyProvider

__all__ = ["BaseKeyProvider", "generate_key_pair"]


def generate_key_pair(tenant_id: str) -> str:
    """
    Provision the tenant credential encryption key using the configured KEY_PROVIDER_TYPE.

    Returns the opaque reference to be stored in Tenant.encrypt_public_key.
    """
    from extensions.ext_key_provider import key_provider_manager

    return key_provider_manager.provider.generate_key_pair(tenant_id)
