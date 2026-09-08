from pydantic import ValidationInfo, field_validator

from core.ops.provider_config import BaseTracingConfig
from core.ops.utils import validate_url_with_path


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
