"""Store, verify, and present tracing provider configurations.

Stored rows keep the shape they already have: the provider's fields at the
top level, secrets as workspace-encrypted tokens, and derived fields resolved
by verification. Secrets are write-only: they are decrypted to verify or to
deliver traces and are never presented back.
"""

import logging
from collections.abc import Mapping
from typing import Any, override

from dify_trace_sdk.config import ProviderConfig
from dify_trace_sdk.egress import Egress
from dify_trace_sdk.errors import VerificationError
from dify_trace_sdk.provider import TraceProvider
from pydantic import ValidationError

from core.helper.encrypter import batch_decrypt_token, encrypt_token, obfuscated_token
from services.app_tracing_config_service import (
    AppTracingConfigInvalidConfigurationError,
    AppTracingConfigInvalidProviderError,
    AppTracingConfigProcessingError,
    AppTracingConfigProviderUnavailableError,
    AppTracingConfigVerificationFailedError,
    PresentedTracingConfig,
    TracingConfigProviderGateway,
)
from services.tracing.registry import (
    SUPPORTED_PROVIDERS,
    TraceProviderUnavailableError,
    UnknownTraceProviderError,
    provider_class,
)

logger = logging.getLogger(__name__)


class ProviderConfigUnreadableError(Exception):
    """A stored configuration cannot be decrypted or no longer validates."""


def resolve_provider(provider_id: str) -> type[TraceProvider[Any]]:
    try:
        return provider_class(provider_id)
    except UnknownTraceProviderError:
        raise AppTracingConfigInvalidProviderError(provider_id) from None
    except TraceProviderUnavailableError:
        raise AppTracingConfigProviderUnavailableError from None


def encode_config(tenant_id: str, config: ProviderConfig) -> dict[str, Any]:
    stored = config.model_dump(mode="json")
    for name in config.secret_fields():
        value = stored.get(name)
        # An empty secret stays empty so it is not reported as configured.
        if isinstance(value, str) and value:
            stored[name] = encrypt_token(tenant_id, value)
    return stored


def decode_config(tenant_id: str, provider: type[TraceProvider[Any]], stored: Mapping[str, Any]) -> ProviderConfig:
    """Decrypt and validate a stored configuration for verification or delivery."""
    model = provider.config_model
    values = dict(stored)
    encrypted = [name for name in sorted(model.secret_fields()) if isinstance(values.get(name), str) and values[name]]
    if encrypted:
        try:
            decrypted = batch_decrypt_token(tenant_id, [values[name] for name in encrypted])
        except Exception as error:
            # A missing workspace key or a corrupt token; the type alone is safe to log.
            logger.warning("Tracing configuration secrets unreadable: %s", type(error).__name__)
            raise ProviderConfigUnreadableError from None
        values.update(zip(encrypted, decrypted, strict=True))
    try:
        return model.model_validate(values)
    except ValidationError:
        raise ProviderConfigUnreadableError from None


def configured_secrets(provider: type[TraceProvider[Any]], stored: Mapping[str, Any]) -> tuple[str, ...]:
    return tuple(name for name in sorted(provider.config_model.secret_fields()) if stored.get(name))


def _comparable(value: object) -> object:
    return value.strip().rstrip("/") if isinstance(value, str) else value


def _left_unchanged(submitted: Mapping[str, Any], name: str, current_value: object) -> bool:
    """Whether the form leaves a secret as it is: omitted, blank, or echoed in its masked form."""
    if name not in submitted:
        return True
    value = submitted[name]
    return value == "" or (
        isinstance(current_value, str) and bool(current_value) and value == obfuscated_token(current_value)
    )


class ProviderConfigGateway(TracingConfigProviderGateway):
    def __init__(self, egress: Egress) -> None:
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
        provider = resolve_provider(tracing_provider)
        try:
            decode_config(workspace_id, provider, tracing_config)
        except ProviderConfigUnreadableError:
            raise AppTracingConfigProcessingError from None

    @override
    def prepare_new_config(
        self, *, workspace_id: str, tracing_provider: str, tracing_config: dict[str, Any]
    ) -> dict[str, Any]:
        provider = resolve_provider(tracing_provider)
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
        provider = resolve_provider(tracing_provider)
        current = None
        if current_tracing_config is not None:
            try:
                current = decode_config(workspace_id, provider, current_tracing_config)
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
        provider = resolve_provider(tracing_provider)
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

    @staticmethod
    def _submitted(
        provider: type[TraceProvider[Any]], submitted: Mapping[str, Any], current: ProviderConfig | None
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
            if field.secret and _left_unchanged(submitted, field.name, current_value):
                if not moved and current_value is not None:
                    values[field.name] = current_value
                continue
            if field.name in submitted:
                values[field.name] = submitted[field.name]
        return values

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
        return encode_config(workspace_id, verified)


def capabilities_payload(provider_id: str) -> dict[str, bool | str]:
    """What a provider's mapping supports, for the console. Describes the adapter, not delivery health."""
    capabilities = resolve_provider(provider_id).capabilities
    return {
        "provider": provider_id,
        "agent_spans": True,
        "session": True,
        "native_usage": True,
        "native_cost": capabilities.native_cost,
        "trace_url": capabilities.trace_url,
        "span_url": capabilities.span_url,
        "export_ack": "accepted",
    }
