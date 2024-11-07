from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest


class GetMetaRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.user: str | None = None

    @staticmethod
    def builder() -> GetMetaRequestBuilder:
        return GetMetaRequestBuilder()


class GetMetaRequestBuilder(object):
    def __init__(self):
        get_meta_request = GetMetaRequest()
        get_meta_request.http_method = HttpMethod.GET
        get_meta_request.uri = "/v1/meta"
        self._get_meta_request = get_meta_request

    def build(self) -> GetMetaRequest:
        return self._get_meta_request

    def user(self, user: str) -> GetMetaRequestBuilder:
        self._get_meta_request.user = user
        self._get_meta_request.add_query("user", user)
        return self
