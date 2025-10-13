import os
from typing import Literal

import httpx
import pytest

from core.plugin.entities.plugin_daemon import PluginDaemonBasicResponse
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderEntity, ToolProviderIdentity


class MockedHttp:
    @classmethod
    def list_tools(cls) -> list[ToolProviderEntity]:
        return [
            ToolProviderEntity(
                identity=ToolProviderIdentity(
                    author="Yeuoly",
                    name="Yeuoly",
                    description=I18nObject(en_US="Yeuoly"),
                    icon="ssss.svg",
                    label=I18nObject(en_US="Yeuoly"),
                )
            )
        ]

    @classmethod
    def requests_request(
        cls, method: Literal["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"], url: str, **kwargs
    ) -> httpx.Response:
        """
        Mocked httpx.request
        """
        request = httpx.Request(method, url)
        if url.endswith("/tools"):
            content = PluginDaemonBasicResponse[list[ToolProviderEntity]](
                code=0, message="success", data=cls.list_tools()
            ).model_dump_json()
        else:
            raise ValueError("")

        response = httpx.Response(status_code=200)
        response.request = request
        response._content = content.encode("utf-8")
        return response


MOCK_SWITCH = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_http_mock(request, monkeypatch: pytest.MonkeyPatch):
    if MOCK_SWITCH:
        monkeypatch.setattr(httpx, "request", MockedHttp.requests_request)

        def unpatch():
            monkeypatch.undo()

    yield

    if MOCK_SWITCH:
        unpatch()
