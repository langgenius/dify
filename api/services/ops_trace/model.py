from enum import Enum

from pydantic import BaseModel


class TracingProviderEnum(Enum):
    LANGFUSE = 'langfuse'
    LANGSMITH = 'langsmith'


class LangfuseConfig(BaseModel):
    """
    Model class for Langfuse tracing config.
    """
    public_key: str
    secret_key: str
    host: str


class LangSmithConfig(BaseModel):
    """
    Model class for Langsmith tracing config.
    """
    api_key: str
    project: str
    endpoint: str
