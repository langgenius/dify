from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest


class IndexStatusRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.dataset_id: str | None = None
        self.batch: str | None = None

    @staticmethod
    def builder() -> IndexStatusRequestBuilder:
        return IndexStatusRequestBuilder()


class IndexStatusRequestBuilder(object):
    def __init__(self):
        index_status_request = IndexStatusRequest()
        index_status_request.http_method = HttpMethod.GET
        index_status_request.uri = (
            "/v1/datasets/:dataset_id/documents/:batch/indexing-status"
        )
        self._index_status_request = index_status_request

    def build(self) -> IndexStatusRequest:
        return self._index_status_request

    def dataset(self, dataset_id: str) -> IndexStatusRequestBuilder:
        self._index_status_request.dataset_id = dataset_id
        self._index_status_request.paths["dataset_id"] = dataset_id
        return self

    def batch(self, batch: str) -> IndexStatusRequestBuilder:
        self._index_status_request.batch = batch
        self._index_status_request.paths["batch"] = batch
        return self
