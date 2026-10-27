"""Phoenix and Arize configurations.

Field names match the configurations Dify stored before this package used the
provider SDK, so stored records keep loading; keys these models no longer
declare, such as a stored ``project_url``, are ignored.
"""

from urllib.parse import urlsplit, urlunsplit

from dify_trace_sdk.config import ProviderConfig, derived, destination, http_url, name_or_default, secret
from pydantic import field_validator

DEFAULT_PROJECT = "default"
PHOENIX_DEFAULT_ENDPOINT = "https://app.phoenix.arize.com"
ARIZE_DEFAULT_ENDPOINT = "https://otlp.arize.com"
_SCHEMES = ("https", "http")


def _project_or_default(value: object) -> object:
    # Stored records may hold ``None`` for the project.
    return name_or_default(value, DEFAULT_PROJECT) if value is None or isinstance(value, str) else value


class PhoenixConfig(ProviderConfig):
    api_key: str | None = secret(default=None)
    """Optional: self-hosted Phoenix may run without authentication."""
    project: str = DEFAULT_PROJECT
    endpoint: str = destination(default=PHOENIX_DEFAULT_ENDPOINT)
    """The Phoenix base URL. A path prefix, such as a Phoenix Cloud space, is kept."""

    @field_validator("project", mode="before")
    @classmethod
    def _project(cls, value: object) -> object:
        return _project_or_default(value)

    @field_validator("endpoint")
    @classmethod
    def _endpoint(cls, value: str) -> str:
        return http_url(value, allowed_schemes=_SCHEMES) if value.strip() else PHOENIX_DEFAULT_ENDPOINT


class ArizeConfig(ProviderConfig):
    api_key: str = secret()
    space_id: str = secret()
    project: str = DEFAULT_PROJECT
    endpoint: str = destination(default=ARIZE_DEFAULT_ENDPOINT)
    """The OTLP/gRPC collector. gRPC addresses a host, so a path is dropped as it always was."""
    arize_project_destination: dict[str, str] | None = derived()
    """The Arize Cloud project verification found, with the endpoint, space, and project it was found for.

    Records saved before this package used the provider SDK also carry a
    ``source_digest`` key; ``project_url`` ignores it and compares the
    destination with the configuration instead.
    """

    @field_validator("project", mode="before")
    @classmethod
    def _project(cls, value: object) -> object:
        return _project_or_default(value)

    @field_validator("endpoint")
    @classmethod
    def _endpoint(cls, value: str) -> str:
        if not value.strip():
            return ARIZE_DEFAULT_ENDPOINT
        parsed = urlsplit(http_url(value, allowed_schemes=_SCHEMES))
        return urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))
