from pydantic import ValidationInfo, field_validator

from core.ops.entities.config_entity import BaseTracingConfig


class TencentConfig(BaseTracingConfig):
    """
    Tencent APM tracing config
    """

    token: str
    endpoint: str
    service_name: str

    @field_validator("token")
    @classmethod
    def token_validator(cls, v, info: ValidationInfo):
        if not v or v.strip() == "":
            raise ValueError("Token cannot be empty")
        return v

    @field_validator("endpoint")
    @classmethod
    def endpoint_validator(cls, v, info: ValidationInfo):
        return cls.validate_endpoint_url(v, "https://apm.tencentcloudapi.com")

    @field_validator("service_name")
    @classmethod
    def service_name_validator(cls, v, info: ValidationInfo):
        return cls.validate_project_field(v, "dify_app")
