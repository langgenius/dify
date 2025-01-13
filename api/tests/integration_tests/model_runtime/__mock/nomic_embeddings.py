import os
from collections.abc import Callable
from typing import Any, Literal

import pytest

# import monkeypatch
from _pytest.monkeypatch import MonkeyPatch
from nomic import embed  # type: ignore


def create_embedding(texts: list[str], model: str, **kwargs: Any) -> dict:
    texts_len = len(texts)

    foo_embedding_sample = 0.123456

    combined = {
        "embeddings": [[foo_embedding_sample for _ in range(768)] for _ in range(texts_len)],
        "usage": {"prompt_tokens": texts_len, "total_tokens": texts_len},
        "model": model,
        "inference_mode": "remote",
    }

    return combined


def mock_nomic(
    monkeypatch: MonkeyPatch,
    methods: list[Literal["text_embedding"]],
) -> Callable[[], None]:
    """
    mock nomic module

    :param monkeypatch: pytest monkeypatch fixture
    :return: unpatch function
    """

    def unpatch() -> None:
        monkeypatch.undo()

    if "text_embedding" in methods:
        monkeypatch.setattr(embed, "text", create_embedding)

    return unpatch


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_nomic_mock(request, monkeypatch):
    methods = request.param if hasattr(request, "param") else []
    if MOCK:
        unpatch = mock_nomic(monkeypatch, methods=methods)

    yield

    if MOCK:
        unpatch()
