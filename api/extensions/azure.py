"""Azure-specific helpers for Redis authentication via Entra ID (Managed Identity)."""

from typing import Union, override

from redis import CredentialProvider

AZURE_REDIS_SCOPE = "https://redis.azure.com/.default"


class AzureEntraIdCredentialProvider(CredentialProvider):
    """Redis credential provider for Azure Entra ID (Managed Identity) authentication.

    Wraps ``redis-entraid``'s provider so that it can be instantiated with no
    arguments — required by kombu's URL-based ``credential_provider`` resolution.
    """

    _inner: CredentialProvider

    def __init__(self) -> None:
        from redis_entraid.cred_provider import create_from_default_azure_credential

        self._inner = create_from_default_azure_credential(
            scopes=(AZURE_REDIS_SCOPE,),
        )

    @override
    def get_credentials(self) -> Union[tuple[str], tuple[str, str]]:
        return self._inner.get_credentials()


def get_azure_credential_provider() -> CredentialProvider:
    """Create a redis-py credential provider for Azure Entra ID authentication."""
    from redis_entraid.cred_provider import create_from_default_azure_credential

    return create_from_default_azure_credential(
        scopes=(AZURE_REDIS_SCOPE,),
    )


def apply_azure_redis_auth(params: dict) -> None:
    """Apply Azure Entra ID authentication to a Redis connection params dict.

    Removes static username/password and injects a credential_provider instead.
    """
    params.pop("username", None)
    params.pop("password", None)
    params["credential_provider"] = get_azure_credential_provider()


def apply_azure_celery_broker_auth(celery_app, broker_url: str) -> None:
    """Configure Celery broker to authenticate via Azure Entra ID credential provider."""
    cred_param = "credential_provider=extensions.azure.AzureEntraIdCredentialProvider"
    sep = "&" if "?" in broker_url else "?"
    broker_url_with_cred = f"{broker_url}{sep}{cred_param}"
    celery_app.conf.update(
        broker_read_url=broker_url_with_cred,
        broker_write_url=broker_url_with_cred,
    )
