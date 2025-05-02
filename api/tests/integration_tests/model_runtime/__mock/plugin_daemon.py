import os
from collections.abc import Callable

import pytest

# import monkeypatch
from _pytest.monkeypatch import MonkeyPatch

from core.plugin.manager.model import PluginModelManager
from tests.integration_tests.model_runtime.__mock.plugin_model import MockModelClass


def mock_plugin_daemon(
    monkeypatch: MonkeyPatch,
) -> Callable[[], None]:
    """
    mock openai module

    :param monkeypatch: pytest monkeypatch fixture
    :return: unpatch function
    """

    def unpatch() -> None:
        monkeypatch.undo()

    monkeypatch.setattr(PluginModelManager, "invoke_llm", MockModelClass.invoke_llm)
    monkeypatch.setattr(PluginModelManager, "fetch_model_providers", MockModelClass.fetch_model_providers)
    monkeypatch.setattr(PluginModelManager, "get_model_schema", MockModelClass.get_model_schema)

    return unpatch


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_model_mock(monkeypatch):
    if MOCK:
        unpatch = mock_plugin_daemon(monkeypatch)

    yield

    if MOCK:
        unpatch()
