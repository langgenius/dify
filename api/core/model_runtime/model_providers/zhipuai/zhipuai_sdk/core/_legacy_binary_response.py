from __future__ import annotations

import os
from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx


class HttpxResponseContent:
    @property
    def content(self) -> bytes:
        raise NotImplementedError("This method is not implemented for this class.")

    @property
    def text(self) -> str:
        raise NotImplementedError("This method is not implemented for this class.")

    @property
    def encoding(self) -> str | None:
        raise NotImplementedError("This method is not implemented for this class.")

    @property
    def charset_encoding(self) -> str | None:
        raise NotImplementedError("This method is not implemented for this class.")

    def json(self, **kwargs: Any) -> Any:
        raise NotImplementedError("This method is not implemented for this class.")

    def read(self) -> bytes:
        raise NotImplementedError("This method is not implemented for this class.")

    def iter_bytes(self, chunk_size: int | None = None) -> Iterator[bytes]:
        raise NotImplementedError("This method is not implemented for this class.")

    def iter_text(self, chunk_size: int | None = None) -> Iterator[str]:
        raise NotImplementedError("This method is not implemented for this class.")

    def iter_lines(self) -> Iterator[str]:
        raise NotImplementedError("This method is not implemented for this class.")

    def iter_raw(self, chunk_size: int | None = None) -> Iterator[bytes]:
        raise NotImplementedError("This method is not implemented for this class.")

    def write_to_file(
        self,
        file: str | os.PathLike[str],
    ) -> None:
        raise NotImplementedError("This method is not implemented for this class.")

    def stream_to_file(
        self,
        file: str | os.PathLike[str],
        *,
        chunk_size: int | None = None,
    ) -> None:
        raise NotImplementedError("This method is not implemented for this class.")

    def close(self) -> None:
        raise NotImplementedError("This method is not implemented for this class.")

    async def aread(self) -> bytes:
        raise NotImplementedError("This method is not implemented for this class.")

    async def aiter_bytes(self, chunk_size: int | None = None) -> AsyncIterator[bytes]:
        raise NotImplementedError("This method is not implemented for this class.")

    async def aiter_text(self, chunk_size: int | None = None) -> AsyncIterator[str]:
        raise NotImplementedError("This method is not implemented for this class.")

    async def aiter_lines(self) -> AsyncIterator[str]:
        raise NotImplementedError("This method is not implemented for this class.")

    async def aiter_raw(self, chunk_size: int | None = None) -> AsyncIterator[bytes]:
        raise NotImplementedError("This method is not implemented for this class.")

    async def astream_to_file(
        self,
        file: str | os.PathLike[str],
        *,
        chunk_size: int | None = None,
    ) -> None:
        raise NotImplementedError("This method is not implemented for this class.")

    async def aclose(self) -> None:
        raise NotImplementedError("This method is not implemented for this class.")


class HttpxBinaryResponseContent(HttpxResponseContent):
    response: httpx.Response

    def __init__(self, response: httpx.Response) -> None:
        self.response = response

    @property
    def content(self) -> bytes:
        return self.response.content

    @property
    def encoding(self) -> str | None:
        return self.response.encoding

    @property
    def charset_encoding(self) -> str | None:
        return self.response.charset_encoding

    def read(self) -> bytes:
        return self.response.read()

    def text(self) -> str:
        raise NotImplementedError("Not implemented for binary response content")

    def json(self, **kwargs: Any) -> Any:
        raise NotImplementedError("Not implemented for binary response content")

    def iter_text(self, chunk_size: int | None = None) -> Iterator[str]:
        raise NotImplementedError("Not implemented for binary response content")

    def iter_lines(self) -> Iterator[str]:
        raise NotImplementedError("Not implemented for binary response content")

    async def aiter_text(self, chunk_size: int | None = None) -> AsyncIterator[str]:
        raise NotImplementedError("Not implemented for binary response content")

    async def aiter_lines(self) -> AsyncIterator[str]:
        raise NotImplementedError("Not implemented for binary response content")

    def iter_bytes(self, chunk_size: int | None = None) -> Iterator[bytes]:
        return self.response.iter_bytes(chunk_size)

    def iter_raw(self, chunk_size: int | None = None) -> Iterator[bytes]:
        return self.response.iter_raw(chunk_size)

    def write_to_file(
        self,
        file: str | os.PathLike[str],
    ) -> None:
        """Write the output to the given file.

        Accepts a filename or any path-like object, e.g. pathlib.Path

        Note: if you want to stream the data to the file instead of writing
        all at once then you should use `.with_streaming_response` when making
        the API request, e.g. `client.with_streaming_response.foo().stream_to_file('my_filename.txt')`
        """
        with open(file, mode="wb") as f:
            for data in self.response.iter_bytes():
                f.write(data)

    def stream_to_file(
        self,
        file: str | os.PathLike[str],
        *,
        chunk_size: int | None = None,
    ) -> None:
        with open(file, mode="wb") as f:
            for data in self.response.iter_bytes(chunk_size):
                f.write(data)

    def close(self) -> None:
        return self.response.close()

    async def aread(self) -> bytes:
        return await self.response.aread()

    async def aiter_bytes(self, chunk_size: int | None = None) -> AsyncIterator[bytes]:
        return self.response.aiter_bytes(chunk_size)

    async def aiter_raw(self, chunk_size: int | None = None) -> AsyncIterator[bytes]:
        return self.response.aiter_raw(chunk_size)

    async def astream_to_file(
        self,
        file: str | os.PathLike[str],
        *,
        chunk_size: int | None = None,
    ) -> None:
        path = anyio.Path(file)
        async with await path.open(mode="wb") as f:
            async for data in self.response.aiter_bytes(chunk_size):
                await f.write(data)

    async def aclose(self) -> None:
        return await self.response.aclose()


class HttpxTextBinaryResponseContent(HttpxBinaryResponseContent):
    response: httpx.Response

    @property
    def text(self) -> str:
        return self.response.text

    def json(self, **kwargs: Any) -> Any:
        return self.response.json(**kwargs)

    def iter_text(self, chunk_size: int | None = None) -> Iterator[str]:
        return self.response.iter_text(chunk_size)

    def iter_lines(self) -> Iterator[str]:
        return self.response.iter_lines()

    async def aiter_text(self, chunk_size: int | None = None) -> AsyncIterator[str]:
        return self.response.aiter_text(chunk_size)

    async def aiter_lines(self) -> AsyncIterator[str]:
        return self.response.aiter_lines()
