from typing import Protocol, runtime_checkable

import httpx

from core.file import File


@runtime_checkable
class HttpClientProtocol(Protocol):
    @property
    def max_retries_exceeded_error(self) -> type[Exception]: ...

    @property
    def request_error(self) -> type[Exception]: ...

    def get(self, url: str, max_retries: int = ..., **kwargs: object) -> httpx.Response: ...

    def head(self, url: str, max_retries: int = ..., **kwargs: object) -> httpx.Response: ...

    def post(self, url: str, max_retries: int = ..., **kwargs: object) -> httpx.Response: ...

    def put(self, url: str, max_retries: int = ..., **kwargs: object) -> httpx.Response: ...

    def delete(self, url: str, max_retries: int = ..., **kwargs: object) -> httpx.Response: ...

    def patch(self, url: str, max_retries: int = ..., **kwargs: object) -> httpx.Response: ...


@runtime_checkable
class FileManagerProtocol(Protocol):
    def download(self, f: File, /) -> bytes: ...
