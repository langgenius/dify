from __future__ import annotations

import datetime
import functools
import inspect
import logging
from collections.abc import Callable
from typing import TYPE_CHECKING, Any, Generic, TypeVar, Union, cast, get_origin, overload

import httpx
import pydantic
from typing_extensions import ParamSpec, override

from ._base_models import BaseModel, is_basemodel
from ._base_type import NoneType
from ._constants import RAW_RESPONSE_HEADER
from ._errors import APIResponseValidationError
from ._legacy_binary_response import HttpxResponseContent, HttpxTextBinaryResponseContent
from ._sse_client import StreamResponse, extract_stream_chunk_type, is_stream_class_type
from ._utils import extract_type_arg, is_annotated_type, is_given

if TYPE_CHECKING:
    from ._http_client import HttpClient
    from ._request_opt import FinalRequestOptions

P = ParamSpec("P")
R = TypeVar("R")
_T = TypeVar("_T")

log: logging.Logger = logging.getLogger(__name__)


class LegacyAPIResponse(Generic[R]):
    """This is a legacy class as it will be replaced by `APIResponse`
    and `AsyncAPIResponse` in the `_response.py` file in the next major
    release.

    For the sync client this will mostly be the same with the exception
    of `content` & `text` will be methods instead of properties. In the
    async client, all methods will be async.

    A migration script will be provided & the migration in general should
    be smooth.
    """

    _cast_type: type[R]
    _client: HttpClient
    _parsed_by_type: dict[type[Any], Any]
    _stream: bool
    _stream_cls: type[StreamResponse[Any]] | None
    _options: FinalRequestOptions

    http_response: httpx.Response

    def __init__(
        self,
        *,
        raw: httpx.Response,
        cast_type: type[R],
        client: HttpClient,
        stream: bool,
        stream_cls: type[StreamResponse[Any]] | None,
        options: FinalRequestOptions,
    ) -> None:
        self._cast_type = cast_type
        self._client = client
        self._parsed_by_type = {}
        self._stream = stream
        self._stream_cls = stream_cls
        self._options = options
        self.http_response = raw

    @property
    def request_id(self) -> str | None:
        return self.http_response.headers.get("x-request-id")  # type: ignore[no-any-return]

    @overload
    def parse(self, *, to: type[_T]) -> _T: ...

    @overload
    def parse(self) -> R: ...

    def parse(self, *, to: type[_T] | None = None) -> R | _T:
        """Returns the rich python representation of this response's data.

        NOTE: For the async client: this will become a coroutine in the next major version.

        For lower-level control, see `.read()`, `.json()`, `.iter_bytes()`.

        You can customise the type that the response is parsed into through
        the `to` argument, e.g.

        ```py
        from zhipuai import BaseModel


        class MyModel(BaseModel):
            foo: str


        obj = response.parse(to=MyModel)
        print(obj.foo)
        ```

        We support parsing:
          - `BaseModel`
          - `dict`
          - `list`
          - `Union`
          - `str`
          - `int`
          - `float`
          - `httpx.Response`
        """
        cache_key = to if to is not None else self._cast_type
        cached = self._parsed_by_type.get(cache_key)
        if cached is not None:
            return cached  # type: ignore[no-any-return]

        parsed = self._parse(to=to)
        if is_given(self._options.post_parser):
            parsed = self._options.post_parser(parsed)

        self._parsed_by_type[cache_key] = parsed
        return parsed

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
        """Return the binary response content.

        NOTE: this will be removed in favour of `.read()` in the
        next major version.
        """
        return self.http_response.content

    @property
    def text(self) -> str:
        """Return the decoded response content.

        NOTE: this will be turned into a method in the next major version.
        """
        return self.http_response.text

    @property
    def http_version(self) -> str:
        return self.http_response.http_version

    @property
    def is_closed(self) -> bool:
        return self.http_response.is_closed

    @property
    def elapsed(self) -> datetime.timedelta:
        """The time taken for the complete request/response cycle to complete."""
        return self.http_response.elapsed

    def _parse(self, *, to: type[_T] | None = None) -> R | _T:
        # unwrap `Annotated[T, ...]` -> `T`
        if to and is_annotated_type(to):
            to = extract_type_arg(to, 0)

        if self._stream:
            if to:
                if not is_stream_class_type(to):
                    raise TypeError(f"Expected custom parse type to be a subclass of {StreamResponse}")

                return cast(
                    _T,
                    to(
                        cast_type=extract_stream_chunk_type(
                            to,
                            failure_message="Expected custom stream type to be passed with a type argument, e.g. StreamResponse[ChunkType]",  # noqa: E501
                        ),
                        response=self.http_response,
                        client=cast(Any, self._client),
                    ),
                )

            if self._stream_cls:
                return cast(
                    R,
                    self._stream_cls(
                        cast_type=extract_stream_chunk_type(self._stream_cls),
                        response=self.http_response,
                        client=cast(Any, self._client),
                    ),
                )

            stream_cls = cast("type[StreamResponse[Any]] | None", self._client._default_stream_cls)
            if stream_cls is None:
                raise MissingStreamClassError()

            return cast(
                R,
                stream_cls(
                    cast_type=self._cast_type,
                    response=self.http_response,
                    client=cast(Any, self._client),
                ),
            )

        cast_type = to if to is not None else self._cast_type

        # unwrap `Annotated[T, ...]` -> `T`
        if is_annotated_type(cast_type):
            cast_type = extract_type_arg(cast_type, 0)

        if cast_type is NoneType:
            return cast(R, None)

        response = self.http_response
        if cast_type == str:
            return cast(R, response.text)

        if cast_type == int:
            return cast(R, int(response.text))

        if cast_type == float:
            return cast(R, float(response.text))

        origin = get_origin(cast_type) or cast_type

        if inspect.isclass(origin) and issubclass(origin, HttpxResponseContent):
            # in the response, e.g. mime file
            *_, filename = response.headers.get("content-disposition", "").split("filename=")
            # 判断文件类型是jsonl类型的使用HttpxTextBinaryResponseContent
            if filename and filename.endswith(".jsonl") or filename and filename.endswith(".xlsx"):
                return cast(R, HttpxTextBinaryResponseContent(response))
            else:
                return cast(R, cast_type(response))  # type: ignore

        if origin == LegacyAPIResponse:
            raise RuntimeError("Unexpected state - cast_type is `APIResponse`")

        if inspect.isclass(origin) and issubclass(origin, httpx.Response):
            # Because of the invariance of our ResponseT TypeVar, users can subclass httpx.Response
            # and pass that class to our request functions. We cannot change the variance to be either
            # covariant or contravariant as that makes our usage of ResponseT illegal. We could construct
            # the response class ourselves but that is something that should be supported directly in httpx
            # as it would be easy to incorrectly construct the Response object due to the multitude of arguments.
            if cast_type != httpx.Response:
                raise ValueError("Subclasses of httpx.Response cannot be passed to `cast_type`")
            return cast(R, response)

        if inspect.isclass(origin) and not issubclass(origin, BaseModel) and issubclass(origin, pydantic.BaseModel):
            raise TypeError("Pydantic models must subclass our base model type, e.g. `from openai import BaseModel`")

        if (
            cast_type is not object
            and origin is not list
            and origin is not dict
            and origin is not Union
            and not issubclass(origin, BaseModel)
        ):
            raise RuntimeError(
                f"Unsupported type, expected {cast_type} to be a subclass of {BaseModel}, {dict}, {list}, {Union}, {NoneType}, {str} or {httpx.Response}."  # noqa: E501
            )

        # split is required to handle cases where additional information is included
        # in the response, e.g. application/json; charset=utf-8
        content_type, *_ = response.headers.get("content-type", "*").split(";")
        if content_type != "application/json":
            if is_basemodel(cast_type):
                try:
                    data = response.json()
                except Exception as exc:
                    log.debug("Could not read JSON from response data due to %s - %s", type(exc), exc)
                else:
                    return self._client._process_response_data(
                        data=data,
                        cast_type=cast_type,  # type: ignore
                        response=response,
                    )

            if self._client._strict_response_validation:
                raise APIResponseValidationError(
                    response=response,
                    message=f"Expected Content-Type response header to be `application/json` but received `{content_type}` instead.",  # noqa: E501
                    json_data=response.text,
                )

            # If the API responds with content that isn't JSON then we just return
            # the (decoded) text without performing any parsing so that you can still
            # handle the response however you need to.
            return response.text  # type: ignore

        data = response.json()

        return self._client._process_response_data(
            data=data,
            cast_type=cast_type,  # type: ignore
            response=response,
        )

    @override
    def __repr__(self) -> str:
        return f"<APIResponse [{self.status_code} {self.http_response.reason_phrase}] type={self._cast_type}>"


class MissingStreamClassError(TypeError):
    def __init__(self) -> None:
        super().__init__(
            "The `stream` argument was set to `True` but the `stream_cls` argument was not given. See `openai._streaming` for reference",  # noqa: E501
        )


def to_raw_response_wrapper(func: Callable[P, R]) -> Callable[P, LegacyAPIResponse[R]]:
    """Higher order function that takes one of our bound API methods and wraps it
    to support returning the raw `APIResponse` object directly.
    """

    @functools.wraps(func)
    def wrapped(*args: P.args, **kwargs: P.kwargs) -> LegacyAPIResponse[R]:
        extra_headers: dict[str, str] = {**(cast(Any, kwargs.get("extra_headers")) or {})}
        extra_headers[RAW_RESPONSE_HEADER] = "true"

        kwargs["extra_headers"] = extra_headers

        return cast(LegacyAPIResponse[R], func(*args, **kwargs))

    return wrapped
