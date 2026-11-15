from pydantic import ValidationInfo, field_validator

from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.utils import validate_url_with_path


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
