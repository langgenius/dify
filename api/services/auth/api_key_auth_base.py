from abc import ABC, abstractmethod

from typing_extensions import TypedDict


class ApiKeyAuthConfig(TypedDict, total=False):
    api_key: str
    base_url: str


class ApiKeyAuthCredentials(TypedDict):
    auth_type: object
    config: ApiKeyAuthConfig


class ApiKeyAuthBase(ABC):
    credentials: ApiKeyAuthCredentials

    def __init__(self, credentials: ApiKeyAuthCredentials) -> None:
        self.credentials = credentials

    @abstractmethod
    def validate_credentials(self) -> bool:
        raise NotImplementedError
