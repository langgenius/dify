from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, PropertyMock, patch

import pytest

from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.custom_tool.provider import ApiToolProviderController
from core.tools.tool_label_manager import ToolLabelManager
from core.tools.workflow_as_tool.provider import WorkflowToolProviderController

# Create a mock class for testing abstract/base classes
class _ConcreteBuiltinToolProviderController(BuiltinToolProviderController):
    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]):
        return None

# Factory function to create a "lightweight" controller for testing
def _api_controller(provider_id: str = "api-1") -> ApiToolProviderController:
    controller = object.__new__(ApiToolProviderController)
    controller.provider_id = provider_id
    return controller


def _workflow_controller(provider_id: str = "wf-1") -> WorkflowToolProviderController:
    controller = object.__new__(WorkflowToolProviderController)
    controller.provider_id = provider_id
    return controller

# Test pure logic: filtering and deduplication
def test_tool_label_manager_filter_tool_labels():
    filtered = ToolLabelManager.filter_tool_labels(["search", "search", "invalid", "news"])
    assert set(filtered) == {"search", "news"}
    assert len(filtered) == 2

# Test database update logic with Session Mocking
def test_tool_label_manager_update_tool_labels_db():
    controller = _api_controller("api-1")

    # Patch 'db' to avoid Flask context issues, and 'sessionmaker' to intercept DB calls
    with patch("core.tools.tool_label_manager.db"), \
         patch("core.tools.tool_label_manager.sessionmaker") as mock_sessionmaker:

        # Mocking the chain: sessionmaker(engine).begin().__enter__ -> session
        mock_session = MagicMock()
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_session
        
        ToolLabelManager.update_tool_labels(controller, ["search", "search", "invalid"])

        # Verify if the execute method (DELETE SQL) was called
        mock_session.execute.assert_called_once()

# Test error handling
def test_tool_label_manager_update_tool_labels_unsupported():
    with pytest.raises(ValueError, match="Unsupported tool type"):
        ToolLabelManager.update_tool_labels(object(), ["search"])  # type: ignore[arg-type]

# Test retrieval logic
def test_tool_label_manager_get_tool_labels_for_builtin_and_db():
    # Mocking a property (@property) using PropertyMock
    with patch.object(
        _ConcreteBuiltinToolProviderController,
        "tool_labels",
        new_callable=PropertyMock,
        return_value=["search", "news"],
    ):
        builtin = object.__new__(_ConcreteBuiltinToolProviderController)
        assert ToolLabelManager.get_tool_labels(builtin) == ["search", "news"]

    api = _api_controller("api-1")
    with patch("core.tools.tool_label_manager.db"), \
         patch("core.tools.tool_label_manager.sessionmaker") as mock_sessionmaker:
        
        mock_session = MagicMock()
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_session
        
        # Inject mock data into the query result: session.scalars(stmt).all()
        mock_session.scalars.return_value.all.return_value = ["search", "news"]
        
        labels = ToolLabelManager.get_tool_labels(api)
        assert labels == ["search", "news"]

# Test batch processing and mapping
def test_tool_label_manager_get_tools_labels_batch():
    assert ToolLabelManager.get_tools_labels([]) == {}

    api = _api_controller("api-1")
    wf = _workflow_controller("wf-1")

    # SimpleNamespace is a quick way to simulate SQLAlchemy row objects
    records = [
        SimpleNamespace(tool_id="api-1", label_name="search"),
        SimpleNamespace(tool_id="api-1", label_name="news"),
        SimpleNamespace(tool_id="wf-1", label_name="utilities"),
    ]

    with patch("core.tools.tool_label_manager.db"), \
         patch("core.tools.tool_label_manager.sessionmaker") as mock_sessionmaker:
        
        mock_session = MagicMock()
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_session
        
        # Simulating the batch query result
        mock_session.scalars.return_value.all.return_value = records
        
        labels = ToolLabelManager.get_tools_labels([api, wf])

    # Verify the final dictionary mapping    
    assert labels == {"api-1": ["search", "news"], "wf-1": ["utilities"]}
