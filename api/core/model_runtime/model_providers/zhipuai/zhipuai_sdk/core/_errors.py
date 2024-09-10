from __future__ import annotations

import httpx

__all__ = [
    "ZhipuAIError",
    "APIStatusError",
    "APIRequestFailedError",
    "APIAuthenticationError",
    "APIReachLimitError",
    "APIInternalError",
    "APIServerFlowExceedError",
    "APIResponseError",
    "APIResponseValidationError",
    "APITimeoutError",
]


class ZhipuAIError(Exception):
    def __init__(
        self,
        message: str,
    ) -> None:
        super().__init__(message)


class APIStatusError(Exception):
    response: httpx.Response
    status_code: int

    def __init__(self, message: str, *, response: httpx.Response) -> None:
        super().__init__(message)
        self.response = response
        self.status_code = response.status_code


class APIRequestFailedError(APIStatusError): ...


class APIAuthenticationError(APIStatusError): ...


class APIReachLimitError(APIStatusError): ...


class APIInternalError(APIStatusError): ...


class APIServerFlowExceedError(APIStatusError): ...


class APIResponseError(Exception):
    message: str
    request: httpx.Request
    json_data: object

    def __init__(self, message: str, request: httpx.Request, json_data: object):
        self.message = message
        self.request = request
        self.json_data = json_data
        super().__init__(message)


class APIResponseValidationError(APIResponseError):
    status_code: int
    response: httpx.Response

    def __init__(self, response: httpx.Response, json_data: object | None, *, message: str | None = None) -> None:
        super().__init__(
            message=message or "Data returned by API invalid for expected schema.",
            request=response.request,
            json_data=json_data,
        )
        self.response = response
        self.status_code = response.status_code


class APITimeoutError(Exception):
    request: httpx.Request

    def __init__(self, request: httpx.Request):
        self.request = request
        super().__init__("Request Timeout")
