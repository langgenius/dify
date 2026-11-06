from urllib.parse import urlsplit

from dify_trace_sdk.config import ProviderConfig, destination, http_url, secret
from pydantic import field_validator

DEFAULT_ENDPOINT = "https://trace.wandb.ai"
DEFAULT_HOST = "https://api.wandb.ai"


def _base_url(value: str, allowed_schemes: tuple[str, ...]) -> str:
    """Validate a URL that request paths are appended to, keeping its path prefix."""
    url = http_url(value, allowed_schemes=allowed_schemes)
    if any(char in "?#\\" or ord(char) <= 32 or ord(char) == 127 for char in url):
        raise ValueError("URL must not contain a query, a fragment, whitespace, or backslashes")
    try:
        _ = urlsplit(url).port
    except ValueError:
        raise ValueError("URL port is invalid") from None
    return url


class WeaveConfig(ProviderConfig):
    api_key: str = secret()
    entity: str | None = None
    """The W&B team or user; ``verify`` resolves the API key's default entity when it is unset."""
    project: str
    """A project name, or ``entity/project`` when ``entity`` is unset."""
    endpoint: str = destination(default=DEFAULT_ENDPOINT)
    """The Weave trace server."""
    host: str | None = destination(default=None)
    """The W&B API host, ``DEFAULT_HOST`` when unset."""

    @field_validator("endpoint")
    @classmethod
    def _endpoint(cls, value: str) -> str:
        return _base_url(value, ("https",)) if value.strip() else DEFAULT_ENDPOINT

    @field_validator("host")
    @classmethod
    def _host(cls, value: str | None) -> str | None:
        return _base_url(value, ("https", "http")) if value and value.strip() else None
