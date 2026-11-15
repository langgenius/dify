from pydantic import ValidationInfo, field_validator

from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.utils import validate_integer_id, validate_url_with_path


class MLflowConfig(BaseTracingConfig):
    """
    Model class for MLflow tracing config.
    """

    tracking_uri: str = "http://localhost:5000"
    experiment_id: str = "0"  # Default experiment id in MLflow is 0
    username: str | None = None
    password: str | None = None

    @field_validator("tracking_uri")
    @classmethod
    def tracking_uri_validator(cls, v, info: ValidationInfo):
        if isinstance(v, str) and v.startswith("databricks"):
            raise ValueError(
                "Please use Databricks tracing config below to record traces to Databricks-managed MLflow instances."
            )
        return validate_url_with_path(v, "http://localhost:5000")

    @field_validator("experiment_id")
    @classmethod
    def experiment_id_validator(cls, v, info: ValidationInfo):
        return validate_integer_id(v)


class DatabricksConfig(BaseTracingConfig):
    """
    Model class for Databricks (Databricks-managed MLflow) tracing config.
    """

    experiment_id: str
    host: str
    client_id: str | None = None
    client_secret: str | None = None
    personal_access_token: str | None = None

    @field_validator("experiment_id")
    @classmethod
    def experiment_id_validator(cls, v, info: ValidationInfo):
        return validate_integer_id(v)
