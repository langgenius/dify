from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest
from .create_segment_request_body import CreateSegmentRequestBody


class CreateSegmentRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.dataset_id: str | None = None
        self.document_id: str | None = None
        self.request_body: CreateSegmentRequestBody | None = None

    @staticmethod
    def builder() -> CreateSegmentRequestBuilder:
        return CreateSegmentRequestBuilder()


class CreateSegmentRequestBuilder(object):
    def __init__(self):
        create_segment_request = CreateSegmentRequest()
        create_segment_request.http_method = HttpMethod.POST
        create_segment_request.uri = (
            "/v1/datasets/:dataset_id/documents/:document_id/segments"
        )
        self._create_segment_request = create_segment_request

    def build(self) -> CreateSegmentRequest:
        return self._create_segment_request

    def dataset_id(self, dataset_id: str) -> CreateSegmentRequestBuilder:
        self._create_segment_request.dataset_id = dataset_id
        self._create_segment_request.paths["dataset_id"] = dataset_id
        return self

    def document_id(self, document_id: str) -> CreateSegmentRequestBuilder:
        self._create_segment_request.document_id = document_id
        self._create_segment_request.paths["document_id"] = document_id
        return self

    def request_body(
        self, request_body: CreateSegmentRequestBody
    ) -> CreateSegmentRequestBuilder:
        self._create_segment_request.request_body = request_body
        self._create_segment_request.body = request_body.model_dump(exclude_none=True)
        return self
