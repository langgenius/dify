from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest


class ListDatasetRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.page: int | None = None
        self.limit: int | None = None

    @staticmethod
    def builder() -> ListDatasetRequestBuilder:
        return ListDatasetRequestBuilder()


class ListDatasetRequestBuilder(object):
    def __init__(self):
        list_dataset_request = ListDatasetRequest()
        list_dataset_request.http_method = HttpMethod.GET
        list_dataset_request.uri = "/v1/datasets"
        self._list_dataset_request = list_dataset_request

    def build(self) -> ListDatasetRequest:
        return self._list_dataset_request

    def page(self, page: int) -> ListDatasetRequestBuilder:
        self._list_dataset_request.page = page
        self._list_dataset_request.add_query("page", page)
        return self

    def limit(self, limit: int) -> ListDatasetRequestBuilder:
        self._list_dataset_request.limit = limit
        self._list_dataset_request.add_query("limit", limit)
        return self
