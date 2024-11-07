from dify_oapi.core.http.transport import ATransport, Transport
from dify_oapi.core.model.config import Config
from dify_oapi.core.model.request_option import RequestOption

from ..model.create_dataset_request import CreateDatasetRequest
from ..model.create_dataset_response import CreateDatasetResponse
from ..model.list_dataset_request import ListDatasetRequest
from ..model.list_dataset_response import ListDatasetResponse
from ..model.delete_dataset_request import DeleteDatasetRequest
from ..model.delete_dataset_response import DeleteDatasetResponse
from ..model.hit_test_request import HitTestRequest
from ..model.hit_test_response import HitTestResponse


class Dataset:
    def __init__(self, config: Config) -> None:
        self.config: Config = config

    def create(
        self, request: CreateDatasetRequest, option: RequestOption | None = None
    ) -> CreateDatasetResponse:
        return Transport.execute(
            self.config, request, unmarshal_as=CreateDatasetResponse, option=option
        )

    async def acreate(
        self, request: CreateDatasetRequest, option: RequestOption | None = None
    ) -> CreateDatasetResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=CreateDatasetResponse, option=option
        )

    def list(
        self, request: ListDatasetRequest, option: RequestOption | None = None
    ) -> ListDatasetResponse:
        return Transport.execute(
            self.config, request, unmarshal_as=ListDatasetResponse, option=option
        )

    async def alist(
        self, request: ListDatasetRequest, option: RequestOption | None = None
    ) -> ListDatasetResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=ListDatasetResponse, option=option
        )

    def delete(
        self, request: DeleteDatasetRequest, option: RequestOption | None = None
    ) -> DeleteDatasetResponse:
        return Transport.execute(
            self.config, request, unmarshal_as=DeleteDatasetResponse, option=option
        )

    async def adelete(
        self, request: DeleteDatasetRequest, option: RequestOption | None = None
    ) -> DeleteDatasetResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=DeleteDatasetResponse, option=option
        )

    def hit_test(
        self, request: HitTestRequest, option: RequestOption | None = None
    ) -> HitTestResponse:
        return Transport.execute(
            self.config, request, unmarshal_as=HitTestResponse, option=option
        )

    async def ahit_test(
        self, request: HitTestRequest, option: RequestOption | None = None
    ) -> HitTestResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=HitTestResponse, option=option
        )
