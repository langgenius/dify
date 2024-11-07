from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest
from .update_document_by_text_request_body import UpdateDocumentByTextRequestBody


class UpdateDocumentByTextRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.dataset_id: str | None = None
        self.document_id: str | None = None
        self.request_body: UpdateDocumentByTextRequestBody | None = None

    @staticmethod
    def builder() -> UpdateDocumentByTextRequestBuilder:
        return UpdateDocumentByTextRequestBuilder()


class UpdateDocumentByTextRequestBuilder(object):
    def __init__(self):
        create_document_by_text_request = UpdateDocumentByTextRequest()
        create_document_by_text_request.http_method = HttpMethod.POST
        create_document_by_text_request.uri = (
            "/v1/datasets/:dataset_id/documents/:document_id/update_by_text"
        )
        self._create_document_by_text_request = create_document_by_text_request

    def build(self) -> UpdateDocumentByTextRequest:
        return self._create_document_by_text_request

    def dataset_id(self, dataset_id: str) -> UpdateDocumentByTextRequestBuilder:
        self._create_document_by_text_request.dataset_id = dataset_id
        self._create_document_by_text_request.paths["dataset_id"] = dataset_id
        return self

    def document_id(self, document_id: str) -> UpdateDocumentByTextRequestBuilder:
        self._create_document_by_text_request.document_id = document_id
        self._create_document_by_text_request.paths["document_id"] = document_id
        return self

    def request_body(
        self, request_body: UpdateDocumentByTextRequestBody
    ) -> UpdateDocumentByTextRequestBuilder:
        self._create_document_by_text_request.request_body = request_body
        self._create_document_by_text_request.body = request_body.model_dump(
            exclude_none=True
        )
        return self
