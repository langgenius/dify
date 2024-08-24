import json
from typing import Literal

import httpx
import pytest
from _pytest.monkeypatch import MonkeyPatch


class MockedHttp:
    def httpx_request(
        method: Literal["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"], url: str, **kwargs
    ) -> httpx.Response:
        """
        Mocked httpx.request
        """
        request = httpx.Request(
            method, url, params=kwargs.get("params"), headers=kwargs.get("headers"), cookies=kwargs.get("cookies")
        )
        data = kwargs.get("data", None)
        resp = json.dumps(data).encode("utf-8") if data else b"OK"
        response = httpx.Response(
            status_code=200,
            request=request,
            content=resp,
        )
        return response


@pytest.fixture
def setup_http_mock(request, monkeypatch: MonkeyPatch):
    monkeypatch.setattr(httpx, "request", MockedHttp.httpx_request)
    yield
    monkeypatch.undo()
