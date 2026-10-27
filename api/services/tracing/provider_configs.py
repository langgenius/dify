"""Verify and present tracing provider configurations for the configuration service.

Stored rows keep the shape they already have: the provider's fields at the
top level, secrets as workspace-encrypted tokens, and derived fields resolved
by verification. Secrets are write-only: they are decrypted to verify or to
deliver traces and are never presented back.
"""

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal, override

from dify_trace_sdk.config import ProviderConfig
from dify_trace_sdk.egress import Egress
from dify_trace_sdk.errors import VerificationError
from dify_trace_sdk.provider import TraceProvider
from pydantic import ValidationError

from services.app_tracing_config_service import (
    AppTracingConfigInvalidConfigurationError,
    AppTracingConfigInvalidProviderError,
    AppTracingConfigProcessingError,
    AppTracingConfigProviderUnavailableError,
    AppTracingConfigVerificationFailedError,
    PresentedTracingConfig,
    TracingConfigProviderGateway,
)
from services.tracing.errors import (
    ProviderConfigUnreadableError,
    TraceProviderUnavailableError,
    UnknownTraceProviderError,
)
from services.tracing.providers import (
    SUPPORTED_PROVIDERS,
    ProviderConfigCodec,
    TraceProviderCatalog,
    configured_secrets,
)

logger = logging.getLogger(__name__)


def resolve_provider(providers: TraceProviderCatalog, provider_id: str) -> type[TraceProvider[Any]]:
    try:
        return providers.resolve(provider_id)
    except UnknownTraceProviderError:
        raise AppTracingConfigInvalidProviderError(provider_id) from None
    except TraceProviderUnavailableError:
        raise AppTracingConfigProviderUnavailableError from None


def _comparable(value: object) -> object:
    return value.strip().rstrip("/") if isinstance(value, str) else value


class ProviderConfigGateway(TracingConfigProviderGateway):
    def __init__(self, *, providers: TraceProviderCatalog, codec: ProviderConfigCodec, egress: Egress) -> None:
        self._providers = providers
        self._codec = codec
        self._egress = egress

    @override
    def validate_provider(self, tracing_provider: str) -> None:
        # Reading, deleting, or disabling a configuration must work while its package is not installed.
        if tracing_provider not in SUPPORTED_PROVIDERS:
            raise AppTracingConfigInvalidProviderError(tracing_provider)

    @override
    def validate_saved_config(
        self, *, workspace_id: str, tracing_provider: str, tracing_config: dict[str, Any]
    ) -> None:
        provider = resolve_provider(self._providers, tracing_provider)
        try:
            self._codec.decode(workspace_id, provider, tracing_config)
        except ProviderConfigUnreadableError:
            raise AppTracingConfigProcessingError from None

    @override
    def prepare_new_config(
        self, *, workspace_id: str, tracing_provider: str, tracing_config: dict[str, Any]
    ) -> dict[str, Any]:
        provider = resolve_provider(self._providers, tracing_provider)
        return self._verified(workspace_id, provider, self._submitted(provider, tracing_config, None))

    @override
    def prepare_updated_config(
        self,
        *,
        workspace_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
        current_tracing_config: dict[str, Any] | None,
    ) -> dict[str, Any]:
        provider = resolve_provider(self._providers, tracing_provider)
        current = None
        if current_tracing_config is not None:
            try:
                current = self._codec.decode(workspace_id, provider, current_tracing_config)
            except ProviderConfigUnreadableError:
                # An unreadable row can still be replaced by re-entering its secrets.
                current = None
        return self._verified(workspace_id, provider, self._submitted(provider, tracing_config, current))

    @override
    def present_config(
        self, *, workspace_id: str, tracing_provider: str, tracing_config: dict[str, Any] | None
    ) -> PresentedTracingConfig:
        if tracing_config is None:
            raise AppTracingConfigProcessingError
        provider = resolve_provider(self._providers, tracing_provider)
        model = provider.config_model
        hidden = model.secret_fields() | model.derived_fields()
        try:
            # Secrets stay encrypted here: presentation never needs them.
            config = model.model_validate(tracing_config)
        except ValidationError:
            # Historical rows stay readable even when they no longer validate.
            values = {
                key: value for key, value in tracing_config.items() if key not in hidden and isinstance(value, str)
            }
            return PresentedTracingConfig(values={**values, "project_url": None}, configured_secrets=())
        values = {key: value for key, value in config.model_dump(mode="json").items() if key not in hidden}
        values["project_url"] = provider(self._egress).project_url(config)
        return PresentedTracingConfig(values=values, configured_secrets=configured_secrets(provider, tracing_config))

    def _submitted(
        self, provider: type[TraceProvider[Any]], submitted: Mapping[str, Any], current: ProviderConfig | None
    ) -> dict[str, Any]:
        """Merge a form submission over the current configuration.

        A secret left empty, omitted, or echoed in its masked form keeps its
        current value; ``None`` clears an optional secret. Derived fields are
        never accepted from the client. Stored secrets are kept only while the
        destination stays the same, so they never follow an edited host.
        """
        model = provider.config_model
        current_values = current.model_dump() if current is not None else {}
        moved = any(
            name in submitted and _comparable(submitted[name]) != _comparable(current_values.get(name))
            for name in model.destination_fields()
        )
        values: dict[str, Any] = {}
        for field in model.form_fields():
            current_value = current_values.get(field.name)
            if field.secret and self._left_unchanged(submitted, field.name, current_value):
                if not moved and current_value is not None:
                    values[field.name] = current_value
                continue
            if field.name in submitted:
                values[field.name] = submitted[field.name]
        return values

    def _left_unchanged(self, submitted: Mapping[str, Any], name: str, current_value: object) -> bool:
        """Whether the form leaves a secret as it is: omitted, blank, or echoed in its masked form."""
        if name not in submitted:
            return True
        value = submitted[name]
        return value == "" or (
            isinstance(current_value, str) and bool(current_value) and value == self._codec.mask(current_value)
        )

    def _verified(
        self, workspace_id: str, provider: type[TraceProvider[Any]], values: dict[str, Any]
    ) -> dict[str, Any]:
        try:
            config = provider.config_model.model_validate(values)
        except ValidationError:
            raise AppTracingConfigInvalidConfigurationError from None
        try:
            verified = provider(self._egress).verify(config)
        except VerificationError as error:
            logger.warning("Tracing configuration verification failed: provider=%s code=%s", provider.id, error.code)
            raise AppTracingConfigVerificationFailedError from None
        return self._codec.encode(workspace_id, verified)


@dataclass(frozen=True, slots=True)
class TraceProviderSupport:
    """What a provider's mapping supports. Describes the adapter, not delivery health."""

    provider: str
    native_cost: bool
    trace_url: bool
    span_url: bool
    agent_spans: Literal[True] = True
    session: Literal[True] = True
    native_usage: Literal[True] = True
    export_ack: Literal["accepted"] = "accepted"
    """An exporter acknowledgement does not confirm that the destination can query the trace."""


@dataclass(frozen=True, slots=True)
class TraceProviderCapabilities:
    support: TraceProviderSupport
    api_collection_enabled: bool
    """Whether this deployment collects Agent runtime spans; it does not probe the Agent runtime."""


def support_of(provider: type[TraceProvider[Any]]) -> TraceProviderSupport:
    return TraceProviderSupport(
        provider=provider.id,
        native_cost=provider.capabilities.native_cost,
        trace_url=provider.capabilities.trace_url,
        span_url=provider.capabilities.span_url,
    )


class TraceProviderCapabilitiesQuery:
    def __init__(self, *, providers: TraceProviderCatalog, api_collection_enabled: bool) -> None:
        self._providers = providers
        self._api_collection_enabled = api_collection_enabled

    def get(self, provider_id: str) -> TraceProviderCapabilities:
        """Raises AppTracingConfigInvalidProviderError or AppTracingConfigProviderUnavailableError."""
        return TraceProviderCapabilities(
            support=support_of(resolve_provider(self._providers, provider_id)),
            api_collection_enabled=self._api_collection_enabled,
        )
