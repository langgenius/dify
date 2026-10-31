from dify_trace_sdk.config import ProviderConfig, derived, destination, http_url, secret
from pydantic import field_validator

DEFAULT_HOST = "https://api.langfuse.com"


class LangfuseConfig(ProviderConfig):
    public_key: str = secret()
    secret_key: str = secret()
    host: str = destination(default=DEFAULT_HOST)
    project_key: str | None = derived()
    # Older configurations stored the verified URL instead of the project ID.
    project_url: str | None = derived()

    @field_validator("host")
    @classmethod
    def _host(cls, value: str) -> str:
        return http_url(value, allowed_schemes=("https", "http")) if value.strip() else DEFAULT_HOST

    @field_validator("project_url")
    @classmethod
    def _project_url(cls, value: str | None) -> str | None:
        return http_url(value, allowed_schemes=("https", "http")) if value and value.strip() else None
