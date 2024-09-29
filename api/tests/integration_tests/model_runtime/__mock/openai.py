import os
from collections.abc import Callable
from typing import Literal

import pytest

# import monkeypatch
from _pytest.monkeypatch import MonkeyPatch
from openai.resources.moderations import Moderations

from tests.integration_tests.model_runtime.__mock.openai_moderation import MockModerationClass


def mock_openai(
    monkeypatch: MonkeyPatch,
    methods: list[Literal["completion", "chat", "remote", "moderation", "speech2text", "text_embedding"]],
) -> Callable[[], None]:
    """
    mock openai module

    :param monkeypatch: pytest monkeypatch fixture
    :return: unpatch function
    """

    def unpatch() -> None:
        monkeypatch.undo()

    if "moderation" in methods:
        monkeypatch.setattr(Moderations, "create", MockModerationClass.moderation_create)

    return unpatch


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_openai_mock(request, monkeypatch):
    methods = request.param if hasattr(request, "param") else []
    if MOCK:
        unpatch = mock_openai(monkeypatch, methods=methods)

    yield

    if MOCK:
        unpatch()
