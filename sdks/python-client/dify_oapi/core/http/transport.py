import json
from collections.abc import AsyncGenerator, Coroutine, Generator
from typing import Literal, overload

import httpx

from dify_oapi.core.const import APPLICATION_JSON, AUTHORIZATION, UTF_8
from dify_oapi.core.json import JSON
from dify_oapi.core.log import logger
from dify_oapi.core.model.base_request import BaseRequest
from dify_oapi.core.model.base_response import BaseResponse
from dify_oapi.core.model.config import Config
from dify_oapi.core.model.raw_response import RawResponse
from dify_oapi.core.model.request_option import RequestOption
from dify_oapi.core.type import T


class Transport:
    @staticmethod
    @overload
    def execute(
        conf: Config,
        req: BaseRequest,
        *,
        stream: Literal[True],
        option: RequestOption | None,
    ) -> Generator[bytes, None, None]: ...

    @staticmethod
    @overload
    def execute(conf: Config, req: BaseRequest) -> BaseResponse: ...

    @staticmethod
    @overload
    def execute(
        conf: Config, req: BaseRequest, *, option: RequestOption | None
    ) -> BaseResponse: ...

    @staticmethod
    @overload
    def execute(
        conf: Config,
        req: BaseRequest,
        *,
        unmarshal_as: type[T],
        option: RequestOption | None,
    ) -> T: ...

    @staticmethod
    def execute(
        conf: Config,
        req: BaseRequest,
        *,
        stream: bool = False,
        unmarshal_as: type[T] | None = None,
        option: RequestOption | None = None,
    ):
        if unmarshal_as is None:
            unmarshal_as = BaseResponse
        if option is None:
            option = RequestOption()
        # 拼接url
        url: str = _build_url(conf.domain, req.uri, req.paths)
        # 组装header
        headers: dict[str, str] = _build_header(req, option)
        json_, files, data = None, None, None
        if req.files:
            # multipart/form-data
            files = req.files
            if req.body is not None:
                data = json.loads(JSON.marshal(req.body))
        elif req.body is not None:
            # application/json
            json_ = json.loads(JSON.marshal(req.body))

        if stream:

            def _stream_generator() -> Generator[bytes, None, None]:
                with (
                    httpx.Client() as _client,
                    _client.stream(
                        str(req.http_method.name),
                        url,
                        headers=headers,
                        params=req.queries,
                        json=json_,
                        data=data,
                        files=files,
                        timeout=conf.timeout,
                    ) as async_response,
                ):
                    logger.debug(
                        f"{str(req.http_method.name)} {url} {async_response.status_code}, "
                        f"headers: {JSON.marshal(headers)}, "
                        f"params: {JSON.marshal(req.queries)}, "
                        f"stream response"
                    )
                    yield from async_response.iter_bytes()

            return _stream_generator()
        with httpx.Client() as client:
            response = client.request(
                str(req.http_method.name),
                url,
                headers=headers,
                params=req.queries,
                json=json_,
                data=data,
                files=files,
                timeout=conf.timeout,
            )
            logger.debug(
                f"{str(req.http_method.name)} {url} {response.status_code}, "
                f"headers: {JSON.marshal(headers)}, "
                f"params: {JSON.marshal(req.queries)}, "
                f"body: {str(data, UTF_8) if isinstance(data, bytes) else data}"
            )

            raw_resp = RawResponse()
            raw_resp.status_code = response.status_code
            raw_resp.headers = dict(response.headers)
            raw_resp.content = response.content
            return _unmarshaller(raw_resp, unmarshal_as)


class ATransport:
    @staticmethod
    @overload
    def aexecute(
        conf: Config,
        req: BaseRequest,
        *,
        stream: Literal[True],
        option: RequestOption | None,
    ) -> Coroutine[None, None, AsyncGenerator[bytes, None]]: ...

    @staticmethod
    @overload
    def aexecute(
        conf: Config, req: BaseRequest
    ) -> Coroutine[None, None, BaseResponse]: ...

    @staticmethod
    @overload
    def aexecute(
        conf: Config, req: BaseRequest, *, option: RequestOption | None
    ) -> Coroutine[None, None, BaseResponse]: ...

    @staticmethod
    @overload
    def aexecute(
        conf: Config,
        req: BaseRequest,
        *,
        unmarshal_as: type[T],
        option: RequestOption | None,
    ) -> Coroutine[None, None, T]: ...

    @staticmethod
    async def aexecute(
        conf: Config,
        req: BaseRequest,
        *,
        stream: bool = False,
        unmarshal_as: type[T] | None = None,
        option: RequestOption | None = None,
    ):
        if option is None:
            option = RequestOption()

        # 拼接url
        url: str = _build_url(conf.domain, req.uri, req.paths)

        # 组装header
        headers: dict[str, str] = _build_header(req, option)

        json_, files, data = None, None, None
        if req.files:
            # multipart/form-data
            files = req.files
            if req.body is not None:
                data = json.loads(JSON.marshal(req.body))
        elif req.body is not None:
            # application/json
            json_ = json.loads(JSON.marshal(req.body))

        if stream:

            async def _async_stream_generator():
                async with (
                    httpx.AsyncClient() as _client,
                    _client.stream(
                        str(req.http_method.name),
                        url,
                        headers=req.headers,
                        params=req.queries,
                        json=json_,
                        data=data,
                        files=files,
                        timeout=conf.timeout,
                    ) as async_response,
                ):
                    logger.debug(
                        f"{str(req.http_method.name)} {url} {async_response.status_code}, "
                        f"headers: {JSON.marshal(headers)}, "
                        f"params: {JSON.marshal(req.queries)}, "
                        f"stream response"
                    )
                    async for chunk in async_response.aiter_bytes():
                        yield chunk

            return _async_stream_generator()
        async with httpx.AsyncClient() as client:
            response = await client.request(
                str(req.http_method.name),
                url,
                headers=req.headers,
                params=req.queries,
                json=json_,
                data=data,
                files=files,
                timeout=conf.timeout,
            )

            logger.debug(
                f"{str(req.http_method.name)} {url} {response.status_code}"
                f"{f', headers: {JSON.marshal(headers)}' if headers else ''}"
                f"{f', params: {JSON.marshal(req.queries)}' if req.queries else ''}"
                f"{f', body: {JSON.marshal(_merge_dicts(json_, files, data))}' if json_ or files or data else ''}"
            )

            raw_resp = RawResponse()
            raw_resp.status_code = response.status_code
            raw_resp.headers = dict(response.headers)
            raw_resp.content = response.content

            return _unmarshaller(raw_resp, unmarshal_as)


def _build_url(domain: str, uri: str, paths: dict[str, str]) -> str:
    if paths is None:
        paths = {}
    for key in paths:
        uri = uri.replace(":" + key, paths[key])
    if domain.endswith("/") and uri.startswith("/"):
        domain = domain[:-1]
    return domain + uri


def _build_header(request: BaseRequest, option: RequestOption) -> dict[str, str]:
    headers = request.headers
    # 附加header
    if option.headers is not None:
        for key in option.headers:
            headers[key] = option.headers[key]
    if option.api_key is not None:
        headers[AUTHORIZATION] = f"Bearer {option.api_key}"
    return headers


def _merge_dicts(*dicts):
    res = {}
    for d in dicts:
        if d is not None:
            res.update(d)
    return res


def _unmarshaller(raw_resp: RawResponse, unmarshal_as: type[T]) -> T:
    if not (200 <= raw_resp.status_code < 300):
        resp = unmarshal_as(
            raw=raw_resp, code=raw_resp.status_code, msg=raw_resp.content.decode()
        )
        return resp
    resp = unmarshal_as()
    if raw_resp.content_type is not None and raw_resp.content_type.startswith(
        APPLICATION_JSON
    ):
        content = str(raw_resp.content, UTF_8)
        if content != "":
            try:
                resp = JSON.unmarshal(content, unmarshal_as)
            except Exception as e:
                logger.error(f"Failed to unmarshal to {unmarshal_as} from {content}")
                raise e
    resp.raw = raw_resp
    resp.code = 0
    return resp
