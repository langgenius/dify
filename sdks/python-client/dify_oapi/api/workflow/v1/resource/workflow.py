from collections.abc import AsyncGenerator, Generator
from typing import Literal, overload

from dify_oapi.core.const import APPLICATION_JSON, CONTENT_TYPE
from dify_oapi.core.http.transport import ATransport, Transport
from dify_oapi.core.model.config import Config
from dify_oapi.core.model.request_option import RequestOption

from ..model.get_workflow_log_request import GetWorkflowLogRequest
from ..model.get_workflow_log_response import GetWorkflowLogResponse
from ..model.run_workflow_request import RunWorkflowRequest
from ..model.run_workflow_response import RunWorkflowResponse
from ..model.stop_workflow_request import StopWorkflowRequest
from ..model.stop_workflow_response import StopWorkflowResponse
from ..model.get_workflow_result_request import GetWorkflowResultRequest
from ..model.get_workflow_result_response import GetWorkflowResultResponse


class Workflow:
    def __init__(self, config: Config) -> None:
        self.config: Config = config

    @overload
    def run(
        self,
        request: RunWorkflowRequest,
        option: RequestOption | None,
        stream: Literal[True],
    ) -> Generator[bytes, None, None]: ...

    @overload
    def run(
        self,
        request: RunWorkflowRequest,
        option: RequestOption | None,
        stream: Literal[False],
    ) -> RunWorkflowResponse: ...

    @overload
    def run(
        self, request: RunWorkflowRequest, option: RequestOption | None
    ) -> RunWorkflowResponse: ...

    def run(
        self,
        request: RunWorkflowRequest,
        option: RequestOption | None = None,
        stream: bool = False,
    ):
        if request.body is not None:
            option.headers[CONTENT_TYPE] = f"{APPLICATION_JSON}; charset=utf-8"
        if stream:
            return Transport.execute(self.config, request, option=option, stream=True)
        else:
            return Transport.execute(
                self.config, request, unmarshal_as=RunWorkflowResponse, option=option
            )

    @overload
    async def arun(
        self,
        request: RunWorkflowRequest,
        option: RequestOption | None,
        stream: Literal[True],
    ) -> AsyncGenerator[bytes, None]: ...

    @overload
    def arun(
        self,
        request: RunWorkflowRequest,
        option: RequestOption | None,
        stream: Literal[False],
    ) -> RunWorkflowResponse: ...

    @overload
    async def arun(
        self, request: RunWorkflowRequest, option: RequestOption | None
    ) -> RunWorkflowResponse: ...

    async def arun(
        self,
        request: RunWorkflowRequest,
        option: RequestOption | None = None,
        stream: bool = False,
    ):
        if stream:
            return await ATransport.aexecute(
                self.config, request, option=option, stream=True
            )
        else:
            return await ATransport.aexecute(
                self.config, request, unmarshal_as=RunWorkflowResponse, option=option
            )

    def stop(
        self, request: StopWorkflowRequest, option: RequestOption | None = None
    ) -> StopWorkflowResponse:
        if request.body is not None:
            option.headers[CONTENT_TYPE] = f"{APPLICATION_JSON}; charset=utf-8"
        return Transport.execute(
            self.config, request, unmarshal_as=StopWorkflowResponse, option=option
        )

    async def astop(
        self, request: StopWorkflowRequest, option: RequestOption | None = None
    ) -> StopWorkflowResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=StopWorkflowResponse, option=option
        )

    def result(
        self, request: GetWorkflowResultRequest, option: RequestOption | None = None
    ) -> GetWorkflowResultResponse:
        if request.body is not None:
            option.headers[CONTENT_TYPE] = f"{APPLICATION_JSON}; charset=utf-8"
        return Transport.execute(
            self.config, request, unmarshal_as=GetWorkflowResultResponse, option=option
        )

    async def aresult(
        self, request: GetWorkflowResultRequest, option: RequestOption | None = None
    ) -> GetWorkflowResultResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=GetWorkflowResultResponse, option=option
        )

    def log(self, request: GetWorkflowLogRequest, option: RequestOption | None = None) -> GetWorkflowLogResponse:
        if request.body is not None:
            option.headers[CONTENT_TYPE] = f"{APPLICATION_JSON}; charset=utf-8"
        return Transport.execute(self.config, request, unmarshal_as=GetWorkflowLogResponse, option=option)

    async def alog(self, request: GetWorkflowLogRequest, option: RequestOption | None = None) -> GetWorkflowLogResponse:
        return await ATransport.aexecute(self.config, request, unmarshal_as=GetWorkflowLogResponse, option=option)
