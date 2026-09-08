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
    secret_keys: tuple[str, ...]


def get_provider_config_fields(provider_name: str) -> ProviderConfigFields:
    """Import only the selected configuration schema; retain no registry or client."""
    match provider_name:
        case "langfuse":
            from dify_trace_langfuse.config import LangfuseConfig

            return ProviderConfigFields(LangfuseConfig, ("public_key", "secret_key"))
        case "langsmith":
            from dify_trace_langsmith.config import LangSmithConfig

            return ProviderConfigFields(LangSmithConfig, ("api_key",))
        case "opik":
            from dify_trace_opik.config import OpikConfig

            return ProviderConfigFields(OpikConfig, ("api_key",))
        case "weave":
            from dify_trace_weave.config import WeaveConfig

            return ProviderConfigFields(WeaveConfig, ("api_key",))
        case "arize":
            from dify_trace_arize_phoenix.config import ArizeConfig

            return ProviderConfigFields(ArizeConfig, ("api_key", "space_id"))
        case "phoenix":
            from dify_trace_arize_phoenix.config import PhoenixConfig

            return ProviderConfigFields(PhoenixConfig, ("api_key",))
        case "aliyun":
            from dify_trace_aliyun.config import AliyunConfig

            return ProviderConfigFields(AliyunConfig, ("license_key",))
        case "mlflow":
            from dify_trace_mlflow.config import MLflowConfig

            return ProviderConfigFields(MLflowConfig, ("password",))
        case "databricks":
            from dify_trace_mlflow.config import DatabricksConfig

            return ProviderConfigFields(DatabricksConfig, ("personal_access_token", "client_secret"))
        case "tencent":
            from dify_trace_tencent.config import TencentConfig

            return ProviderConfigFields(TencentConfig, ("token",))
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
