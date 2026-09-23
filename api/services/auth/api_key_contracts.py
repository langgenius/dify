"""Framework-neutral data contracts for API key management."""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True, slots=True)
class ApiKeyRecord:
    id: str
    type: str
    token: str
    last_used_at: datetime | None = None
    created_at: datetime | None = None
    dataset_ids: tuple[str, ...] = ()


class ApiKeyCache(Protocol):
    def delete(self, token: str, scope: str | None = None) -> bool | None: ...


class ApiKeyResourceNotFoundError(Exception):
    pass


class ApiKeyNotFoundError(Exception):
    def __init__(self) -> None:
        super().__init__("API key not found")


class ApiKeyLimitExceededError(Exception):
    def __init__(self, max_keys: int) -> None:
        super().__init__(f"Cannot create more than {max_keys} API keys for this resource type.")
