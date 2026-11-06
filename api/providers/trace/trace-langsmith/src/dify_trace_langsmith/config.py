from dify_trace_sdk.config import ProviderConfig, derived, destination, http_url, secret
from pydantic import field_validator

DEFAULT_ENDPOINT = "https://api.smith.langchain.com"


class LangSmithConfig(ProviderConfig):
    api_key: str = secret()
    project: str
    endpoint: str = destination(default=DEFAULT_ENDPOINT)
    project_url: str | None = derived()

    @field_validator("api_key")
    @classmethod
    def _api_key(cls, value: str) -> str:
        # The SDK strips the key before exporting; verification must send the same value.
        key = value.strip()
        if not key:
            raise ValueError("API key is required")
        return key

    @field_validator("project")
    @classmethod
    def _project(cls, value: str) -> str:
        # The SDK replaces an empty project name with the host's LANGSMITH_PROJECT.
        if not value.strip():
            raise ValueError("Project name is required")
        return value

    @field_validator("endpoint")
    @classmethod
    def _endpoint(cls, value: str) -> str:
        # LangSmith is HTTPS-only; self-hosted deployments may serve the API under a path prefix.
        return http_url(value, allowed_schemes=("https",)) if value.strip() else DEFAULT_ENDPOINT
