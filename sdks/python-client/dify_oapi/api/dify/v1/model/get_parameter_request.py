from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest


class GetParameterRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.user: str | None = None

    @staticmethod
    def builder() -> GetParameterRequestBuilder:
        return GetParameterRequestBuilder()


class GetParameterRequestBuilder:
    def __init__(self) -> None:
        get_parameter_request = GetParameterRequest()
        get_parameter_request.http_method = HttpMethod.GET
        get_parameter_request.uri = "/v1/parameters"
        self._get_parameter_request: GetParameterRequest = get_parameter_request

    def build(self) -> GetParameterRequest:
        return self._get_parameter_request

    def user(self, user: str) -> GetParameterRequestBuilder:
        self._get_parameter_request.user = user
        self._get_parameter_request.add_query("user", user)
        return self
