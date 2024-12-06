from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest


class GetInfoRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.user: str | None = None

    @staticmethod
    def builder() -> GetInfoRequestBuilder:
        return GetInfoRequestBuilder()


class GetInfoRequestBuilder:
    def __init__(self) -> None:
        get_info_request = GetInfoRequest()
        get_info_request.http_method = HttpMethod.GET
        get_info_request.uri = "/v1/info"
        self._get_info_request: GetInfoRequest = get_info_request

    def build(self) -> GetInfoRequest:
        return self._get_info_request

    def user(self, user: str) -> GetInfoRequestBuilder:
        self._get_info_request.user = user
        self._get_info_request.add_query("user", user)
        return self
