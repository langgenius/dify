from abc import abstractmethod
from collections.abc import Mapping
from typing import Any, Protocol

from .response import HttpResponse


class HttpResponseProtocol(Protocol):
    @property
    @abstractmethod
    def headers(self) -> Mapping[str, str]: ...

    @property
    @abstractmethod
    def content(self) -> bytes: ...

    @property
    @abstractmethod
    def status_code(self) -> int: ...

    @property
    @abstractmethod
    def text(self) -> str: ...

    @property
    @abstractmethod
    def is_success(self) -> bool: ...

    @abstractmethod
    def raise_for_status(self) -> None: ...


class HttpClientProtocol(Protocol):
    @property
    @abstractmethod
    def max_retries_exceeded_error(self) -> type[Exception]: ...

    @property
    @abstractmethod
    def request_error(self) -> type[Exception]: ...

    @abstractmethod
    def get(self, url: str, max_retries: int = ..., **kwargs: Any) -> HttpResponse: ...

    @abstractmethod
    def head(self, url: str, max_retries: int = ..., **kwargs: Any) -> HttpResponse: ...

    @abstractmethod
    def post(self, url: str, max_retries: int = ..., **kwargs: Any) -> HttpResponse: ...

    @abstractmethod
    def put(self, url: str, max_retries: int = ..., **kwargs: Any) -> HttpResponse: ...

    @abstractmethod
    def delete(
        self,
        url: str,
        max_retries: int = ...,
        **kwargs: Any,
    ) -> HttpResponse: ...

    @abstractmethod
    def patch(
        self,
        url: str,
        max_retries: int = ...,
        **kwargs: Any,
    ) -> HttpResponse: ...
