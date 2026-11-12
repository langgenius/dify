from dify_trace_sdk.config import ProviderConfig, destination, http_url, name_or_default, secret
from pydantic import field_validator

DEFAULT_URL = "https://www.comet.com/opik/api/"
DEFAULT_PROJECT = "Default Project"


class OpikConfig(ProviderConfig):
    """Self-hosted Opik needs no API key; without a workspace, Opik uses the account's default one."""

    api_key: str | None = secret(default=None)
    project: str = DEFAULT_PROJECT
    workspace: str | None = None
    url: str = destination(default=DEFAULT_URL)

    @field_validator("project", mode="before")
    @classmethod
    def _project(cls, value: object) -> object:
        # Stored configurations hold null or blank for the default project.
        return name_or_default(value, DEFAULT_PROJECT) if value is None or isinstance(value, str) else value

    @field_validator("workspace")
    @classmethod
    def _workspace(cls, value: str | None) -> str | None:
        return (value.strip() or None) if value else None

    @field_validator("url")
    @classmethod
    def _url(cls, value: str) -> str:
        if not value.strip():
            return DEFAULT_URL
        url = http_url(value, allowed_schemes=("https", "http"))
        if not url.endswith("/api/"):
            raise ValueError("URL should end with /api/")
        return url
