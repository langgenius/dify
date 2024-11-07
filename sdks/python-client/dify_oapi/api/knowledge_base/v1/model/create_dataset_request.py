from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest
from .create_dataset_request_body import CreateDatasetRequestBody


class CreateDatasetRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.request_body: CreateDatasetRequestBody | None = None

    @staticmethod
    def builder() -> CreateDatasetRequestBuilder:
        return CreateDatasetRequestBuilder()


class CreateDatasetRequestBuilder(object):
    def __init__(self):
        create_dataset_request = CreateDatasetRequest()
        create_dataset_request.http_method = HttpMethod.POST
        create_dataset_request.uri = "/v1/datasets"
        self._create_dataset_request = create_dataset_request

    def build(self) -> CreateDatasetRequest:
        return self._create_dataset_request

    def request_body(
        self, request_body: CreateDatasetRequestBody
    ) -> CreateDatasetRequestBuilder:
        self._create_dataset_request.request_body = request_body
        self._create_dataset_request.body = request_body.model_dump(exclude_none=True)
        return self
