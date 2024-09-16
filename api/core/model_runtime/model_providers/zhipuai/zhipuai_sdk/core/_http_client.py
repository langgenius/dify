from __future__ import annotations

import inspect
from collections.abc import Mapping
from typing import Any, Union, cast

import httpx
import pydantic
from httpx import URL, Timeout
from tenacity import retry
from tenacity.stop import stop_after_attempt

from . import _errors
from ._base_type import NOT_GIVEN, AnyMapping, Body, Data, Headers, NotGiven, Query, RequestFiles, ResponseT
from ._errors import APIResponseValidationError, APIStatusError, APITimeoutError
from ._files import make_httpx_files
from ._request_opt import ClientRequestParam, UserRequestInput
from ._response import HttpResponse
from ._sse_client import StreamResponse
from ._utils import flatten

headers = {
    "Accept": "application/json",
    "Content-Type": "application/json; charset=UTF-8",
}


def _merge_map(map1: Mapping, map2: Mapping) -> Mapping:
    merged = {**map1, **map2}
    return {key: val for key, val in merged.items() if val is not None}


from itertools import starmap

from httpx._config import DEFAULT_TIMEOUT_CONFIG as HTTPX_DEFAULT_TIMEOUT

ZHIPUAI_DEFAULT_TIMEOUT = httpx.Timeout(timeout=300.0, connect=8.0)
ZHIPUAI_DEFAULT_MAX_RETRIES = 3
ZHIPUAI_DEFAULT_LIMITS = httpx.Limits(max_connections=5, max_keepalive_connections=5)


class HttpClient:
    _client: httpx.Client
    _version: str
    _base_url: URL

    timeout: Union[float, Timeout, None]
    _limits: httpx.Limits
    _has_custom_http_client: bool
    _default_stream_cls: type[StreamResponse[Any]] | None = None

    def __init__(
        self,
        *,
        version: str,
        base_url: URL,
        timeout: Union[float, Timeout, None],
        custom_httpx_client: httpx.Client | None = None,
        custom_headers: Mapping[str, str] | None = None,
    ) -> None:
        if timeout is None or isinstance(timeout, NotGiven):
            if custom_httpx_client and custom_httpx_client.timeout != HTTPX_DEFAULT_TIMEOUT:
                timeout = custom_httpx_client.timeout
            else:
                timeout = ZHIPUAI_DEFAULT_TIMEOUT
        self.timeout = cast(Timeout, timeout)
        self._has_custom_http_client = bool(custom_httpx_client)
        self._client = custom_httpx_client or httpx.Client(
            base_url=base_url,
            timeout=self.timeout,
            limits=ZHIPUAI_DEFAULT_LIMITS,
        )
        self._version = version
        url = URL(url=base_url)
        if not url.raw_path.endswith(b"/"):
            url = url.copy_with(raw_path=url.raw_path + b"/")
        self._base_url = url
        self._custom_headers = custom_headers or {}

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
            **self._auth_headers,
            **self._custom_headers,
        }

    @property
    def _auth_headers(self):
        return {}

    def _prepare_headers(self, request_param: ClientRequestParam) -> httpx.Headers:
        custom_headers = request_param.headers or {}
        headers_dict = _merge_map(self._default_headers, custom_headers)

        httpx_headers = httpx.Headers(headers_dict)

        return httpx_headers

    def _prepare_request(self, request_param: ClientRequestParam) -> httpx.Request:
        kwargs: dict[str, Any] = {}
        json_data = request_param.json_data
        headers = self._prepare_headers(request_param)
        url = self._prepare_url(request_param.url)
        json_data = request_param.json_data
        if headers.get("Content-Type") == "multipart/form-data":
            headers.pop("Content-Type")

            if json_data:
                kwargs["data"] = self._make_multipartform(json_data)

        return self._client.build_request(
            headers=headers,
            timeout=self.timeout if isinstance(request_param.timeout, NotGiven) else request_param.timeout,
            method=request_param.method,
            url=url,
            json=json_data,
            files=request_param.files,
            params=request_param.params,
            **kwargs,
        )

    def _object_to_formdata(self, key: str, value: Data | Mapping[object, object]) -> list[tuple[str, str]]:
        items = []

        if isinstance(value, Mapping):
            for k, v in value.items():
                items.extend(self._object_to_formdata(f"{key}[{k}]", v))
            return items
        if isinstance(value, list | tuple):
            for v in value:
                items.extend(self._object_to_formdata(key + "[]", v))
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
        items = flatten(list(starmap(self._object_to_formdata, data.items())))

        serialized: dict[str, object] = {}
        for key, value in items:
            if key in serialized:
                raise ValueError(f"存在重复的键: {key};")
            serialized[key] = value
        return serialized

    def _parse_response(
        self,
        *,
        cast_type: type[ResponseT],
        response: httpx.Response,
        enable_stream: bool,
        request_param: ClientRequestParam,
        stream_cls: type[StreamResponse[Any]] | None = None,
    ) -> HttpResponse:
        http_response = HttpResponse(
            raw_response=response, cast_type=cast_type, client=self, enable_stream=enable_stream, stream_cls=stream_cls
        )
        return http_response.parse()

    def _process_response_data(
        self,
        *,
        data: object,
        cast_type: type[ResponseT],
        response: httpx.Response,
    ) -> ResponseT:
        if data is None:
            return cast(ResponseT, None)

        try:
            if inspect.isclass(cast_type) and issubclass(cast_type, pydantic.BaseModel):
                return cast(ResponseT, cast_type.validate(data))

            return cast(ResponseT, pydantic.TypeAdapter(cast_type).validate_python(data))
        except pydantic.ValidationError as err:
            raise APIResponseValidationError(response=response, json_data=data) from err

    def is_closed(self) -> bool:
        return self._client.is_closed

    def close(self):
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    @retry(stop=stop_after_attempt(ZHIPUAI_DEFAULT_MAX_RETRIES))
    def request(
        self,
        *,
        cast_type: type[ResponseT],
        params: ClientRequestParam,
        enable_stream: bool = False,
        stream_cls: type[StreamResponse[Any]] | None = None,
    ) -> ResponseT | StreamResponse:
        request = self._prepare_request(params)

        try:
            response = self._client.send(
                request,
                stream=enable_stream,
            )
            response.raise_for_status()
        except httpx.TimeoutException as err:
            raise APITimeoutError(request=request) from err
        except httpx.HTTPStatusError as err:
            err.response.read()
            # raise err
            raise self._make_status_error(err.response) from None

        except Exception as err:
            raise err

        return self._parse_response(
            cast_type=cast_type,
            request_param=params,
            response=response,
            enable_stream=enable_stream,
            stream_cls=stream_cls,
        )

    def get(
        self,
        path: str,
        *,
        cast_type: type[ResponseT],
        options: UserRequestInput = {},
        enable_stream: bool = False,
    ) -> ResponseT | StreamResponse:
        opts = ClientRequestParam.construct(method="get", url=path, **options)
        return self.request(cast_type=cast_type, params=opts, enable_stream=enable_stream)

    def post(
        self,
        path: str,
        *,
        body: Body | None = None,
        cast_type: type[ResponseT],
        options: UserRequestInput = {},
        files: RequestFiles | None = None,
        enable_stream: bool = False,
        stream_cls: type[StreamResponse[Any]] | None = None,
    ) -> ResponseT | StreamResponse:
        opts = ClientRequestParam.construct(
            method="post", json_data=body, files=make_httpx_files(files), url=path, **options
        )

        return self.request(cast_type=cast_type, params=opts, enable_stream=enable_stream, stream_cls=stream_cls)

    def patch(
        self,
        path: str,
        *,
        body: Body | None = None,
        cast_type: type[ResponseT],
        options: UserRequestInput = {},
    ) -> ResponseT:
        opts = ClientRequestParam.construct(method="patch", url=path, json_data=body, **options)

        return self.request(
            cast_type=cast_type,
            params=opts,
        )

    def put(
        self,
        path: str,
        *,
        body: Body | None = None,
        cast_type: type[ResponseT],
        options: UserRequestInput = {},
        files: RequestFiles | None = None,
    ) -> ResponseT | StreamResponse:
        opts = ClientRequestParam.construct(
            method="put", url=path, json_data=body, files=make_httpx_files(files), **options
        )

        return self.request(
            cast_type=cast_type,
            params=opts,
        )

    def delete(
        self,
        path: str,
        *,
        body: Body | None = None,
        cast_type: type[ResponseT],
        options: UserRequestInput = {},
    ) -> ResponseT | StreamResponse:
        opts = ClientRequestParam.construct(method="delete", url=path, json_data=body, **options)

        return self.request(
            cast_type=cast_type,
            params=opts,
        )

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


def make_user_request_input(
    max_retries: int | None = None,
    timeout: float | Timeout | None | NotGiven = NOT_GIVEN,
    extra_headers: Headers = None,
    extra_body: Body | None = None,
    query: Query | None = None,
) -> UserRequestInput:
    options: UserRequestInput = {}

    if extra_headers is not None:
        options["headers"] = extra_headers
    if max_retries is not None:
        options["max_retries"] = max_retries
    if not isinstance(timeout, NotGiven):
        options["timeout"] = timeout
    if query is not None:
        options["params"] = query
    if extra_body is not None:
        options["extra_json"] = cast(AnyMapping, extra_body)

    return options
