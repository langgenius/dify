from pydantic import ValidationInfo, field_validator

from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.utils import validate_url_with_path


class AliyunConfig(BaseTracingConfig):
    """
    Model class for Aliyun tracing config.
    """

    app_name: str = "dify_app"
    license_key: str
    endpoint: str

    @field_validator("app_name")
    @classmethod
    def app_name_validator(cls, v, info: ValidationInfo):
        return cls.validate_project_field(v, "dify_app")

    @field_validator("license_key")
    @classmethod
    def license_key_validator(cls, v, info: ValidationInfo):
        if not v or v.strip() == "":
            raise ValueError("License key cannot be empty")
        return v

    @field_validator("endpoint")
    @classmethod
    def endpoint_validator(cls, v, info: ValidationInfo):
        # aliyun uses two URL formats, which may include a URL path
        return validate_url_with_path(v, "https://tracing-analysis-dc-hz.aliyuncs.com")
