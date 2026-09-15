from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from pydantic import BaseModel

from core.ops.utils import validate_project_name, validate_url


class TracingProviderEnum(StrEnum):
    ARIZE = "arize"
    PHOENIX = "phoenix"
    LANGFUSE = "langfuse"
    LANGSMITH = "langsmith"
    OPIK = "opik"
    WEAVE = "weave"
    ALIYUN = "aliyun"
    MLFLOW = "mlflow"
    DATABRICKS = "databricks"
    TENCENT = "tencent"


class BaseTracingConfig(BaseModel):
    """
    Base model class for tracing configurations
    """

    @classmethod
    def secret_fields(cls) -> tuple[str, ...]:
        raise NotImplementedError

    @classmethod
    def load_runtime_settings(cls, provider_config: dict[str, Any]) -> dict[str, Any]:
        """Capture provider-owned deployment settings without constructing an export client."""
        return {}

    @classmethod
    def runtime_settings_for_identity(cls, runtime_settings: dict[str, Any]) -> dict[str, Any]:
        """Bind all runtime settings unless a provider identifies renewable credentials by their source.

        Providers must retain the effective authentication source and destination
        settings when excluding issued tokens. Do not mutate the captured settings.
        """
        return runtime_settings

    @classmethod
    def validate_endpoint_url(cls, v: str, default_url: str) -> str:
        """
        Common endpoint URL validation logic

        Args:
            v: URL value to validate
            default_url: Default URL to use if input is None or empty

        Returns:
            Validated and normalized URL
        """
        return validate_url(v, default_url)

    @classmethod
    def validate_project_field(cls, v: str, default_name: str) -> str:
        """
        Common project name validation logic

        Args:
            v: Project name to validate
            default_name: Default name to use if input is None or empty

        Returns:
            Validated project name
        """
        return validate_project_name(v, default_name)


@dataclass(frozen=True)
class ProviderConfigFields:
    config_class: type[BaseTracingConfig]

    @property
    def secret_keys(self) -> tuple[str, ...]:
        return self.config_class.secret_fields()


def get_provider_config_fields(provider_name: str) -> ProviderConfigFields:
    """Import only the selected configuration schema; retain no registry or client."""
    match provider_name:
        case "langfuse":
            from dify_trace_langfuse.config import LangfuseConfig

            return ProviderConfigFields(LangfuseConfig)
        case "langsmith":
            from dify_trace_langsmith.config import LangSmithConfig

            return ProviderConfigFields(LangSmithConfig)
        case "opik":
            from dify_trace_opik.config import OpikConfig

            return ProviderConfigFields(OpikConfig)
        case "weave":
            from dify_trace_weave.config import WeaveConfig

            return ProviderConfigFields(WeaveConfig)
        case "arize":
            from dify_trace_arize_phoenix.config import ArizeConfig

            return ProviderConfigFields(ArizeConfig)
        case "phoenix":
            from dify_trace_arize_phoenix.config import PhoenixConfig

            return ProviderConfigFields(PhoenixConfig)
        case "aliyun":
            from dify_trace_aliyun.config import AliyunConfig

            return ProviderConfigFields(AliyunConfig)
        case "mlflow":
            from dify_trace_mlflow.config import MLflowConfig

            return ProviderConfigFields(MLflowConfig)
        case "databricks":
            from dify_trace_mlflow.config import DatabricksConfig

            return ProviderConfigFields(DatabricksConfig)
        case "tencent":
            from dify_trace_tencent.config import TencentConfig

            return ProviderConfigFields(TencentConfig)
        case _:
            raise ValueError(f"Unsupported tracing provider: {provider_name}")


def encrypt_provider_config(
    tenant_id: str, provider_name: str, settings: dict[str, Any], previous: dict[str, Any] | None = None
) -> dict[str, Any]:
    from core.helper.encrypter import encrypt_token

    fields = get_provider_config_fields(provider_name)
    encrypted = fields.config_class.model_validate(settings).model_dump()
    for key in fields.secret_keys:
        value = encrypted.get(key)
        if value is None:
            continue
        if isinstance(value, str) and "*" in value and previous and key in previous:
            encrypted[key] = previous[key]
        else:
            encrypted[key] = encrypt_token(tenant_id, value)
    return encrypted


def resolve_provider_config(provider_name: str, settings: dict[str, Any]) -> dict[str, Any]:
    """Capture deployment settings for identity checks and one owned export attempt without persisting them."""
    resolved = {key: value for key, value in settings.items() if key != "_runtime_settings"}
    runtime_settings = get_provider_config_fields(provider_name).config_class.load_runtime_settings(resolved)
    if runtime_settings:
        resolved["_runtime_settings"] = runtime_settings
    return resolved


def provider_config_identity(provider_name: str, resolved_config: dict[str, Any]) -> dict[str, Any]:
    """Select provider-owned identity fields without changing its attempt credentials."""
    identity = dict(resolved_config)
    if "_runtime_settings" in identity:
        schema = get_provider_config_fields(provider_name).config_class
        identity["_runtime_settings"] = schema.runtime_settings_for_identity(identity["_runtime_settings"])
    return identity


def decrypt_provider_config(tenant_id: str, provider_name: str, settings: dict[str, Any]) -> dict[str, Any]:
    from core.helper.encrypter import batch_decrypt_token

    fields = get_provider_config_fields(provider_name)
    decrypted = dict(settings)
    keys = [key for key in fields.secret_keys if settings.get(key)]
    values = batch_decrypt_token(tenant_id, [settings[key] for key in keys]) if keys else []
    decrypted.update(zip(keys, values))
    return fields.config_class.model_validate(decrypted).model_dump()


def mask_provider_config(provider_name: str, settings: dict[str, Any]) -> dict[str, Any]:
    from core.helper.encrypter import obfuscated_token

    masked = dict(settings)
    for key in get_provider_config_fields(provider_name).secret_keys:
        if masked.get(key):
            masked[key] = obfuscated_token(masked[key])
    return masked
