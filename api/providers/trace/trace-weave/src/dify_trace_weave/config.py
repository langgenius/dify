from pydantic import ValidationInfo, field_validator

from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.utils import validate_url


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
