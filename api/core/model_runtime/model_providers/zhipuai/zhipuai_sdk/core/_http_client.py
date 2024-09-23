from __future__ import annotations

import inspect
import logging
import time
import warnings
from collections.abc import Iterator, Mapping
from itertools import starmap
from random import random
from typing import TYPE_CHECKING, Any, Generic, Literal, Optional, TypeVar, Union, cast, overload

import httpx
import pydantic
from httpx import URL, Timeout

from . import _errors, get_origin
from ._base_compat import model_copy
from ._base_models import GenericModel, construct_type, validate_type
from ._base_type import (
    NOT_GIVEN,
    AnyMapping,
    Body,
    Data,
    Headers,
    HttpxSendArgs,
    ModelBuilderProtocol,
    NotGiven,
    Omit,
    PostParser,
    Query,
    RequestFiles,
    ResponseT,
)
from ._constants import (
    INITIAL_RETRY_DELAY,
    MAX_RETRY_DELAY,
    RAW_RESPONSE_HEADER,
    ZHIPUAI_DEFAULT_LIMITS,
    ZHIPUAI_DEFAULT_MAX_RETRIES,
    ZHIPUAI_DEFAULT_TIMEOUT,
)
from ._errors import APIConnectionError, APIResponseValidationError, APIStatusError, APITimeoutError
from ._files import to_httpx_files
from ._legacy_response import LegacyAPIResponse
from ._request_opt import FinalRequestOptions, UserRequestInput
from ._response import APIResponse, BaseAPIResponse, extract_response_type
from ._sse_client import StreamResponse
from ._utils import flatten, is_given, is_mapping

log: logging.Logger = logging.getLogger(__name__)

# TODO: make base page type vars covariant
SyncPageT = TypeVar("SyncPageT", bound="BaseSyncPage[Any]")
# AsyncPageT = TypeVar("AsyncPageT", bound="BaseAsyncPage[Any]")

_T = TypeVar("_T")
_T_co = TypeVar("_T_co", covariant=True)

if TYPE_CHECKING:
    from httpx._config import DEFAULT_TIMEOUT_CONFIG as HTTPX_DEFAULT_TIMEOUT
else:
    try:
        from httpx._config import DEFAULT_TIMEOUT_CONFIG as HTTPX_DEFAULT_TIMEOUT
    except ImportError:
        # taken from https://github.com/encode/httpx/blob/3ba5fe0d7ac70222590e759c31442b1cab263791/httpx/_config.py#L366
        HTTPX_DEFAULT_TIMEOUT = Timeout(5.0)


headers = {
    "Accept": "application/json",
    "Content-Type": "application/json; charset=UTF-8",
}


class PageInfo:
    """Stores the necessary information to build the request to retrieve the next page.

    Either `url` or `params` must be set.
    """

    url: URL | NotGiven
    params: Query | NotGiven

    @overload
    def __init__(
        self,
        *,
        url: URL,
    ) -> None: ...

    @overload
    def __init__(
        self,
        *,
        params: Query,
    ) -> None: ...

    def __init__(
        self,
        *,
        url: URL | NotGiven = NOT_GIVEN,
        params: Query | NotGiven = NOT_GIVEN,
    ) -> None:
        self.url = url
        self.params = params


class BasePage(GenericModel, Generic[_T]):
    """
    Defines the core interface for pagination.

    Type Args:
        ModelT: The pydantic model that represents an item in the response.

    Methods:
        has_next_page(): Check if there is another page available
        next_page_info(): Get the necessary information to make a request for the next page
    """

    _options: FinalRequestOptions = pydantic.PrivateAttr()
    _model: type[_T] = pydantic.PrivateAttr()

    def has_next_page(self) -> bool:
        items = self._get_page_items()
        if not items:
            return False
        return self.next_page_info() is not None

    def next_page_info(self) -> Optional[PageInfo]: ...

    def _get_page_items(self) -> Iterable[_T]:  # type: ignore[empty-body]
        ...

    def _params_from_url(self, url: URL) -> httpx.QueryParams:
        # TODO: do we have to preprocess params here?
        return httpx.QueryParams(cast(Any, self._options.params)).merge(url.params)

    def _info_to_options(self, info: PageInfo) -> FinalRequestOptions:
        options = model_copy(self._options)
        options._strip_raw_response_header()

        if not isinstance(info.params, NotGiven):
            options.params = {**options.params, **info.params}
            return options

        if not isinstance(info.url, NotGiven):
            params = self._params_from_url(info.url)
            url = info.url.copy_with(params=params)
            options.params = dict(url.params)
            options.url = str(url)
            return options

        raise ValueError("Unexpected PageInfo state")


class BaseSyncPage(BasePage[_T], Generic[_T]):
    _client: HttpClient = pydantic.PrivateAttr()

    def _set_private_attributes(
        self,
        client: HttpClient,
        model: type[_T],
        options: FinalRequestOptions,
    ) -> None:
        self._model = model
        self._client = client
        self._options = options

    # Pydantic uses a custom `__iter__` method to support casting BaseModels
    # to dictionaries. e.g. dict(model).
    # As we want to support `for item in page`, this is inherently incompatible
    # with the default pydantic behaviour. It is not possible to support both
    # use cases at once. Fortunately, this is not a big deal as all other pydantic
    # methods should continue to work as expected as there is an alternative method
    # to cast a model to a dictionary, model.dict(), which is used internally
    # by pydantic.
    def __iter__(self) -> Iterator[_T]:  # type: ignore
        for page in self.iter_pages():
            yield from page._get_page_items()

    def iter_pages(self: SyncPageT) -> Iterator[SyncPageT]:
        page = self
        while True:
            yield page
            if page.has_next_page():
                page = page.get_next_page()
            else:
                return

    def get_next_page(self: SyncPageT) -> SyncPageT:
        info = self.next_page_info()
        if not info:
            raise RuntimeError(
                "No next page expected; please check `.has_next_page()` before calling `.get_next_page()`."
            )

        options = self._info_to_options(info)
        return self._client._request_api_list(self._model, page=self.__class__, options=options)


class HttpClient:
    _client: httpx.Client
    _version: str
    _base_url: URL
    max_retries: int
    timeout: Union[float, Timeout, None]
    _limits: httpx.Limits
    _has_custom_http_client: bool
    _default_stream_cls: type[StreamResponse[Any]] | None = None

    _strict_response_validation: bool

    def __init__(
        self,
        *,
        version: str,
        base_url: URL,
        _strict_response_validation: bool,
        max_retries: int = ZHIPUAI_DEFAULT_MAX_RETRIES,
        timeout: Union[float, Timeout, None],
        limits: httpx.Limits | None = None,
        custom_httpx_client: httpx.Client | None = None,
        custom_headers: Mapping[str, str] | None = None,
    ) -> None:
        if limits is not None:
            warnings.warn(
                "The `connection_pool_limits` argument is deprecated. The `http_client` argument should be passed instead",  # noqa: E501
                category=DeprecationWarning,
                stacklevel=3,
            )
            if custom_httpx_client is not None:
                raise ValueError("The `http_client` argument is mutually exclusive with `connection_pool_limits`")
        else:
            limits = ZHIPUAI_DEFAULT_LIMITS

        if not is_given(timeout):
            if custom_httpx_client and custom_httpx_client.timeout != HTTPX_DEFAULT_TIMEOUT:
                timeout = custom_httpx_client.timeout
            else:
                timeout = ZHIPUAI_DEFAULT_TIMEOUT
        self.max_retries = max_retries
        self.timeout = timeout
        self._limits = limits
        self._has_custom_http_client = bool(custom_httpx_client)
        self._client = custom_httpx_client or httpx.Client(
            base_url=base_url,
            timeout=self.timeout,
            limits=limits,
        )
        self._version = version
        url = URL(url=base_url)
        if not url.raw_path.endswith(b"/"):
            url = url.copy_with(raw_path=url.raw_path + b"/")
        self._base_url = url
        self._custom_headers = custom_headers or {}
        self._strict_response_validation = _strict_response_validation

    def _prepare_url(self, url: str) -> URL:
        sub_url = URL(url)
        if sub_url.is_relative_url:
            request_raw_url = self._base_url.raw_path + sub_url.raw_path.lstrip(b"/")
            return self._base_url.copy_with(raw_path=request_raw_url)

        return sub_url

    @property
    def _default_headers(self):
        return {
            "Accept": "application/json",
            "Content-Type": "application/json; charset=UTF-8",
            "ZhipuAI-SDK-Ver": self._version,
            "source_type": "zhipu-sdk-python",
            "x-request-sdk": "zhipu-sdk-python",
            **self.auth_headers,
            **self._custom_headers,
        }

    @property
    def custom_auth(self) -> httpx.Auth | None:
        return None

    @property
    def auth_headers(self):
        return {}

    def _prepare_headers(self, options: FinalRequestOptions) -> httpx.Headers:
        custom_headers = options.headers or {}
        headers_dict = _merge_mappings(self._default_headers, custom_headers)

        httpx_headers = httpx.Headers(headers_dict)

        return httpx_headers

    def _remaining_retries(
        self,
        remaining_retries: Optional[int],
        options: FinalRequestOptions,
    ) -> int:
        return remaining_retries if remaining_retries is not None else options.get_max_retries(self.max_retries)

    def _calculate_retry_timeout(
        self,
        remaining_retries: int,
        options: FinalRequestOptions,
        response_headers: Optional[httpx.Headers] = None,
    ) -> float:
        max_retries = options.get_max_retries(self.max_retries)

        # If the API asks us to wait a certain amount of time (and it's a reasonable amount), just do what it says.
        # retry_after = self._parse_retry_after_header(response_headers)
        # if retry_after is not None and 0 < retry_after <= 60:
        #     return retry_after

        nb_retries = max_retries - remaining_retries

        # Apply exponential backoff, but not more than the max.
        sleep_seconds = min(INITIAL_RETRY_DELAY * pow(2.0, nb_retries), MAX_RETRY_DELAY)

        # Apply some jitter, plus-or-minus half a second.
        jitter = 1 - 0.25 * random()
        timeout = sleep_seconds * jitter
        return max(timeout, 0)

    def _build_request(self, options: FinalRequestOptions) -> httpx.Request:
        kwargs: dict[str, Any] = {}
        headers = self._prepare_headers(options)
        url = self._prepare_url(options.url)
        json_data = options.json_data
        if options.extra_json is not None:
            if json_data is None:
                json_data = cast(Body, options.extra_json)
            elif is_mapping(json_data):
                json_data = _merge_mappings(json_data, options.extra_json)
            else:
                raise RuntimeError(f"Unexpected JSON data type, {type(json_data)}, cannot merge with `extra_body`")

        content_type = headers.get("Content-Type")
        # multipart/form-data; boundary=---abc--
        if headers.get("Content-Type") == "multipart/form-data":
            if "boundary" not in content_type:
                # only remove the header if the boundary hasn't been explicitly set
                # as the caller doesn't want httpx to come up with their own boundary
                headers.pop("Content-Type")

            if json_data:
                kwargs["data"] = self._make_multipartform(json_data)

        return self._client.build_request(
            headers=headers,
            timeout=self.timeout if isinstance(options.timeout, NotGiven) else options.timeout,
            method=options.method,
            url=url,
            json=json_data,
            files=options.files,
            params=options.params,
            **kwargs,
        )

    def _object_to_formfata(self, key: str, value: Data | Mapping[object, object]) -> list[tuple[str, str]]:
        items = []

        if isinstance(value, Mapping):
            for k, v in value.items():
                items.extend(self._object_to_formfata(f"{key}[{k}]", v))
            return items
        if isinstance(value, list | tuple):
            for v in value:
                items.extend(self._object_to_formfata(key + "[]", v))
            return items

        def _primitive_value_to_str(val) -> str:
            # copied from httpx
            if val is True:
                return "true"
            elif val is False:
                return "false"
            elif val is None:
                return ""
            return str(val)

        str_data = _primitive_value_to_str(value)

        if not str_data:
            return []
        return [(key, str_data)]

    def _make_multipartform(self, data: Mapping[object, object]) -> dict[str, object]:
        items = flatten(list(starmap(self._object_to_formfata, data.items())))

        serialized: dict[str, object] = {}
        for key, value in items:
            if key in serialized:
                raise ValueError(f"存在重复的键: {key};")
            serialized[key] = value
        return serialized

    def _process_response_data(
        self,
        *,
        data: object,
        cast_type: type[ResponseT],
        response: httpx.Response,
    ) -> ResponseT:
        if data is None:
            return cast(ResponseT, None)

        if cast_type is object:
            return cast(ResponseT, data)

        try:
            if inspect.isclass(cast_type) and issubclass(cast_type, ModelBuilderProtocol):
                return cast(ResponseT, cast_type.build(response=response, data=data))

            if self._strict_response_validation:
                return cast(ResponseT, validate_type(type_=cast_type, value=data))

            return cast(ResponseT, construct_type(type_=cast_type, value=data))
        except pydantic.ValidationError as err:
            raise APIResponseValidationError(response=response, json_data=data) from err

    def _should_stream_response_body(self, request: httpx.Request) -> bool:
        return request.headers.get(RAW_RESPONSE_HEADER) == "stream"  # type: ignore[no-any-return]

    def _should_retry(self, response: httpx.Response) -> bool:
        # Note: this is not a standard header
        should_retry_header = response.headers.get("x-should-retry")

        # If the server explicitly says whether or not to retry, obey.
        if should_retry_header == "true":
            log.debug("Retrying as header `x-should-retry` is set to `true`")
            return True
        if should_retry_header == "false":
            log.debug("Not retrying as header `x-should-retry` is set to `false`")
            return False

        # Retry on request timeouts.
        if response.status_code == 408:
            log.debug("Retrying due to status code %i", response.status_code)
            return True

        # Retry on lock timeouts.
        if response.status_code == 409:
            log.debug("Retrying due to status code %i", response.status_code)
            return True

        # Retry on rate limits.
        if response.status_code == 429:
            log.debug("Retrying due to status code %i", response.status_code)
            return True

        # Retry internal errors.
        if response.status_code >= 500:
            log.debug("Retrying due to status code %i", response.status_code)
            return True

        log.debug("Not retrying")
        return False

    def is_closed(self) -> bool:
        return self._client.is_closed

    def close(self):
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def request(
        self,
        cast_type: type[ResponseT],
        options: FinalRequestOptions,
        remaining_retries: Optional[int] = None,
        *,
        stream: bool = False,
        stream_cls: type[StreamResponse] | None = None,
    ) -> ResponseT | StreamResponse:
        return self._request(
            cast_type=cast_type,
            options=options,
            stream=stream,
            stream_cls=stream_cls,
            remaining_retries=remaining_retries,
        )

    def _request(
        self,
        *,
        cast_type: type[ResponseT],
        options: FinalRequestOptions,
        remaining_retries: int | None,
        stream: bool,
        stream_cls: type[StreamResponse] | None,
    ) -> ResponseT | StreamResponse:
        retries = self._remaining_retries(remaining_retries, options)
        request = self._build_request(options)

        kwargs: HttpxSendArgs = {}
        if self.custom_auth is not None:
            kwargs["auth"] = self.custom_auth
        try:
            response = self._client.send(
                request,
                stream=stream or self._should_stream_response_body(request=request),
                **kwargs,
            )
        except httpx.TimeoutException as err:
            log.debug("Encountered httpx.TimeoutException", exc_info=True)

            if retries > 0:
                return self._retry_request(
                    options,
                    cast_type,
                    retries,
                    stream=stream,
                    stream_cls=stream_cls,
                    response_headers=None,
                )

            log.debug("Raising timeout error")
            raise APITimeoutError(request=request) from err
        except Exception as err:
            log.debug("Encountered Exception", exc_info=True)

            if retries > 0:
                return self._retry_request(
                    options,
                    cast_type,
                    retries,
                    stream=stream,
                    stream_cls=stream_cls,
                    response_headers=None,
                )

            log.debug("Raising connection error")
            raise APIConnectionError(request=request) from err

        log.debug(
            'HTTP Request: %s %s "%i %s"', request.method, request.url, response.status_code, response.reason_phrase
        )

        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as err:  # thrown on 4xx and 5xx status code
            log.debug("Encountered httpx.HTTPStatusError", exc_info=True)

            if retries > 0 and self._should_retry(err.response):
                err.response.close()
                return self._retry_request(
                    options,
                    cast_type,
                    retries,
                    err.response.headers,
                    stream=stream,
                    stream_cls=stream_cls,
                )

            # If the response is streamed then we need to explicitly read the response
            # to completion before attempting to access the response text.
            if not err.response.is_closed:
                err.response.read()

            log.debug("Re-raising status error")
            raise self._make_status_error(err.response) from None

        # return self._parse_response(
        #     cast_type=cast_type,
        #     options=options,
        #     response=response,
        #     stream=stream,
        #     stream_cls=stream_cls,
        # )
        return self._process_response(
            cast_type=cast_type,
            options=options,
            response=response,
            stream=stream,
            stream_cls=stream_cls,
        )

    def _retry_request(
        self,
        options: FinalRequestOptions,
        cast_type: type[ResponseT],
        remaining_retries: int,
        response_headers: httpx.Headers | None,
        *,
        stream: bool,
        stream_cls: type[StreamResponse] | None,
    ) -> ResponseT | StreamResponse:
        remaining = remaining_retries - 1
        if remaining == 1:
            log.debug("1 retry left")
        else:
            log.debug("%i retries left", remaining)

        timeout = self._calculate_retry_timeout(remaining, options, response_headers)
        log.info("Retrying request to %s in %f seconds", options.url, timeout)

        # In a synchronous context we are blocking the entire thread. Up to the library user to run the client in a
        # different thread if necessary.
        time.sleep(timeout)

        return self._request(
            options=options,
            cast_type=cast_type,
            remaining_retries=remaining,
            stream=stream,
            stream_cls=stream_cls,
        )

    def _process_response(
        self,
        *,
        cast_type: type[ResponseT],
        options: FinalRequestOptions,
        response: httpx.Response,
        stream: bool,
        stream_cls: type[StreamResponse] | None,
    ) -> ResponseT:
        # _legacy_response with raw_response_header to paser method
        if response.request.headers.get(RAW_RESPONSE_HEADER) == "true":
            return cast(
                ResponseT,
                LegacyAPIResponse(
                    raw=response,
                    client=self,
                    cast_type=cast_type,
                    stream=stream,
                    stream_cls=stream_cls,
                    options=options,
                ),
            )

        origin = get_origin(cast_type) or cast_type

        if inspect.isclass(origin) and issubclass(origin, BaseAPIResponse):
            if not issubclass(origin, APIResponse):
                raise TypeError(f"API Response types must subclass {APIResponse}; Received {origin}")

            response_cls = cast("type[BaseAPIResponse[Any]]", cast_type)
            return cast(
                ResponseT,
                response_cls(
                    raw=response,
                    client=self,
                    cast_type=extract_response_type(response_cls),
                    stream=stream,
                    stream_cls=stream_cls,
                    options=options,
                ),
            )

        if cast_type == httpx.Response:
            return cast(ResponseT, response)

        api_response = APIResponse(
            raw=response,
            client=self,
            cast_type=cast("type[ResponseT]", cast_type),  # pyright: ignore[reportUnnecessaryCast]
            stream=stream,
            stream_cls=stream_cls,
            options=options,
        )
        if bool(response.request.headers.get(RAW_RESPONSE_HEADER)):
            return cast(ResponseT, api_response)

        return api_response.parse()

    def _request_api_list(
        self,
        model: type[object],
        page: type[SyncPageT],
        options: FinalRequestOptions,
    ) -> SyncPageT:
        def _parser(resp: SyncPageT) -> SyncPageT:
            resp._set_private_attributes(
                client=self,
                model=model,
                options=options,
            )
            return resp

        options.post_parser = _parser

        return self.request(page, options, stream=False)

    @overload
    def get(
        self,
        path: str,
        *,
        cast_type: type[ResponseT],
        options: UserRequestInput = {},
        stream: Literal[False] = False,
    ) -> ResponseT: ...

    @overload
    def get(
        self,
        path: str,
        *,
        cast_type: type[ResponseT],
        options: UserRequestInput = {},
        stream: Literal[True],
        stream_cls: type[StreamResponse],
    ) -> StreamResponse: ...

    @overload
    def get(
        self,
        path: str,
        *,
        cast_type: type[ResponseT],
        options: UserRequestInput = {},
        stream: bool,
        stream_cls: type[StreamResponse] | None = None,
    ) -> ResponseT | StreamResponse: ...

    def get(
        self,
        path: str,
        *,
        cast_type: type[ResponseT],
        options: UserRequestInput = {},
        stream: bool = False,
        stream_cls: type[StreamResponse] | None = None,
    ) -> ResponseT:
        opts = FinalRequestOptions.construct(method="get", url=path, **options)
        return cast(ResponseT, self.request(cast_type, opts, stream=stream, stream_cls=stream_cls))

    @overload
    def post(
        self,
        path: str,
        *,
        cast_type: type[ResponseT],
        body: Body | None = None,
        options: UserRequestInput = {},
        files: RequestFiles | None = None,
        stream: Literal[False] = False,
    ) -> ResponseT: ...

    @overload
    def post(
        self,
        path: str,
        *,
        cast_type: type[ResponseT],
        body: Body | None = None,
        options: UserRequestInput = {},
        files: RequestFiles | None = None,
        stream: Literal[True],
        stream_cls: type[StreamResponse],
    ) -> StreamResponse: ...

    @overload
    def post(
        self,
        path: str,
        *,
        cast_type: type[ResponseT],
        body: Body | None = None,
        options: UserRequestInput = {},
        files: RequestFiles | None = None,
        stream: bool,
        stream_cls: type[StreamResponse] | None = None,
    ) -> ResponseT | StreamResponse: ...

    def post(
        self,
        path: str,
        *,
        cast_type: type[ResponseT],
        body: Body | None = None,
        options: UserRequestInput = {},
        files: RequestFiles | None = None,
        stream: bool = False,
        stream_cls: type[StreamResponse[Any]] | None = None,
    ) -> ResponseT | StreamResponse:
        opts = FinalRequestOptions.construct(
            method="post", url=path, json_data=body, files=to_httpx_files(files), **options
        )

        return cast(ResponseT, self.request(cast_type, opts, stream=stream, stream_cls=stream_cls))

    def patch(
        self,
        path: str,
        *,
        cast_type: type[ResponseT],
        body: Body | None = None,
        options: UserRequestInput = {},
    ) -> ResponseT:
        opts = FinalRequestOptions.construct(method="patch", url=path, json_data=body, **options)

        return self.request(
            cast_type=cast_type,
            options=opts,
        )

    def put(
        self,
        path: str,
        *,
        cast_type: type[ResponseT],
        body: Body | None = None,
        options: UserRequestInput = {},
        files: RequestFiles | None = None,
    ) -> ResponseT | StreamResponse:
        opts = FinalRequestOptions.construct(
            method="put", url=path, json_data=body, files=to_httpx_files(files), **options
        )

        return self.request(
            cast_type=cast_type,
            options=opts,
        )

    def delete(
        self,
        path: str,
        *,
        cast_type: type[ResponseT],
        body: Body | None = None,
        options: UserRequestInput = {},
    ) -> ResponseT | StreamResponse:
        opts = FinalRequestOptions.construct(method="delete", url=path, json_data=body, **options)

        return self.request(
            cast_type=cast_type,
            options=opts,
        )

    def get_api_list(
        self,
        path: str,
        *,
        model: type[object],
        page: type[SyncPageT],
        body: Body | None = None,
        options: UserRequestInput = {},
        method: str = "get",
    ) -> SyncPageT:
        opts = FinalRequestOptions.construct(method=method, url=path, json_data=body, **options)
        return self._request_api_list(model, page, opts)

    def _make_status_error(self, response) -> APIStatusError:
        response_text = response.text.strip()
        status_code = response.status_code
        error_msg = f"Error code: {status_code}, with error text {response_text}"

        if status_code == 400:
            return _errors.APIRequestFailedError(message=error_msg, response=response)
        elif status_code == 401:
            return _errors.APIAuthenticationError(message=error_msg, response=response)
        elif status_code == 429:
            return _errors.APIReachLimitError(message=error_msg, response=response)
        elif status_code == 500:
            return _errors.APIInternalError(message=error_msg, response=response)
        elif status_code == 503:
            return _errors.APIServerFlowExceedError(message=error_msg, response=response)
        return APIStatusError(message=error_msg, response=response)


def make_request_options(
    *,
    query: Query | None = None,
    extra_headers: Headers | None = None,
    extra_query: Query | None = None,
    extra_body: Body | None = None,
    timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    post_parser: PostParser | NotGiven = NOT_GIVEN,
) -> UserRequestInput:
    """Create a dict of type RequestOptions without keys of NotGiven values."""
    options: UserRequestInput = {}
    if extra_headers is not None:
        options["headers"] = extra_headers

    if extra_body is not None:
        options["extra_json"] = cast(AnyMapping, extra_body)

    if query is not None:
        options["params"] = query

    if extra_query is not None:
        options["params"] = {**options.get("params", {}), **extra_query}

    if not isinstance(timeout, NotGiven):
        options["timeout"] = timeout

    if is_given(post_parser):
        # internal
        options["post_parser"] = post_parser  # type: ignore

    return options


def _merge_mappings(
    obj1: Mapping[_T_co, Union[_T, Omit]],
    obj2: Mapping[_T_co, Union[_T, Omit]],
) -> dict[_T_co, _T]:
    """Merge two mappings of the same type, removing any values that are instances of `Omit`.

    In cases with duplicate keys the second mapping takes precedence.
    """
    merged = {**obj1, **obj2}
    return {key: value for key, value in merged.items() if not isinstance(value, Omit)}
