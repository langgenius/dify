import os
from collections.abc import Callable
from typing import Literal

import httpx
import pytest
from _pytest.monkeypatch import MonkeyPatch


def mock_get(*args, **kwargs):
    if kwargs.get("headers", {}).get("Authorization") != "Bearer test":
        raise httpx.HTTPStatusError(
            "Invalid API key",
            request=httpx.Request("GET", ""),
            response=httpx.Response(401),
        )

    return httpx.Response(
        200,
        json={
            "items": [
                {"title": "Model 1", "_id": "model1"},
                {"title": "Model 2", "_id": "model2"},
            ]
        },
        request=httpx.Request("GET", ""),
    )


def mock_stream(*args, **kwargs):
    class MockStreamResponse:
        def __init__(self):
            self.status_code = 200

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            pass

        def iter_bytes(self):
            yield b"Mocked audio data"

    return MockStreamResponse()


def mock_fishaudio(
    monkeypatch: MonkeyPatch,
    methods: list[Literal["list-models", "tts"]],
) -> Callable[[], None]:
    """
    mock fishaudio module

    :param monkeypatch: pytest monkeypatch fixture
    :return: unpatch function
    """

    def unpatch() -> None:
        monkeypatch.undo()

    if "list-models" in methods:
        monkeypatch.setattr(httpx, "get", mock_get)

    if "tts" in methods:
        monkeypatch.setattr(httpx, "stream", mock_stream)

    return unpatch


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture()
def setup_fishaudio_mock(request, monkeypatch):
    methods = request.param if hasattr(request, "param") else []
    if MOCK:
        unpatch = mock_fishaudio(monkeypatch, methods=methods)

    yield

    if MOCK:
        unpatch()
