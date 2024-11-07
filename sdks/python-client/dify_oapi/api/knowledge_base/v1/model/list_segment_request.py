from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest


class ListSegmentRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.dataset_id: str | None = None
        self.document_id: str | None = None
        self.keyword: str | None = None
        self.status: str | None = None

    @staticmethod
    def builder() -> ListSegmentRequestBuilder:
        return ListSegmentRequestBuilder()


class ListSegmentRequestBuilder(object):
    def __init__(self):
        list_segment_request = ListSegmentRequest()
        list_segment_request.http_method = HttpMethod.GET
        list_segment_request.uri = (
            "/v1/datasets/:dataset_id/documents/:document_id/segments"
        )
        self._list_segment_request = list_segment_request

    def build(self) -> ListSegmentRequest:
        return self._list_segment_request

    def dataset_id(self, dataset_id: str) -> ListSegmentRequestBuilder:
        self._list_segment_request.dataset_id = dataset_id
        self._list_segment_request.paths["dataset_id"] = dataset_id
        return self

    def document_id(self, document_id: str) -> ListSegmentRequestBuilder:
        self._list_segment_request.document_id = document_id
        self._list_segment_request.paths["document_id"] = document_id
        return self

    def keyword(self, keyword: str) -> ListSegmentRequestBuilder:
        self._list_segment_request.keyword = keyword
        self._list_segment_request.add_query("keyword", keyword)
        return self

    def status(self, status: str) -> ListSegmentRequestBuilder:
        self._list_segment_request.status = status
        self._list_segment_request.add_query("status", status)
        return self
