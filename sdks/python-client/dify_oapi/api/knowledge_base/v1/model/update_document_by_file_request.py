from __future__ import annotations

from io import BytesIO

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest
from .update_document_by_file_request_body import UpdateDocumentByFileRequestBody


class UpdateDocumentByFileRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.dataset_id: str | None = None
        self.document_id: str | None = None
        self.request_body: UpdateDocumentByFileRequestBody | None = None
        self.file: BytesIO | None = None

    @staticmethod
    def builder() -> UpdateDocumentByFileRequestBuilder:
        return UpdateDocumentByFileRequestBuilder()


class UpdateDocumentByFileRequestBuilder(object):
    def __init__(self):
        update_document_by_file_request = UpdateDocumentByFileRequest()
        update_document_by_file_request.http_method = HttpMethod.POST
        update_document_by_file_request.uri = (
            "/v1/datasets/:dataset_id/documents/:document_id/update_by_file"
        )
        self._update_document_by_file_request = update_document_by_file_request

    def build(self) -> UpdateDocumentByFileRequest:
        return self._update_document_by_file_request

    def dataset_id(self, dataset_id: str) -> UpdateDocumentByFileRequestBuilder:
        self._update_document_by_file_request.dataset_id = dataset_id
        self._update_document_by_file_request.paths["dataset_id"] = dataset_id
        return self

    def document_id(self, document_id: str) -> UpdateDocumentByFileRequestBuilder:
        self._update_document_by_file_request.document_id = document_id
        self._update_document_by_file_request.paths["document_id"] = document_id
        return self

    def request_body(
        self, request_body: UpdateDocumentByFileRequestBody
    ) -> UpdateDocumentByFileRequestBuilder:
        self._update_document_by_file_request.request_body = request_body
        self._update_document_by_file_request.body = request_body.model_dump(
            exclude_none=True
        )
        return self

    def file(
        self, file: BytesIO, file_name: str | None = None
    ) -> UpdateDocumentByFileRequestBuilder:
        self._update_document_by_file_request.file = file
        file_name = file_name or "upload"
        self._update_document_by_file_request.files = {"file": (file_name, file)}
        return self
