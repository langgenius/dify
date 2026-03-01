from typing import Any, Protocol

import httpx

from core.workflow.file import File


class HttpClientProtocol(Protocol):
    @property
    def max_retries_exceeded_error(self) -> type[Exception]: ...

    @property
    def request_error(self) -> type[Exception]: ...

    def get(self, url: str, max_retries: int = ..., **kwargs: Any) -> httpx.Response: ...

    def head(self, url: str, max_retries: int = ..., **kwargs: Any) -> httpx.Response: ...

    def post(self, url: str, max_retries: int = ..., **kwargs: Any) -> httpx.Response: ...

    def put(self, url: str, max_retries: int = ..., **kwargs: Any) -> httpx.Response: ...

    def delete(self, url: str, max_retries: int = ..., **kwargs: Any) -> httpx.Response: ...

    def patch(self, url: str, max_retries: int = ..., **kwargs: Any) -> httpx.Response: ...


class FileManagerProtocol(Protocol):
    def download(self, f: File, /) -> bytes: ...


class ToolFileManagerProtocol(Protocol):
    def create_file_by_raw(
        self,
        *,
        user_id: str,
        tenant_id: str,
        conversation_id: str | None,
        file_binary: bytes,
        mimetype: str,
        filename: str | None = None,
    ) -> Any: ...
