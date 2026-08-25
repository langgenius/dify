"""Owner-native inputs and ports for IM Integration configuration management."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Protocol

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.shared import DirectoryScope

from .adapters import credentials as adapter_credentials
from .integration import EncryptedCredentials


class IMIntegrationAlreadyExistsError(RuntimeError):
    """The effective Directory scope already owns its singleton Integration."""


class IMProviderConfigurationFailureKind(StrEnum):
    INVALID_CREDENTIALS = "invalid_credentials"
    CONNECTION_FAILURE = "connection_failure"


@dataclass(frozen=True, slots=True)
class ConfirmedIMConfiguration:
    """Provider-validated, protected configuration accepted by the aggregate."""

    provider: IMProvider
    provider_tenant_id: str
    encrypted_credentials: EncryptedCredentials = field(repr=False)
    app_identifier: str
    callback_url: str | None
    provider_tenant_display: str | None

    def __post_init__(self) -> None:
        if not self.provider_tenant_id.strip():
            raise ValueError("provider tenant id must not be blank")
        object.__setattr__(self, "provider_tenant_id", self.provider_tenant_id.strip())


@dataclass(frozen=True, slots=True)
class IMProviderTestResult:
    """Credential-free confirmation returned only for one submitted candidate."""

    provider: IMProvider
    provider_tenant_id: str


class IMProviderConfigurationPort(Protocol):
    """Provider I/O and credential protection performed before persistence."""

    def available_providers(self) -> tuple[IMProvider, ...]: ...

    def prepare(
        self,
        scope: DirectoryScope,
        credentials: adapter_credentials.IMProviderCredentials,
    ) -> ConfirmedIMConfiguration:
        """Authenticate, resolve tenant, validate scopes, then protect credentials."""
        ...

    def test(
        self,
        scope: DirectoryScope,
        credentials: adapter_credentials.IMProviderCredentials,
    ) -> IMProviderTestResult:
        """Validate only the submitted candidate without persistence."""
        ...


__all__ = [
    "ConfirmedIMConfiguration",
    "IMIntegrationAlreadyExistsError",
    "IMProviderConfigurationFailureKind",
    "IMProviderConfigurationPort",
    "IMProviderTestResult",
]
