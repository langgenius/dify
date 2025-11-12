from enum import StrEnum

from pydantic import BaseModel, ValidationInfo, field_validator

from core.ops.utils import validate_project_name, validate_url, validate_url_with_path


class TracingProviderEnum(StrEnum):
    ARIZE = "arize"
    PHOENIX = "phoenix"
    LANGFUSE = "langfuse"
    LANGSMITH = "langsmith"
    OPIK = "opik"
    WEAVE = "weave"
    ALIYUN = "aliyun"
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


class ArizeConfig(BaseTracingConfig):
    """
    Model class for Arize tracing config.
    """

    api_key: str | None = None
    space_id: str | None = None
    project: str | None = None
    endpoint: str = "https://otlp.arize.com"

    @field_validator("project")
    @classmethod
    def project_validator(cls, v, info: ValidationInfo):
        return cls.validate_project_field(v, "default")

    @field_validator("endpoint")
    @classmethod
    def endpoint_validator(cls, v, info: ValidationInfo):
        return cls.validate_endpoint_url(v, "https://otlp.arize.com")


class PhoenixConfig(BaseTracingConfig):
    """
    Model class for Phoenix tracing config.
    """

    api_key: str | None = None
    project: str | None = None
    endpoint: str = "https://app.phoenix.arize.com"

    @field_validator("project")
    @classmethod
    def project_validator(cls, v, info: ValidationInfo):
        return cls.validate_project_field(v, "default")

    @field_validator("endpoint")
    @classmethod
    def endpoint_validator(cls, v, info: ValidationInfo):
        return validate_url_with_path(v, "https://app.phoenix.arize.com")


class LangfuseConfig(BaseTracingConfig):
    """
    Model class for Langfuse tracing config.
    """

    public_key: str
    secret_key: str
    host: str = "https://api.langfuse.com"

    @field_validator("host")
    @classmethod
    def host_validator(cls, v, info: ValidationInfo):
        return validate_url_with_path(v, "https://api.langfuse.com")


class LangSmithConfig(BaseTracingConfig):
    """
    Model class for Langsmith tracing config.
    """

    api_key: str
    project: str
    endpoint: str = "https://api.smith.langchain.com"

    @field_validator("endpoint")
    @classmethod
    def endpoint_validator(cls, v, info: ValidationInfo):
        # LangSmith only allows HTTPS
        return validate_url(v, "https://api.smith.langchain.com", allowed_schemes=("https",))


class OpikConfig(BaseTracingConfig):
    """
    Model class for Opik tracing config.
    """

    api_key: str | None = None
    project: str | None = None
    workspace: str | None = None
    url: str = "https://www.comet.com/opik/api/"

    @field_validator("project")
    @classmethod
    def project_validator(cls, v, info: ValidationInfo):
        return cls.validate_project_field(v, "Default Project")

    @field_validator("url")
    @classmethod
    def url_validator(cls, v, info: ValidationInfo):
        return validate_url_with_path(v, "https://www.comet.com/opik/api/", required_suffix="/api/")


class WeaveConfig(BaseTracingConfig):
    """
    Model class for Weave tracing config.
    """

    api_key: str
    entity: str | None = None
    project: str
    endpoint: str = "https://trace.wandb.ai"
    host: str | None = None

    @field_validator("endpoint")
    @classmethod
    def endpoint_validator(cls, v, info: ValidationInfo):
        # Weave only allows HTTPS for endpoint
        return validate_url(v, "https://trace.wandb.ai", allowed_schemes=("https",))

    @field_validator("host")
    @classmethod
    def host_validator(cls, v, info: ValidationInfo):
        if v is not None and v.strip() != "":
            return validate_url(v, v, allowed_schemes=("https", "http"))
        return v


class AliyunConfig(BaseTracingConfig):
    """
    Model class for Aliyun tracing config.
    """

    app_name: str = "dify_app"
    license_key: str
    endpoint: str

    @field_validator("app_name")
    @classmethod
    def app_name_validator(cls, v, info: ValidationInfo):
        return cls.validate_project_field(v, "dify_app")

    @field_validator("license_key")
    @classmethod
    def license_key_validator(cls, v, info: ValidationInfo):
        if not v or v.strip() == "":
            raise ValueError("License key cannot be empty")
        return v

    @field_validator("endpoint")
    @classmethod
    def endpoint_validator(cls, v, info: ValidationInfo):
        # aliyun uses two URL formats, which may include a URL path
        return validate_url_with_path(v, "https://tracing-analysis-dc-hz.aliyuncs.com")


class TencentConfig(BaseTracingConfig):
    """
    Tencent APM tracing config
    """

    token: str
    endpoint: str
    service_name: str

    @field_validator("token")
    @classmethod
    def token_validator(cls, v, info: ValidationInfo):
        if not v or v.strip() == "":
            raise ValueError("Token cannot be empty")
        return v

    @field_validator("endpoint")
    @classmethod
    def endpoint_validator(cls, v, info: ValidationInfo):
        return cls.validate_endpoint_url(v, "https://apm.tencentcloudapi.com")

    @field_validator("service_name")
    @classmethod
    def service_name_validator(cls, v, info: ValidationInfo):
        return cls.validate_project_field(v, "dify_app")


OPS_FILE_PATH = "ops_trace/"
OPS_TRACE_FAILED_KEY = "FAILED_OPS_TRACE"
