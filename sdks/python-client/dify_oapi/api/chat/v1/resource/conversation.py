from dify_oapi.core.const import APPLICATION_JSON, CONTENT_TYPE
from dify_oapi.core.http.transport import ATransport, Transport
from dify_oapi.core.model.config import Config
from dify_oapi.core.model.request_option import RequestOption

from ..model.delete_conversation_request import DeleteConversationRequest
from ..model.delete_conversation_response import DeleteConversationResponse
from ..model.get_conversation_list_request import GetConversationListRequest
from ..model.get_conversation_list_response import GetConversationListResponse
from ..model.rename_conversation_request import RenameConversationRequest
from ..model.rename_conversation_response import RenameConversationResponse


class Conversation:
    def __init__(self, config: Config) -> None:
        self.config: Config = config

    def list(
        self, request: GetConversationListRequest, option: RequestOption | None = None
    ) -> GetConversationListResponse:
        # 添加 content-type
        if request.body is not None:
            option.headers[CONTENT_TYPE] = f"{APPLICATION_JSON}; charset=utf-8"

        # 发起请求
        return Transport.execute(
            self.config,
            request,
            unmarshal_as=GetConversationListResponse,
            option=option,
        )

    async def alist(
        self, request: GetConversationListRequest, option: RequestOption | None = None
    ) -> GetConversationListResponse:
        # 发起请求
        return await ATransport.aexecute(
            self.config,
            request,
            unmarshal_as=GetConversationListResponse,
            option=option,
        )

    def delete(
        self, request: DeleteConversationRequest, option: RequestOption | None = None
    ) -> DeleteConversationResponse:
        if request.body is not None:
            option.headers[CONTENT_TYPE] = f"{APPLICATION_JSON}; charset=utf-8"
        return Transport.execute(
            self.config, request, unmarshal_as=DeleteConversationResponse, option=option
        )

    async def adelete(
        self, request: DeleteConversationRequest, option: RequestOption | None = None
    ) -> DeleteConversationResponse:
        # 发起请求
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=DeleteConversationResponse, option=option
        )

    def rename(
        self, request: RenameConversationRequest, option: RequestOption | None = None
    ) -> RenameConversationResponse:
        if request.body is not None:
            option.headers[CONTENT_TYPE] = f"{APPLICATION_JSON}; charset=utf-8"
        return Transport.execute(
            self.config, request, unmarshal_as=RenameConversationResponse, option=option
        )

    async def arename(
        self, request: RenameConversationRequest, option: RequestOption | None = None
    ) -> RenameConversationResponse:
        # 发起请求
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=RenameConversationResponse, option=option
        )
