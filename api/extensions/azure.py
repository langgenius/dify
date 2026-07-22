"""Azure-specific helpers for Redis authentication via Entra ID (Managed Identity)."""

from typing import override
from urllib.parse import urlparse, urlunparse

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
    def get_credentials(self) -> tuple[str, str]:
        creds = self._inner.get_credentials()
        if len(creds) == 2:
            return creds  # type: ignore[return-value]
        return ("", creds[0])


def get_azure_credential_provider() -> CredentialProvider:
    """Create a redis-py credential provider for Azure Entra ID authentication."""
    from redis_entraid.cred_provider import create_from_default_azure_credential

    return create_from_default_azure_credential(
        scopes=(AZURE_REDIS_SCOPE,),
    )


def _force_redis_db_zero(url: str) -> str:
    """Force the Redis db index in a URL to 0.

    Azure Managed Redis only supports a single logical database (index 0).
    """
    parsed = urlparse(url)
    return urlunparse(parsed._replace(path="/0"))


def apply_azure_celery_broker_auth(celery_app, broker_url: str) -> None:
    """Configure Celery broker to authenticate via Azure Entra ID credential provider.

    Also forces db index to 0 (Azure Managed Redis only supports db 0).
    Sets ``broker_read_url`` and ``broker_write_url`` with a ``credential_provider``
    query param.  Celery's conf system strips query params from the primary
    ``broker_url``, but these two are passed verbatim to kombu.
    """
    broker_url = _force_redis_db_zero(broker_url)
    cred_param = "credential_provider=extensions.azure.AzureEntraIdCredentialProvider"
    sep = "&" if "?" in broker_url else "?"
    broker_url_with_cred = f"{broker_url}{sep}{cred_param}"
    celery_app.conf.update(
        broker_url=broker_url,
        broker_read_url=broker_url_with_cred,
        broker_write_url=broker_url_with_cred,
    )
