from enum import Enum

from pydantic import BaseModel, ValidationInfo, field_validator


class TracingProviderEnum(Enum):
    LANGFUSE = "langfuse"
    LANGSMITH = "langsmith"
    OPIK = "opik"


class BaseTracingConfig(BaseModel):
    """
    Base model class for tracing
    """

    ...


class LangfuseConfig(BaseTracingConfig):
    """
    Model class for Langfuse tracing config.
    """

    public_key: str
    secret_key: str
    host: str = "https://api.langfuse.com"

    @field_validator("host")
    @classmethod
    def set_value(cls, v, info: ValidationInfo):
        if v is None or v == "":
            v = "https://api.langfuse.com"
        if not v.startswith("https://") and not v.startswith("http://"):
            raise ValueError("host must start with https:// or http://")

        return v


class LangSmithConfig(BaseTracingConfig):
    """
    Model class for Langsmith tracing config.
    """

    api_key: str
    project: str
    endpoint: str = "https://api.smith.langchain.com"

    @field_validator("endpoint")
    @classmethod
    def set_value(cls, v, info: ValidationInfo):
        if v is None or v == "":
            v = "https://api.smith.langchain.com"
        if not v.startswith("https://"):
            raise ValueError("endpoint must start with https://")

        return v


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
        if v is None or v == "":
            v = "Default Project"

        return v

    @field_validator("url")
    @classmethod
    def url_validator(cls, v, info: ValidationInfo):
        if v is None or v == "":
            v = "https://www.comet.com/opik/api/"
        if not v.startswith(("https://", "http://")):
            raise ValueError("url must start with https:// or http://")
        if not v.endswith("/api/"):
            raise ValueError("url should ends with /api/")

        return v


OPS_FILE_PATH = "ops_trace/"
OPS_TRACE_FAILED_KEY = "FAILED_OPS_TRACE"
