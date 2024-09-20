from __future__ import annotations

import datetime
from typing import TYPE_CHECKING, Any, Generic, TypeVar, cast, get_args, get_origin

import httpx
import pydantic
from typing_extensions import ParamSpec

from ._base_type import NoneType
from ._sse_client import StreamResponse

if TYPE_CHECKING:
    from ._http_client import HttpClient

P = ParamSpec("P")
R = TypeVar("R")


class HttpResponse(Generic[R]):
    _cast_type: type[R]
    _client: HttpClient
    _parsed: R | None
    _enable_stream: bool
    _stream_cls: type[StreamResponse[Any]]
    http_response: httpx.Response

    def __init__(
        self,
        *,
        raw_response: httpx.Response,
        cast_type: type[R],
        client: HttpClient,
        enable_stream: bool = False,
        stream_cls: type[StreamResponse[Any]] | None = None,
    ) -> None:
        self._cast_type = cast_type
        self._client = client
        self._parsed = None
        self._stream_cls = stream_cls
        self._enable_stream = enable_stream
        self.http_response = raw_response

    def parse(self) -> R:
        self._parsed = self._parse()
        return self._parsed

    def _parse(self) -> R:
        if self._enable_stream:
            self._parsed = cast(
                R,
                self._stream_cls(
                    cast_type=cast(type, get_args(self._stream_cls)[0]),
                    response=self.http_response,
                    client=self._client,
                ),
            )
            return self._parsed
        cast_type = self._cast_type
        if cast_type is NoneType:
            return cast(R, None)
        http_response = self.http_response
        if cast_type == str:
            return cast(R, http_response.text)

        content_type, *_ = http_response.headers.get("content-type", "application/json").split(";")
        origin = get_origin(cast_type) or cast_type
        if content_type != "application/json":
            if issubclass(origin, pydantic.BaseModel):
                data = http_response.json()
                return self._client._process_response_data(
                    data=data,
                    cast_type=cast_type,  # type: ignore
                    response=http_response,
                )

            return http_response.text

        data = http_response.json()

        return self._client._process_response_data(
            data=data,
            cast_type=cast_type,  # type: ignore
            response=http_response,
        )

    @property
    def headers(self) -> httpx.Headers:
        return self.http_response.headers

    @property
    def http_request(self) -> httpx.Request:
        return self.http_response.request

    @property
    def status_code(self) -> int:
        return self.http_response.status_code

    @property
    def url(self) -> httpx.URL:
        return self.http_response.url

    @property
    def method(self) -> str:
        return self.http_request.method

    @property
    def content(self) -> bytes:
        return self.http_response.content

    @property
    def text(self) -> str:
        return self.http_response.text

    @property
    def http_version(self) -> str:
        return self.http_response.http_version

    @property
    def elapsed(self) -> datetime.timedelta:
        return self.http_response.elapsed
