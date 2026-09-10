"""HTTP fixture for API-tool unit tests."""

import json
from collections.abc import Generator
from typing import Literal

import httpx
import pytest

from core.helper import ssrf_proxy


class MockedHttp:
    @staticmethod
    def httpx_request(
        method: Literal["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"],
        url: str,
        *,
        params: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
        cookies: dict[str, str] | None = None,
        data: object = None,
        **_kwargs: object,
    ) -> httpx.Response:
        """
        Mocked httpx.request
        """
        request = httpx.Request(method, url, params=params, headers=headers, cookies=cookies)
        resp = json.dumps(data).encode("utf-8") if data else b"OK"
        response = httpx.Response(
            status_code=200,
            request=request,
            content=resp,
        )
        return response


@pytest.fixture
def setup_http_mock(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    monkeypatch.setattr(ssrf_proxy, "make_request", MockedHttp.httpx_request)
    yield
    monkeypatch.undo()
