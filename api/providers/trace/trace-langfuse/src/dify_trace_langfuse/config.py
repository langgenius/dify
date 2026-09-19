import os
from typing import Any, override

from pydantic import ValidationInfo, field_validator

from core.ops.provider_config import BaseTracingConfig
from core.ops.utils import validate_url_with_path


class LangfuseConfig(BaseTracingConfig):
    """
    Model class for Langfuse tracing config.
    """

    public_key: str
    secret_key: str
    host: str = "https://cloud.langfuse.com"

    @classmethod
    @override
    def secret_fields(cls) -> tuple[str, ...]:
        return ("public_key", "secret_key")

    @classmethod
    @override
    def load_runtime_settings(cls, provider_config: dict[str, Any]) -> dict[str, Any]:
        return {"request_timeout": int(os.environ.get("LANGFUSE_TIMEOUT", "5"))}

    @field_validator("host")
    @classmethod
    def host_validator(cls, v, info: ValidationInfo):
        return validate_url_with_path(v, "https://cloud.langfuse.com")
