from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest
from .update_segment_request_body import UpdateSegmentRequestBody


class UpdateSegmentRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.dataset_id: str | None = None
        self.document_id: str | None = None
        self.segment_id: str | None = None
        self.request_body: UpdateSegmentRequestBody | None = None

    @staticmethod
    def builder() -> UpdateSegmentRequestBuilder:
        return UpdateSegmentRequestBuilder()


class UpdateSegmentRequestBuilder(object):
    def __init__(self):
        update_segment_request = UpdateSegmentRequest()
        update_segment_request.http_method = HttpMethod.POST
        update_segment_request.uri = (
            "/v1/datasets/:dataset_id/documents/:document_id/segments/:segment_id"
        )
        self._update_segment_request = update_segment_request

    def build(self) -> UpdateSegmentRequest:
        return self._update_segment_request

    def dataset_id(self, dataset_id: str) -> UpdateSegmentRequestBuilder:
        self._update_segment_request.dataset_id = dataset_id
        self._update_segment_request.paths["dataset_id"] = dataset_id
        return self

    def document_id(self, document_id: str) -> UpdateSegmentRequestBuilder:
        self._update_segment_request.document_id = document_id
        self._update_segment_request.paths["document_id"] = document_id
        return self

    def segment_id(self, segment_id: str) -> UpdateSegmentRequestBuilder:
        self._update_segment_request.segment_id = segment_id
        self._update_segment_request.paths["segment_id"] = segment_id
        return self

    def request_body(
        self, request_body: UpdateSegmentRequestBody
    ) -> UpdateSegmentRequestBuilder:
        self._update_segment_request.request_body = request_body
        self._update_segment_request.body = request_body.model_dump(exclude_none=True)
        return self
