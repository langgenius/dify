from __future__ import annotations


class RequestOption:
    def __init__(self):
        self.api_key: str | None = None
        self.headers: dict[str, str] = {}

    @staticmethod
    def builder() -> RequestOptionBuilder:
        return RequestOptionBuilder()


class RequestOptionBuilder:
    def __init__(self) -> None:
        self._request_option: RequestOption = RequestOption()

    def api_key(self, api_key: str) -> RequestOptionBuilder:
        self._request_option.api_key = api_key
        return self

    def headers(self, headers: dict[str, str]) -> RequestOptionBuilder:
        self._request_option.headers = headers
        return self

    def build(self) -> RequestOption:
        return self._request_option
