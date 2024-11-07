from dify_oapi.core.http.transport import ATransport, Transport
from dify_oapi.core.model.config import Config
from dify_oapi.core.model.request_option import RequestOption

from ..model.create_segment_request import CreateSegmentRequest
from ..model.create_segment_response import CreateSegmentResponse
from ..model.list_segment_request import ListSegmentRequest
from ..model.list_segment_response import ListSegmentResponse
from ..model.delete_segment_request import DeleteSegmentRequest
from ..model.delete_segment_response import DeleteSegmentResponse
from ..model.update_segment_request import UpdateSegmentRequest
from ..model.update_segment_response import UpdateSegmentResponse


class Segment:
    def __init__(self, config: Config) -> None:
        self.config: Config = config

    def create(
        self, request: CreateSegmentRequest, option: RequestOption | None = None
    ) -> CreateSegmentResponse:
        return Transport.execute(
            self.config, request, unmarshal_as=CreateSegmentResponse, option=option
        )

    async def acreate(
        self, request: CreateSegmentRequest, option: RequestOption | None = None
    ) -> CreateSegmentResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=CreateSegmentResponse, option=option
        )

    def list(
        self, request: ListSegmentRequest, option: RequestOption | None = None
    ) -> ListSegmentResponse:
        return Transport.execute(
            self.config, request, unmarshal_as=ListSegmentResponse, option=option
        )

    async def alist(
        self, request: ListSegmentRequest, option: RequestOption | None = None
    ) -> ListSegmentResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=ListSegmentResponse, option=option
        )

    def delete(
        self, request: DeleteSegmentRequest, option: RequestOption | None = None
    ) -> DeleteSegmentResponse:
        return Transport.execute(
            self.config, request, unmarshal_as=DeleteSegmentResponse, option=option
        )

    async def adelete(
        self, request: DeleteSegmentRequest, option: RequestOption | None = None
    ) -> DeleteSegmentResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=DeleteSegmentResponse, option=option
        )

    def update(
        self, request: UpdateSegmentRequest, option: RequestOption | None = None
    ) -> UpdateSegmentResponse:
        return Transport.execute(
            self.config, request, unmarshal_as=UpdateSegmentResponse, option=option
        )

    async def aupdate(
        self, request: UpdateSegmentRequest, option: RequestOption | None = None
    ) -> UpdateSegmentResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=UpdateSegmentResponse, option=option
        )
