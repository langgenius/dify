"""Trace providers as the pipeline reaches them, and their stored configurations.

Dify supports a fixed set of provider IDs; a deployment may install any subset
of their packages. An unknown ID is a client error, a known but uninstalled one
is a deployment fact. Stored configurations keep the provider's fields at the
top level and its secrets as workspace-encrypted tokens.
"""

import logging
from collections.abc import Mapping, Sequence
from typing import Any, Protocol

from dify_trace_sdk.config import ProviderConfig
from dify_trace_sdk.provider import TraceProvider
from pydantic import ValidationError

from services.tracing.errors import ProviderConfigUnreadableError

logger = logging.getLogger(__name__)

SUPPORTED_PROVIDERS = (
    "langfuse",
    "langsmith",
    "opik",
    "weave",
    "arize",
    "phoenix",
    "aliyun",
    "mlflow",
    "databricks",
    "tencent",
)


class TraceProviderCatalog(Protocol):
    def resolve(self, provider_id: str) -> type[TraceProvider[Any]]:
        """The installed provider class of a provider ID.

        Raises:
            UnknownTraceProviderError: Dify does not support the ID.
            TraceProviderUnavailableError: This deployment does not install the provider.
        """
        ...


class TracingSecretCipher(Protocol):
    """Workspace-scoped encryption of provider secrets."""

    def encrypt(self, tenant_id: str, value: str) -> str: ...

    def decrypt(self, tenant_id: str, tokens: Sequence[str]) -> list[str]:
        """Decrypt tokens in order; raises when the workspace key or a token is unreadable."""
        ...

    def mask(self, value: str) -> str:
        """The masked form clients were shown before secrets became write-only."""
        ...


class ProviderConfigCodec:
    """Convert provider configurations between their validated and stored forms."""

    def __init__(self, cipher: TracingSecretCipher) -> None:
        self._cipher = cipher

    def encode(self, tenant_id: str, config: ProviderConfig) -> dict[str, Any]:
        stored = config.model_dump(mode="json")
        for name in config.secret_fields():
            value = stored.get(name)
            # An empty secret stays empty so it is not reported as configured.
            if isinstance(value, str) and value:
                stored[name] = self._cipher.encrypt(tenant_id, value)
        return stored

    def decode(self, tenant_id: str, provider: type[TraceProvider[Any]], stored: Mapping[str, Any]) -> ProviderConfig:
        """Decrypt and validate a stored configuration for verification or delivery.

        Raises:
            ProviderConfigUnreadableError: A secret cannot be decrypted or the configuration no longer validates.
        """
        model = provider.config_model
        values = dict(stored)
        encrypted = [
            name for name in sorted(model.secret_fields()) if isinstance(values.get(name), str) and values[name]
        ]
        if encrypted:
            try:
                decrypted = self._cipher.decrypt(tenant_id, [values[name] for name in encrypted])
            except Exception as error:
                # A missing workspace key or a corrupt token; the type alone is safe to log.
                logger.warning("Tracing configuration secrets unreadable: %s", type(error).__name__)
                raise ProviderConfigUnreadableError from None
            values.update(zip(encrypted, decrypted, strict=True))
        try:
            return model.model_validate(values)
        except ValidationError:
            raise ProviderConfigUnreadableError from None

    def mask(self, value: str) -> str:
        return self._cipher.mask(value)


def configured_secrets(provider: type[TraceProvider[Any]], stored: Mapping[str, Any]) -> tuple[str, ...]:
    return tuple(name for name in sorted(provider.config_model.secret_fields()) if stored.get(name))
