from enum import StrEnum

from pydantic import BaseModel, ValidationInfo, field_validator

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
    DATADOG = "datadog"


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


class DatadogConfig(BaseTracingConfig):
    """
    Datadog LLM observability tracing config.
    """

    api_key: str = ""
    site: str = "datadoghq.com"
    service_name: str = "dify_app"

    @field_validator("api_key")
    @classmethod
    def api_key_validator(cls, v, info: ValidationInfo):
        if not v or not v.strip():
            raise ValueError("api_key is required")
        return v.strip()

    @field_validator("site")
    @classmethod
    def site_validator(cls, v, info: ValidationInfo):
        v = v.strip() if v else "datadoghq.com"
        if not v:
            return "datadoghq.com"
        if "/" in v or ":" in v:
            raise ValueError("site must be a hostname (e.g. datadoghq.com), not a URL")
        return v

    @field_validator("service_name")
    @classmethod
    def service_name_validator(cls, v, info: ValidationInfo):
        return cls.validate_project_field(v, "dify_app")


OPS_FILE_PATH = "ops_trace/"
OPS_TRACE_FAILED_KEY = "FAILED_OPS_TRACE"
