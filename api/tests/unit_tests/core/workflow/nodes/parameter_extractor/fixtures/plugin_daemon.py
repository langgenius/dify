from collections.abc import Callable, Generator

import pytest

from core.plugin.impl.model import PluginModelClient
from tests.unit_tests.core.workflow.nodes.parameter_extractor.fixtures.plugin_model import MockModelClass


def mock_plugin_daemon(
    monkeypatch: pytest.MonkeyPatch,
) -> Callable[[], None]:
    """
    mock openai module

    :param monkeypatch: pytest monkeypatch fixture
    :return: unpatch function
    """

    def unpatch() -> None:
        monkeypatch.undo()

    monkeypatch.setattr(PluginModelClient, "invoke_llm", MockModelClass.invoke_llm)
    monkeypatch.setattr(PluginModelClient, "fetch_model_providers", MockModelClass.fetch_model_providers)
    monkeypatch.setattr(PluginModelClient, "get_model_schema", MockModelClass.get_model_schema)

    return unpatch


@pytest.fixture
def setup_model_mock(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    unpatch = mock_plugin_daemon(monkeypatch)
    yield
    unpatch()
