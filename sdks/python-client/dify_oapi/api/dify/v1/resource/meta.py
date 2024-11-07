from dify_oapi.core.http.transport import ATransport, Transport
from dify_oapi.core.model.config import Config
from dify_oapi.core.model.request_option import RequestOption

from ..model.get_meta_request import GetMetaRequest
from ..model.get_meta_response import GetMetaResponse


class Meta:
    def __init__(self, config: Config) -> None:
        self.config: Config = config

    def get(
        self, request: GetMetaRequest, option: RequestOption | None = None
    ) -> GetMetaResponse:
        return Transport.execute(
            self.config, request, unmarshal_as=GetMetaResponse, option=option
        )

    async def aget(
        self, request: GetMetaRequest, option: RequestOption | None = None
    ) -> GetMetaResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=GetMetaResponse, option=option
        )
