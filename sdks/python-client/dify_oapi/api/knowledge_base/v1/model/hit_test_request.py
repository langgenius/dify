from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest
from .hit_test_request_body import HitTestRequestBody


class HitTestRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.dataset_id: str | None = None
        self.request_body: HitTestRequestBody | None = None

    @staticmethod
    def builder() -> HitTestRequestBuilder:
        return HitTestRequestBuilder()


class HitTestRequestBuilder(object):
    def __init__(self):
        hit_test_request = HitTestRequest()
        hit_test_request.http_method = HttpMethod.POST
        hit_test_request.uri = "/v1/datasets/:dataset_id/hit-testing"
        self._hit_test_request = hit_test_request

    def build(self) -> HitTestRequest:
        return self._hit_test_request

    def dataset_id(self, dataset_id: str) -> HitTestRequestBuilder:
        self._hit_test_request.dataset_id = dataset_id
        self._hit_test_request.paths["dataset_id"] = dataset_id
        return self

    def request_body(self, request_body: HitTestRequestBody) -> HitTestRequestBuilder:
        self._hit_test_request.request_body = request_body
        self._hit_test_request.body = request_body.model_dump(exclude_none=True)
        return self
