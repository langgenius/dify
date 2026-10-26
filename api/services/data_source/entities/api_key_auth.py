"""Framework- and persistence-independent contracts for data-source API-key auth."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(frozen=True, slots=True)
class DataSourceApiKeyAuthCredentials:
    auth_type: str
    api_key: str
    options: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class DataSourceApiKeyAuthBindingCreate:
    category: str
    provider: str
    credentials: DataSourceApiKeyAuthCredentials


@dataclass(frozen=True, slots=True)
class DataSourceApiKeyAuthBindingRecord:
    id: str
    category: str
    provider: str
    disabled: bool
    created_at: datetime
    updated_at: datetime
