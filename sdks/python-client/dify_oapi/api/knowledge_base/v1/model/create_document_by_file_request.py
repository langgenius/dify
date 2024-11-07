from __future__ import annotations

from io import BytesIO

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest
from .create_document_by_file_request_body import CreateDocumentByFileRequestBody


class CreateDocumentByFileRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.dataset_id: str | None = None
        self.request_body: CreateDocumentByFileRequestBody | None = None
        self.file: BytesIO | None = None

    @staticmethod
    def builder() -> CreateDocumentByFileRequestBuilder:
        return CreateDocumentByFileRequestBuilder()


class CreateDocumentByFileRequestBuilder(object):
    def __init__(self):
        create_document_by_file_request = CreateDocumentByFileRequest()
        create_document_by_file_request.http_method = HttpMethod.POST
        create_document_by_file_request.uri = (
            "/v1/datasets/:dataset_id/document/create_by_file"
        )
        self._create_document_by_file_request = create_document_by_file_request

    def build(self) -> CreateDocumentByFileRequest:
        return self._create_document_by_file_request

    def dataset_id(self, dataset_id: str) -> CreateDocumentByFileRequestBuilder:
        self._create_document_by_file_request.dataset_id = dataset_id
        self._create_document_by_file_request.paths["dataset_id"] = dataset_id
        return self

    def request_body(
        self, request_body: CreateDocumentByFileRequestBody
    ) -> CreateDocumentByFileRequestBuilder:
        self._create_document_by_file_request.request_body = request_body
        self._create_document_by_file_request.body = request_body.model_dump(
            exclude_none=True
        )
        return self

    def file(
        self, file: BytesIO, file_name: str | None = None
    ) -> CreateDocumentByFileRequestBuilder:
        self._create_document_by_file_request.file = file
        file_name = file_name or "upload"
        self._create_document_by_file_request.files = {"file": (file_name, file)}
        return self
