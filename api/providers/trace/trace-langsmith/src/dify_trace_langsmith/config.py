from pydantic import ValidationInfo, field_validator

from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.utils import validate_url


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
