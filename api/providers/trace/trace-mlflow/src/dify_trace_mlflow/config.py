from urllib.parse import urlsplit

from dify_trace_sdk.config import ProviderConfig, destination, http_url, integer_id, secret
from pydantic import field_validator

DEFAULT_TRACKING_URI = "http://localhost:5000"


class MLflowConfig(ProviderConfig):
    tracking_uri: str = destination(default=DEFAULT_TRACKING_URI)
    experiment_id: str = "0"
    username: str | None = None
    password: str | None = secret(default=None)

    @field_validator("tracking_uri")
    @classmethod
    def _tracking_uri(cls, value: str) -> str:
        if not value.strip():
            return DEFAULT_TRACKING_URI
        if value.strip().startswith("databricks"):
            raise ValueError("Use the Databricks provider for Databricks-managed MLflow")
        url = http_url(value, allowed_schemes=("https", "http"))
        return url if url.endswith("//") else url.removesuffix("/")

    @field_validator("experiment_id")
    @classmethod
    def _experiment_id(cls, value: str) -> str:
        return integer_id(value)


class DatabricksConfig(ProviderConfig):
    experiment_id: str
    host: str = destination()
    client_id: str | None = None
    client_secret: str | None = secret(default=None)
    personal_access_token: str | None = secret(default=None)

    @field_validator("host")
    @classmethod
    def _host(cls, value: str) -> str:
        """Normalize workspace origins; preserve invalid paths and queries for verification."""
        url = value.strip()
        return url.removesuffix("/") if urlsplit(url).path == "/" and "?" not in url and "#" not in url else url

    @field_validator("experiment_id")
    @classmethod
    def _experiment_id(cls, value: str) -> str:
        return integer_id(value)
