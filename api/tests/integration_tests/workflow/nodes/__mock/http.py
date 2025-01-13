import os
from json import dumps
from typing import Literal

import httpx
import pytest
from _pytest.monkeypatch import MonkeyPatch

from core.helper import ssrf_proxy

MOCK = os.getenv("MOCK_SWITCH", "false") == "true"


class MockedHttp:
    @staticmethod
    def httpx_request(
        method: Literal["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"], url: str, **kwargs
    ) -> httpx.Response:
        """
        Mocked httpx.request
        """
        if url == "http://404.com":
            response = httpx.Response(status_code=404, request=httpx.Request(method, url), content=b"Not Found")
            return response

        # get data, files
        data = kwargs.get("data")
        files = kwargs.get("files")
        json = kwargs.get("json")
        content = kwargs.get("content")
        if data is not None:
            resp = dumps(data).encode("utf-8")
        elif files is not None:
            resp = dumps(files).encode("utf-8")
        elif json is not None:
            resp = dumps(json).encode("utf-8")
        elif content is not None:
            resp = content
        else:
            resp = b"OK"

        response = httpx.Response(
            status_code=200, request=httpx.Request(method, url), headers=kwargs.get("headers", {}), content=resp
        )
        return response


@pytest.fixture
def setup_http_mock(request, monkeypatch: MonkeyPatch):
    if not MOCK:
        yield
        return

    monkeypatch.setattr(ssrf_proxy, "make_request", MockedHttp.httpx_request)
    yield
    monkeypatch.undo()
