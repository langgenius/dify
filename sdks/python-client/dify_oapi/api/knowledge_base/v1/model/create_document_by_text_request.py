from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest
from .create_document_by_text_request_body import CreateDocumentByTextRequestBody


class CreateDocumentByTextRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.dataset_id: str | None = None
        self.request_body: CreateDocumentByTextRequestBody | None = None

    @staticmethod
    def builder() -> CreateDocumentByTextRequestBuilder:
        return CreateDocumentByTextRequestBuilder()


class CreateDocumentByTextRequestBuilder(object):
    def __init__(self):
        create_document_by_text_request = CreateDocumentByTextRequest()
        create_document_by_text_request.http_method = HttpMethod.POST
        create_document_by_text_request.uri = (
            "/v1/datasets/:dataset_id/document/create_by_text"
        )
        self._create_document_by_text_request = create_document_by_text_request

    def build(self) -> CreateDocumentByTextRequest:
        return self._create_document_by_text_request

    def dataset_id(self, dataset_id: str) -> CreateDocumentByTextRequestBuilder:
        self._create_document_by_text_request.dataset_id = dataset_id
        self._create_document_by_text_request.paths["dataset_id"] = dataset_id
        return self

    def request_body(
        self, request_body: CreateDocumentByTextRequestBody
    ) -> CreateDocumentByTextRequestBuilder:
        self._create_document_by_text_request.request_body = request_body
        self._create_document_by_text_request.body = request_body.model_dump(
            exclude_none=True
        )
        return self
