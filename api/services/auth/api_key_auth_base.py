from abc import ABC, abstractmethod
from typing import Any

from typing_extensions import TypedDict


class AuthCredentials(TypedDict):
    auth_type: str
    config: dict[str, Any]


class ApiKeyAuthBase(ABC):
    def __init__(self, credentials: AuthCredentials):
        self.credentials = credentials

    @abstractmethod
    def validate_credentials(self):
        raise NotImplementedError
