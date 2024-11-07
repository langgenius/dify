from collections.abc import AsyncGenerator, Generator
from typing import Literal, overload

from dify_oapi.core.const import APPLICATION_JSON, CONTENT_TYPE
from dify_oapi.core.http.transport import ATransport, Transport
from dify_oapi.core.model.config import Config
from dify_oapi.core.model.request_option import RequestOption

from ..model.chat_request import ChatRequest
from ..model.chat_response import ChatResponse
from ..model.stop_chat_request import StopChatRequest
from ..model.stop_chat_response import StopChatResponse


class Chat:
    def __init__(self, config: Config) -> None:
        self.config: Config = config

    @overload
    def chat(
        self, request: ChatRequest, option: RequestOption | None, stream: Literal[True]
    ) -> Generator[bytes, None, None]: ...

    @overload
    def chat(
        self, request: ChatRequest, option: RequestOption | None, stream: Literal[False]
    ) -> ChatResponse: ...

    @overload
    def chat(
        self, request: ChatRequest, option: RequestOption | None
    ) -> ChatResponse: ...

    def chat(
        self,
        request: ChatRequest,
        option: RequestOption | None = None,
        stream: bool = False,
    ):
        if request.body is not None:
            option.headers[CONTENT_TYPE] = f"{APPLICATION_JSON}; charset=utf-8"
        if stream:
            return Transport.execute(self.config, request, option=option, stream=True)
        else:
            return Transport.execute(
                self.config, request, unmarshal_as=ChatResponse, option=option
            )

    @overload
    async def achat(
        self, request: ChatRequest, option: RequestOption | None, stream: Literal[True]
    ) -> AsyncGenerator[bytes, None]: ...

    @overload
    def achat(
        self, request: ChatRequest, option: RequestOption | None, stream: Literal[False]
    ) -> ChatResponse: ...

    @overload
    async def achat(
        self, request: ChatRequest, option: RequestOption | None
    ) -> ChatResponse: ...

    async def achat(
        self,
        request: ChatRequest,
        option: RequestOption | None = None,
        stream: bool = False,
    ):
        if stream:
            return await ATransport.aexecute(
                self.config, request, option=option, stream=True
            )
        else:
            return await ATransport.aexecute(
                self.config, request, unmarshal_as=ChatResponse, option=option
            )

    def stop(
        self, request: StopChatRequest, option: RequestOption | None = None
    ) -> StopChatResponse:
        if request.body is not None:
            option.headers[CONTENT_TYPE] = f"{APPLICATION_JSON}; charset=utf-8"
        return Transport.execute(
            self.config, request, unmarshal_as=StopChatResponse, option=option
        )

    async def astop(
        self, request: StopChatRequest, option: RequestOption | None = None
    ) -> StopChatResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=StopChatResponse, option=option
        )
