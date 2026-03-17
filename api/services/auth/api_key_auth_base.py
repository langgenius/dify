from abc import ABC, abstractmethod
from typing import Annotated, NotRequired

from typing_extensions import TypedDict

from pydantic import StringConstraints

NonEmptyString = Annotated[str, StringConstraints(min_length=1)]


class ApiKeyAuthConfig(TypedDict):
    api_key: NotRequired[str]
    base_url: NotRequired[str]


class ApiKeyAuthCredentials(TypedDict):
    auth_type: NonEmptyString
    config: ApiKeyAuthConfig


class ApiKeyAuthBase(ABC):
    credentials: ApiKeyAuthCredentials

    def __init__(self, credentials: ApiKeyAuthCredentials) -> None:
        self.credentials = credentials

    @abstractmethod
    def validate_credentials(self) -> bool:
        raise NotImplementedError
