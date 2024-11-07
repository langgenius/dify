from dify_oapi.core.http.transport import ATransport, Transport
from dify_oapi.core.model.config import Config
from dify_oapi.core.model.request_option import RequestOption

from ..model.upload_file_request import UploadFileRequest
from ..model.upload_file_response import UploadFileResponse


class File:
    def __init__(self, config: Config) -> None:
        self.config: Config = config

    def upload(
        self, request: UploadFileRequest, option: RequestOption | None = None
    ) -> UploadFileResponse:
        return Transport.execute(
            self.config, request, unmarshal_as=UploadFileResponse, option=option
        )

    async def aupload(
        self, request: UploadFileRequest, option: RequestOption | None = None
    ) -> UploadFileResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=UploadFileResponse, option=option
        )
