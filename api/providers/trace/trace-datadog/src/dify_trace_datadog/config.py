from pydantic import ValidationInfo, field_validator

from core.ops.entities.config_entity import BaseTracingConfig
from dify_trace_datadog.constants import DEFAULT_DD_SITE, DEFAULT_SERVICE_NAME, UNSUPPORTED_DD_SITES


class DatadogConfig(BaseTracingConfig):
    """
    Datadog LLM observability tracing config.
    """

    api_key: str
    site: str = DEFAULT_DD_SITE
    service_name: str = DEFAULT_SERVICE_NAME

    @field_validator("api_key")
    @classmethod
    def api_key_validator(cls, v, info: ValidationInfo):
        if not v or not v.strip():
            raise ValueError("api_key is required")
        return v.strip()

    @field_validator("site")
    @classmethod
    def site_validator(cls, v, info: ValidationInfo):
        v = v.strip() if v else DEFAULT_DD_SITE
        if not v:
            return DEFAULT_DD_SITE
        if "/" in v or ":" in v:
            raise ValueError("site must be a hostname (e.g. datadoghq.com), not a URL")
        if v.lower() in UNSUPPORTED_DD_SITES:
            raise ValueError(f"site is not supported: {v}")
        return v

    @field_validator("service_name")
    @classmethod
    def service_name_validator(cls, v, info: ValidationInfo):
        return cls.validate_project_field(v, DEFAULT_SERVICE_NAME)
