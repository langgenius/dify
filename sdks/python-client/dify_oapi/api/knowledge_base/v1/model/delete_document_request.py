from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest


class DeleteDocumentRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.dataset_id: str | None = None
        self.document_id: str | None = None

    @staticmethod
    def builder() -> DeleteDocumentRequestBuilder:
        return DeleteDocumentRequestBuilder()


class DeleteDocumentRequestBuilder(object):
    def __init__(self):
        delete_document_request = DeleteDocumentRequest()
        delete_document_request.http_method = HttpMethod.DELETE
        delete_document_request.uri = "/v1/datasets/:dataset_id/documents/:document_id"
        self._delete_document_request = delete_document_request

    def build(self) -> DeleteDocumentRequest:
        return self._delete_document_request

    def dataset_id(self, dataset_id: str) -> DeleteDocumentRequestBuilder:
        self._delete_document_request.dataset_id = dataset_id
        self._delete_document_request.paths["dataset_id"] = dataset_id
        return self

    def document_id(self, document_id: str) -> DeleteDocumentRequestBuilder:
        self._delete_document_request.document_id = document_id
        self._delete_document_request.paths["document_id"] = document_id
        return self
