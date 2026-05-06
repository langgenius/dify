from pydantic import ValidationInfo, field_validator

from core.ops.entities.config_entity import BaseTracingConfig


class DatadogConfig(BaseTracingConfig):
    """
    Datadog LLM observability tracing config.
    """

    api_key: str
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
