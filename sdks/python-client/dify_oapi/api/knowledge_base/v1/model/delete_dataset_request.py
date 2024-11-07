from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest


class DeleteDatasetRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.dataset_id: str | None = None

    @staticmethod
    def builder() -> DeleteDatasetRequestBuilder:
        return DeleteDatasetRequestBuilder()


class DeleteDatasetRequestBuilder(object):
    def __init__(self):
        delete_dataset_request = DeleteDatasetRequest()
        delete_dataset_request.http_method = HttpMethod.DELETE
        delete_dataset_request.uri = "/v1/datasets/:dataset_id"
        self._delete_dataset_request = delete_dataset_request

    def build(self) -> DeleteDatasetRequest:
        return self._delete_dataset_request

    def dataset_id(self, dataset_id: str) -> DeleteDatasetRequestBuilder:
        self._delete_dataset_request.dataset_id = dataset_id
        self._delete_dataset_request.paths["dataset_id"] = dataset_id
        return self
