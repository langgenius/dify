from __future__ import annotations

from io import BytesIO

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest
from .upload_file_body import UploadFileBody


class UploadFileRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.file: BytesIO | None = None
        self.request_body: UploadFileBody | None = None

    @staticmethod
    def builder() -> UploadFileRequestBuilder:
        return UploadFileRequestBuilder()


class UploadFileRequestBuilder:
    def __init__(self) -> None:
        upload_file_request = UploadFileRequest()
        upload_file_request.http_method = HttpMethod.POST
        upload_file_request.uri = "/v1/files/upload"
        self._upload_file_request: UploadFileRequest = upload_file_request

    def build(self) -> UploadFileRequest:
        return self._upload_file_request

    def file(
        self, file: BytesIO, file_name: str | None = None
    ) -> UploadFileRequestBuilder:
        self._upload_file_request.file = file
        if file_name is None:
            file_name = "upload"
        self._upload_file_request.files = {"file": (file_name, file)}
        return self

    def request_body(self, request_body: UploadFileBody) -> UploadFileRequestBuilder:
        self._upload_file_request.request_body = request_body
        self._upload_file_request.body = request_body.model_dump(exclude_none=True)
        return self
