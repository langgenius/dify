from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest


class ListDocumentRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.dataset_id: str | None = None
        self.keyword: str | None = None
        self.page: int | None = None
        self.limit: int | None = None

    @staticmethod
    def builder() -> ListDocumentRequestBuilder:
        return ListDocumentRequestBuilder()


class ListDocumentRequestBuilder(object):
    def __init__(self):
        list_document_request = ListDocumentRequest()
        list_document_request.http_method = HttpMethod.GET
        list_document_request.uri = "/v1/datasets/:dataset_id/documents"
        self._list_document_request = list_document_request

    def build(self) -> ListDocumentRequest:
        return self._list_document_request

    def dataset_id(self, dataset_id: str) -> ListDocumentRequestBuilder:
        self._list_document_request.dataset_id = dataset_id
        self._list_document_request.paths["dataset_id"] = dataset_id
        return self

    def keyword(self, keyword: str) -> ListDocumentRequestBuilder:
        self._list_document_request.keyword = keyword
        self._list_document_request.add_query("keyword", keyword)
        return self

    def page(self, page: int) -> ListDocumentRequestBuilder:
        self._list_document_request.page = page
        self._list_document_request.add_query("page", page)
        return self

    def limit(self, limit: int) -> ListDocumentRequestBuilder:
        self._list_document_request.limit = limit
        self._list_document_request.add_query("limit", limit)
        return self
