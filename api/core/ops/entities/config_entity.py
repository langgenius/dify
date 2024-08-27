from enum import Enum

from pydantic import BaseModel, ValidationInfo, field_validator


class TracingProviderEnum(Enum):
    LANGFUSE = 'langfuse'
    LANGSMITH = 'langsmith'


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
    host: str = 'https://api.langfuse.com'

    @field_validator("host")
    def set_value(cls, v, info: ValidationInfo):
        if v is None or v == "":
            v = 'https://api.langfuse.com'
        if not v.startswith('https://') and not v.startswith('http://'):
            raise ValueError('host must start with https:// or http://')

        return v


class LangSmithConfig(BaseTracingConfig):
    """
    Model class for Langsmith tracing config.
    """
    api_key: str
    project: str
    endpoint: str = 'https://api.smith.langchain.com'

    @field_validator("endpoint")
    def set_value(cls, v, info: ValidationInfo):
        if v is None or v == "":
            v = 'https://api.smith.langchain.com'
        if not v.startswith('https://'):
            raise ValueError('endpoint must start with https://')

        return v
