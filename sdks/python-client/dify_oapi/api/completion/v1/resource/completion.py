from collections.abc import AsyncGenerator, Generator
from typing import Literal, overload

from dify_oapi.core.const import APPLICATION_JSON, CONTENT_TYPE
from dify_oapi.core.http.transport import ATransport, Transport
from dify_oapi.core.model.config import Config
from dify_oapi.core.model.request_option import RequestOption

from ..model.completion_request import CompletionRequest
from ..model.completion_response import CompletionResponse
from ..model.stop_completion_request import StopCompletionRequest
from ..model.stop_completion_response import StopCompletionResponse


class Completion:
    def __init__(self, config: Config) -> None:
        self.config: Config = config

    @overload
    def completion(
        self,
        request: CompletionRequest,
        option: RequestOption | None,
        stream: Literal[True],
    ) -> Generator[bytes, None, None]: ...

    @overload
    def completion(
        self,
        request: CompletionRequest,
        option: RequestOption | None,
        stream: Literal[False],
    ) -> CompletionResponse: ...

    @overload
    def completion(
        self, request: CompletionRequest, option: RequestOption | None
    ) -> CompletionResponse: ...

    def completion(
        self,
        request: CompletionRequest,
        option: RequestOption | None = None,
        stream: bool = False,
    ):
        if request.body is not None:
            option.headers[CONTENT_TYPE] = f"{APPLICATION_JSON}; charset=utf-8"
        if stream:
            return Transport.execute(self.config, request, option=option, stream=True)
        else:
            return Transport.execute(
                self.config, request, unmarshal_as=CompletionResponse, option=option
            )

    @overload
    async def acompletion(
        self,
        request: CompletionRequest,
        option: RequestOption | None,
        stream: Literal[True],
    ) -> AsyncGenerator[bytes, None]: ...

    @overload
    def acompletion(
        self,
        request: CompletionRequest,
        option: RequestOption | None,
        stream: Literal[False],
    ) -> CompletionResponse: ...

    @overload
    async def acompletion(
        self, request: CompletionRequest, option: RequestOption | None
    ) -> CompletionResponse: ...

    async def acompletion(
        self,
        request: CompletionRequest,
        option: RequestOption | None = None,
        stream: bool = False,
    ):
        if stream:
            return await ATransport.aexecute(
                self.config, request, option=option, stream=True
            )
        else:
            return await ATransport.aexecute(
                self.config, request, unmarshal_as=CompletionResponse, option=option
            )

    def stop(
        self, request: StopCompletionRequest, option: RequestOption | None = None
    ) -> StopCompletionResponse:
        if request.body is not None:
            option.headers[CONTENT_TYPE] = f"{APPLICATION_JSON}; charset=utf-8"
        return Transport.execute(
            self.config, request, unmarshal_as=StopCompletionResponse, option=option
        )

    async def astop(
        self, request: StopCompletionRequest, option: RequestOption | None = None
    ) -> StopCompletionResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=StopCompletionResponse, option=option
        )
