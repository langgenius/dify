from pydantic import ValidationInfo, field_validator

from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.utils import validate_url_with_path


class OpikConfig(BaseTracingConfig):
    """
    Model class for Opik tracing config.
    """

    api_key: str | None = None
    project: str | None = None
    workspace: str | None = None
    url: str = "https://www.comet.com/opik/api/"

    @field_validator("project")
    @classmethod
    def project_validator(cls, v, info: ValidationInfo):
        return cls.validate_project_field(v, "Default Project")

    @field_validator("url")
    @classmethod
    def url_validator(cls, v, info: ValidationInfo):
        return validate_url_with_path(v, "https://www.comet.com/opik/api/", required_suffix="/api/")
