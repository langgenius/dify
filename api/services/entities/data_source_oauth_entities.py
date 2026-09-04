"""Framework-neutral data contracts for OAuth data-source integrations."""

from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class DataSourceOAuthAuthorization:
    access_token: str
    source_info: Mapping[str, object]


@dataclass(frozen=True, slots=True)
class DataSourceOAuthCallback:
    provider: str
    code: str | None
    error: str | None


@dataclass(frozen=True, slots=True)
class DataSourceOAuthBindingRecord:
    id: str
    access_token: str
    source_info: Mapping[str, object]
