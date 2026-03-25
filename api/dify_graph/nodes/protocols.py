from collections.abc import Generator
from typing import Any, Protocol

import httpx

from dify_graph.file import File
from dify_graph.file.models import ToolFile


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

    def get_file_generator_by_tool_file_id(self, tool_file_id: str) -> tuple[Generator | None, ToolFile | None]: ...
