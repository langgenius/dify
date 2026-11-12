"""Concrete SDK ports for BYOA tests, independent of Agent dev's Native trace hooks."""

from collections.abc import Sequence
from typing import Any, override

from dify_trace_sdk.provider import TraceProvider

from core.helper.encrypter import obfuscated_token
from services.tracing.errors import TraceProviderUnavailableError, UnknownTraceProviderError
from services.tracing.providers import SUPPORTED_PROVIDERS, TraceProviderCatalog, TracingSecretCipher


class InstalledTraceProviders(TraceProviderCatalog):
    """Only the given provider classes are installed; other supported IDs are not."""

    def __init__(self, *providers: type[TraceProvider[Any]]) -> None:
        self._providers = {provider.id: provider for provider in providers}

    @override
    def resolve(self, provider_id: str) -> type[TraceProvider[Any]]:
        provider = self._providers.get(provider_id)
        if provider is not None:
            return provider
        if provider_id in SUPPORTED_PROVIDERS:
            raise TraceProviderUnavailableError(provider_id)
        raise UnknownTraceProviderError(provider_id)


class WorkspaceBoundCipher(TracingSecretCipher):
    """Reversible ``enc:<tenant>:<value>`` tokens that only their own workspace decrypts.

    ``decrypted`` lists every token decrypted, so tests can prove when credentials were not read.
    """

    def __init__(self) -> None:
        self.decrypted: list[str] = []

    @override
    def encrypt(self, tenant_id: str, value: str) -> str:
        return f"enc:{tenant_id}:{value}"

    @override
    def decrypt(self, tenant_id: str, tokens: Sequence[str]) -> list[str]:
        prefix = f"enc:{tenant_id}:"
        if not all(token.startswith(prefix) for token in tokens):
            raise ValueError("token was encrypted for another workspace")
        self.decrypted.extend(tokens)
        return [token.removeprefix(prefix) for token in tokens]

    @override
    def mask(self, value: str) -> str:
        return obfuscated_token(value)
