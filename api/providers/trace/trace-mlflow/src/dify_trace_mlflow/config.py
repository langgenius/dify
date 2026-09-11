import os
from typing import Any, override
from urllib.parse import urlsplit

from pydantic import ValidationInfo, field_validator

from core.helper.ssl_context import read_tls_files
from core.ops.provider_config import BaseTracingConfig
from core.ops.utils import validate_integer_id, validate_url_with_path


class MLflowConfig(BaseTracingConfig):
    """
    Model class for MLflow tracing config.
    """

    tracking_uri: str = "http://localhost:5000"
    experiment_id: str = "0"  # Default experiment id in MLflow is 0
    username: str | None = None
    password: str | None = None

    @classmethod
    @override
    def secret_fields(cls) -> tuple[str, ...]:
        return ("password",)

    @classmethod
    @override
    def load_runtime_settings(cls, provider_config: dict[str, Any]) -> dict[str, Any]:
        insecure_tls = os.environ.get("MLFLOW_TRACKING_INSECURE_TLS", "false").lower()
        if insecure_tls not in {"true", "false", "1", "0"}:
            raise ValueError("Invalid MLflow TLS verification setting")
        verify = insecure_tls in {"false", "0"}
        certificate = os.environ.get("MLFLOW_TRACKING_SERVER_CERT_PATH")
        if not verify and certificate is not None:
            raise ValueError("MLflow TLS verification cannot be disabled with a server certificate configured")
        if urlsplit(cls.model_validate(provider_config).tracking_uri).scheme == "http":
            return {}
        # The SDK passes an explicitly blank CA path to Requests as verify="".
        verify = verify and certificate != ""
        if certificate is None and verify:
            certificate = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("CURL_CA_BUNDLE")
        return {
            "verify": verify,
            "tls": read_tls_files(
                {
                    "certificate": certificate,
                    # Requests accepts a PEM containing both the certificate and key.
                    "client_certificate": os.environ.get("MLFLOW_TRACKING_CLIENT_CERT_PATH"),
                },
                allow_ca_directory=True,
            ),
        }

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

    @classmethod
    @override
    def secret_fields(cls) -> tuple[str, ...]:
        return ("personal_access_token", "client_secret")

    @field_validator("experiment_id")
    @classmethod
    def experiment_id_validator(cls, v, info: ValidationInfo):
        return validate_integer_id(v)
