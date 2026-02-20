from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import PropertyMock, patch

import pytest

from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.custom_tool.provider import ApiToolProviderController
from core.tools.tool_label_manager import ToolLabelManager
from core.tools.workflow_as_tool.provider import WorkflowToolProviderController


class _ConcreteBuiltinToolProviderController(BuiltinToolProviderController):
    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]):
        return None


def _api_controller(provider_id: str = "api-1") -> ApiToolProviderController:
    controller = object.__new__(ApiToolProviderController)
    controller.provider_id = provider_id
    return controller


def _workflow_controller(provider_id: str = "wf-1") -> WorkflowToolProviderController:
    controller = object.__new__(WorkflowToolProviderController)
    controller.provider_id = provider_id
    return controller


def test_tool_label_manager_filter_tool_labels():
    filtered = ToolLabelManager.filter_tool_labels(["search", "search", "invalid", "news"])
    assert set(filtered) == {"search", "news"}
    assert len(filtered) == 2


def test_tool_label_manager_update_tool_labels_db():
    controller = _api_controller("api-1")
    with patch("core.tools.tool_label_manager.db") as mock_db:
        delete_query = mock_db.session.query.return_value.where.return_value
        delete_query.delete.return_value = None
        ToolLabelManager.update_tool_labels(controller, ["search", "search", "invalid"])

        delete_query.delete.assert_called_once()
        # only one valid unique label should be inserted.
        assert mock_db.session.add.call_count == 1
        mock_db.session.commit.assert_called_once()


def test_tool_label_manager_update_tool_labels_unsupported():
    with pytest.raises(ValueError, match="Unsupported tool type"):
        ToolLabelManager.update_tool_labels(object(), ["search"])  # type: ignore[arg-type]


def test_tool_label_manager_get_tool_labels_for_builtin_and_db():
    with patch.object(
        _ConcreteBuiltinToolProviderController,
        "tool_labels",
        new_callable=PropertyMock,
        return_value=["search", "news"],
    ):
        builtin = object.__new__(_ConcreteBuiltinToolProviderController)
        assert ToolLabelManager.get_tool_labels(builtin) == ["search", "news"]

    api = _api_controller("api-1")
    with patch("core.tools.tool_label_manager.db") as mock_db:
        mock_db.session.scalars.return_value.all.return_value = ["search", "news"]
        labels = ToolLabelManager.get_tool_labels(api)
    assert labels == ["search", "news"]

    with pytest.raises(ValueError, match="Unsupported tool type"):
        ToolLabelManager.get_tool_labels(object())  # type: ignore[arg-type]


def test_tool_label_manager_get_tools_labels_batch():
    assert ToolLabelManager.get_tools_labels([]) == {}

    api = _api_controller("api-1")
    wf = _workflow_controller("wf-1")
    records = [
        SimpleNamespace(tool_id="api-1", label_name="search"),
        SimpleNamespace(tool_id="api-1", label_name="news"),
        SimpleNamespace(tool_id="wf-1", label_name="utilities"),
    ]
    with patch("core.tools.tool_label_manager.db") as mock_db:
        mock_db.session.scalars.return_value.all.return_value = records
        labels = ToolLabelManager.get_tools_labels([api, wf])
    assert labels == {"api-1": ["search", "news"], "wf-1": ["utilities"]}

    with pytest.raises(ValueError, match="Unsupported tool type"):
        ToolLabelManager.get_tools_labels([api, object()])  # type: ignore[list-item]
