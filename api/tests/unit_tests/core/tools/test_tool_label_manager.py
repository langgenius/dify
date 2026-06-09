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


def test_tool_label_manager_update_tool_labels_db():
    """
    Test the database update logic for tool labels.
    Focus: Verify that labels are filtered, de-duplicated, and safely handled within a database session.
    """
    # 1. Setup expected data from the controller
    controller = _api_controller("api-1")
    expected_id = controller.provider_id
    expected_type = controller.provider_type

    # 2. Patching External Dependencies
    # - We patch 'db' to prevent Flask from trying to access a real database.
    # - We patch 'sessionmaker' to intercept and control the creation of SQLAlchemy sessions.
    with (
        patch("core.tools.tool_label_manager.db"),
        patch("core.tools.tool_label_manager.sessionmaker") as mock_sessionmaker,
    ):
        # 3. Constructing the "Mocking Chain"
        # In the business logic, we use: with sessionmaker(db.engine).begin() as _session:
        # We need to link our 'mock_session' to the end of this complex context manager chain:
        # Step A: sessionmaker(db.engine) -> returns an object (mock_sessionmaker.return_value)
        # Step B: .begin() -> returns a context manager (begin.return_value)
        # Step C: with ... as _session: -> calls __enter__(), and _session gets the __enter__.return_value
        mock_session = MagicMock()
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_session

        # 4. Trigger the logic under test
        # Input: ["search", "search", "invalid"]
        # Logic:
        #   - "invalid" should be filtered out (not in default_tool_label_name_list).
        #   - The duplicate "search" should be merged (unique labels).
        ToolLabelManager.update_tool_labels(controller, ["search", "search", "invalid"])

        # 5. Behavior Assertion: DELETE operation
        # Verify that the manager first attempts to clear existing labels for this specific tool.
        # This ensures the update is idempotent.
        mock_session.execute.assert_called_once()

        # 6. Behavior Assertion: INSERT operation
        # Verify that only ONE valid label ("search") was added after filtering and deduplication.
        # If call_count == 1, it proves filter_tool_labels() worked as expected.
        assert mock_session.add.call_count == 1

        # 7. State Assertion: Data Integrity & Isolation
        # Inspect the actual object passed to session.add() to ensure it has correct properties.
        # This confirms that the data isolation (tool_id + tool_type) we refactored is active.
        call_args = mock_session.add.call_args
        added_label = call_args[0][0]  # Retrieve the ToolLabelBinding instance

        assert added_label.label_name == "search", "The label name should be 'search' after filtering."
        assert added_label.tool_id == expected_id, "The tool_id must match the provider_id for correct binding."
        assert added_label.tool_type == expected_type, "Isolation failed: tool_type must be verified during update."


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
    with (
        patch("core.tools.tool_label_manager.db"),
        patch("core.tools.tool_label_manager.sessionmaker") as mock_sessionmaker,
    ):
        mock_session = MagicMock()
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_session

        # Inject mock data into the query result: session.scalars(stmt).all()
        mock_session.scalars.return_value.all.return_value = ["search", "news"]

        labels = ToolLabelManager.get_tool_labels(api)
        assert labels == ["search", "news"]


def test_tool_label_manager_get_tool_labels_unsupported():
    """
    Negative Test: Ensure get_tool_labels raises ValueError for unsupported controller types.
    This protects the internal API contract against accidental regressions during refactoring.
    """
    # Passing a generic object() which doesn't match Api, Workflow, or Builtin controllers.
    with pytest.raises(ValueError, match="Unsupported tool type"):
        ToolLabelManager.get_tool_labels(object())  # type: ignore[arg-type]


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

    with (
        patch("core.tools.tool_label_manager.db"),
        patch("core.tools.tool_label_manager.sessionmaker") as mock_sessionmaker,
    ):
        mock_session = MagicMock()
        mock_sessionmaker.return_value.begin.return_value.__enter__.return_value = mock_session

        # Simulating the batch query result
        mock_session.scalars.return_value.all.return_value = records

        labels = ToolLabelManager.get_tools_labels([api, wf])

    # Verify the final dictionary mapping
    assert labels == {"api-1": ["search", "news"], "wf-1": ["utilities"]}


def test_tool_label_manager_get_tools_labels_unsupported():
    """
    Negative Test: Ensure get_tools_labels raises ValueError if the list contains
    unsupported controller types, even alongside valid ones.
    """
    api = _api_controller("api-1")

    # Passing a list with one valid controller and one invalid object()
    with pytest.raises(ValueError, match="Unsupported tool type"):
        ToolLabelManager.get_tools_labels([api, object()])  # type: ignore[list-item]
