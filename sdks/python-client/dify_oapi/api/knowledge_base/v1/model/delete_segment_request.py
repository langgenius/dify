from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest


class DeleteSegmentRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.dataset_id: str | None = None
        self.document_id: str | None = None
        self.segment_id: str | None = None

    @staticmethod
    def builder() -> DeleteSegmentRequestBuilder:
        return DeleteSegmentRequestBuilder()


class DeleteSegmentRequestBuilder(object):
    def __init__(self):
        delete_segment_request = DeleteSegmentRequest()
        delete_segment_request.http_method = HttpMethod.DELETE
        delete_segment_request.uri = (
            "/v1/datasets/:dataset_id/documents/:document_id/segments/:segment_id"
        )
        self._delete_segment_request = delete_segment_request

    def build(self) -> DeleteSegmentRequest:
        return self._delete_segment_request

    def dataset_id(self, dataset_id: str) -> DeleteSegmentRequestBuilder:
        self._delete_segment_request.dataset_id = dataset_id
        self._delete_segment_request.paths["dataset_id"] = dataset_id
        return self

    def document_id(self, document_id: str) -> DeleteSegmentRequestBuilder:
        self._delete_segment_request.document_id = document_id
        self._delete_segment_request.paths["document_id"] = document_id
        return self

    def segment_id(self, segment_id: str) -> DeleteSegmentRequestBuilder:
        self._delete_segment_request.segment_id = segment_id
        self._delete_segment_request.paths["segment_id"] = segment_id
        return self
