from __future__ import annotations

import datetime
import inspect
import logging
from collections.abc import Iterator
from typing import TYPE_CHECKING, Any, Generic, TypeVar, Union, cast, get_origin, overload

import httpx
import pydantic
from typing_extensions import ParamSpec, override

from ._base_models import BaseModel, is_basemodel
from ._base_type import NoneType
from ._errors import APIResponseValidationError, ZhipuAIError
from ._sse_client import StreamResponse, extract_stream_chunk_type, is_stream_class_type
from ._utils import extract_type_arg, extract_type_var_from_base, is_annotated_type, is_given

if TYPE_CHECKING:
    from ._http_client import HttpClient
    from ._request_opt import FinalRequestOptions

P = ParamSpec("P")
R = TypeVar("R")
_T = TypeVar("_T")
_APIResponseT = TypeVar("_APIResponseT", bound="APIResponse[Any]")
log: logging.Logger = logging.getLogger(__name__)


class BaseAPIResponse(Generic[R]):
    _cast_type: type[R]
    _client: HttpClient
    _parsed_by_type: dict[type[Any], Any]
    _is_sse_stream: bool
    _stream_cls: type[StreamResponse[Any]]
    _options: FinalRequestOptions
    http_response: httpx.Response

    def __init__(
        self,
        *,
        raw: httpx.Response,
        cast_type: type[R],
        client: HttpClient,
        stream: bool,
        stream_cls: type[StreamResponse[Any]] | None = None,
        options: FinalRequestOptions,
    ) -> None:
        self._cast_type = cast_type
        self._client = client
        self._parsed_by_type = {}
        self._is_sse_stream = stream
        self._stream_cls = stream_cls
        self._options = options
        self.http_response = raw

    def _parse(self, *, to: type[_T] | None = None) -> R | _T:
        # unwrap `Annotated[T, ...]` -> `T`
        if to and is_annotated_type(to):
            to = extract_type_arg(to, 0)

        if self._is_sse_stream:
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

            stream_cls = cast("type[Stream[Any]] | None", self._client._default_stream_cls)
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

        if cast_type == bytes:
            return cast(R, response.content)

        if cast_type == int:
            return cast(R, int(response.text))

        if cast_type == float:
            return cast(R, float(response.text))

        origin = get_origin(cast_type) or cast_type

        # handle the legacy binary response case
        if inspect.isclass(cast_type) and cast_type.__name__ == "HttpxBinaryResponseContent":
            return cast(R, cast_type(response))  # type: ignore

        if origin == APIResponse:
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

    @property
    def headers(self) -> httpx.Headers:
        return self.http_response.headers

    @property
    def http_request(self) -> httpx.Request:
        """Returns the httpx Request instance associated with the current response."""
        return self.http_response.request

    @property
    def status_code(self) -> int:
        return self.http_response.status_code

    @property
    def url(self) -> httpx.URL:
        """Returns the URL for which the request was made."""
        return self.http_response.url

    @property
    def method(self) -> str:
        return self.http_request.method

    @property
    def http_version(self) -> str:
        return self.http_response.http_version

    @property
    def elapsed(self) -> datetime.timedelta:
        """The time taken for the complete request/response cycle to complete."""
        return self.http_response.elapsed

    @property
    def is_closed(self) -> bool:
        """Whether or not the response body has been closed.

        If this is False then there is response data that has not been read yet.
        You must either fully consume the response body or call `.close()`
        before discarding the response to prevent resource leaks.
        """
        return self.http_response.is_closed

    @override
    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} [{self.status_code} {self.http_response.reason_phrase}] type={self._cast_type}>"  # noqa: E501


class APIResponse(BaseAPIResponse[R]):
    @property
    def request_id(self) -> str | None:
        return self.http_response.headers.get("x-request-id")  # type: ignore[no-any-return]

    @overload
    def parse(self, *, to: type[_T]) -> _T: ...

    @overload
    def parse(self) -> R: ...

    def parse(self, *, to: type[_T] | None = None) -> R | _T:
        """Returns the rich python representation of this response's data.

        For lower-level control, see `.read()`, `.json()`, `.iter_bytes()`.

        You can customize the type that the response is parsed into through
        the `to` argument, e.g.

        ```py
        from openai import BaseModel


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

        if not self._is_sse_stream:
            self.read()

        parsed = self._parse(to=to)
        if is_given(self._options.post_parser):
            parsed = self._options.post_parser(parsed)

        self._parsed_by_type[cache_key] = parsed
        return parsed

    def read(self) -> bytes:
        """Read and return the binary response content."""
        try:
            return self.http_response.read()
        except httpx.StreamConsumed as exc:
            # The default error raised by httpx isn't very
            # helpful in our case so we re-raise it with
            # a different error message.
            raise StreamAlreadyConsumed() from exc

    def text(self) -> str:
        """Read and decode the response content into a string."""
        self.read()
        return self.http_response.text

    def json(self) -> object:
        """Read and decode the JSON response content."""
        self.read()
        return self.http_response.json()

    def close(self) -> None:
        """Close the response and release the connection.

        Automatically called if the response body is read to completion.
        """
        self.http_response.close()

    def iter_bytes(self, chunk_size: int | None = None) -> Iterator[bytes]:
        """
        A byte-iterator over the decoded response content.

        This automatically handles gzip, deflate and brotli encoded responses.
        """
        yield from self.http_response.iter_bytes(chunk_size)

    def iter_text(self, chunk_size: int | None = None) -> Iterator[str]:
        """A str-iterator over the decoded response content
        that handles both gzip, deflate, etc but also detects the content's
        string encoding.
        """
        yield from self.http_response.iter_text(chunk_size)

    def iter_lines(self) -> Iterator[str]:
        """Like `iter_text()` but will only yield chunks for each line"""
        yield from self.http_response.iter_lines()


class MissingStreamClassError(TypeError):
    def __init__(self) -> None:
        super().__init__(
            "The `stream` argument was set to `True` but the `stream_cls` argument was not given. See `openai._streaming` for reference",  # noqa: E501
        )


class StreamAlreadyConsumed(ZhipuAIError):  # noqa: N818
    """
    Attempted to read or stream content, but the content has already
    been streamed.

    This can happen if you use a method like `.iter_lines()` and then attempt
    to read th entire response body afterwards, e.g.

    ```py
    response = await client.post(...)
    async for line in response.iter_lines():
        ...  # do something with `line`

    content = await response.read()
    # ^ error
    ```

    If you want this behavior you'll need to either manually accumulate the response
    content or call `await response.read()` before iterating over the stream.
    """

    def __init__(self) -> None:
        message = (
            "Attempted to read or stream some content, but the content has "
            "already been streamed. "
            "This could be due to attempting to stream the response "
            "content more than once."
            "\n\n"
            "You can fix this by manually accumulating the response content while streaming "
            "or by calling `.read()` before starting to stream."
        )
        super().__init__(message)


def extract_response_type(typ: type[BaseAPIResponse[Any]]) -> type:
    """Given a type like `APIResponse[T]`, returns the generic type variable `T`.

    This also handles the case where a concrete subclass is given, e.g.
    ```py
    class MyResponse(APIResponse[bytes]):
        ...

    extract_response_type(MyResponse) -> bytes
    ```
    """
    return extract_type_var_from_base(
        typ,
        generic_bases=cast("tuple[type, ...]", (BaseAPIResponse, APIResponse)),
        index=0,
    )
