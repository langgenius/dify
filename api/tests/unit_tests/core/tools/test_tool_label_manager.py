from __future__ import annotations

from typing import Any, override
from unittest.mock import PropertyMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import core.tools.tool_label_manager as tool_label_manager_module
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.custom_tool.provider import ApiToolProviderController
from core.tools.tool_label_manager import ToolLabelManager
from core.tools.workflow_as_tool.provider import WorkflowToolProviderController
from models.tools import ToolLabelBinding


class _DatabaseBinding:
    """Expose the SQLite engine to code that owns its session lifecycle."""

    engine: Engine

    def __init__(self, engine: Engine) -> None:
        self.engine = engine


# Create a mock class for testing abstract/base classes
class _ConcreteBuiltinToolProviderController(BuiltinToolProviderController):
    @override
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


@pytest.mark.parametrize("sqlite_session", [(ToolLabelBinding,)], indirect=True)
def test_tool_label_manager_update_tool_labels_db(sqlite_session: Session):
    """
    Test the database update logic for tool labels.
    Focus: Verify that labels are filtered, de-duplicated, and safely handled within a database session.
    """
    # 1. Setup expected data from the controller
    controller = _api_controller("api-1")
    expected_id = controller.provider_id
    expected_type = controller.provider_type

    sqlite_session.add(ToolLabelBinding(tool_id=expected_id, tool_type=expected_type, label_name="news"))
    sqlite_session.commit()

    # Duplicate and unknown labels are filtered before the existing binding is replaced.
    ToolLabelManager.update_tool_labels(controller, ["search", "search", "invalid"], session=sqlite_session)
    sqlite_session.commit()

    bindings = list(sqlite_session.scalars(select(ToolLabelBinding)).all())
    assert len(bindings) == 1
    assert bindings[0].label_name == "search"
    assert bindings[0].tool_id == expected_id
    assert bindings[0].tool_type == expected_type


# Test error handling
def test_tool_label_manager_update_tool_labels_unsupported():
    with pytest.raises(ValueError, match="Unsupported tool type"):
        ToolLabelManager.update_tool_labels(object(), ["search"])  # type: ignore[arg-type]


# Test retrieval logic
@pytest.mark.parametrize("sqlite_session", [(ToolLabelBinding,)], indirect=True)
def test_tool_label_manager_get_tool_labels_for_builtin_and_db(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session: Session
):
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
    sqlite_session.add_all(
        [
            ToolLabelBinding(tool_id=api.provider_id, tool_type=api.provider_type, label_name="search"),
            ToolLabelBinding(tool_id=api.provider_id, tool_type=api.provider_type, label_name="news"),
        ]
    )
    sqlite_session.commit()
    monkeypatch.setattr(tool_label_manager_module, "db", _DatabaseBinding(sqlite_engine))

    labels = ToolLabelManager.get_tool_labels(api)
    assert set(labels) == {"search", "news"}


def test_tool_label_manager_get_tool_labels_unsupported():
    """
    Negative Test: Ensure get_tool_labels raises ValueError for unsupported controller types.
    This protects the internal API contract against accidental regressions during refactoring.
    """
    # Passing a generic object() which doesn't match Api, Workflow, or Builtin controllers.
    with pytest.raises(ValueError, match="Unsupported tool type"):
        ToolLabelManager.get_tool_labels(object())  # type: ignore[arg-type]


# Test batch processing and mapping
@pytest.mark.parametrize("sqlite_session", [(ToolLabelBinding,)], indirect=True)
def test_tool_label_manager_get_tools_labels_batch(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session: Session
):
    assert ToolLabelManager.get_tools_labels([]) == {}

    api = _api_controller("api-1")
    wf = _workflow_controller("wf-1")

    sqlite_session.add_all(
        [
            ToolLabelBinding(tool_id=api.provider_id, tool_type=api.provider_type, label_name="search"),
            ToolLabelBinding(tool_id=api.provider_id, tool_type=api.provider_type, label_name="news"),
            ToolLabelBinding(tool_id=wf.provider_id, tool_type=wf.provider_type, label_name="utilities"),
        ]
    )
    sqlite_session.commit()
    monkeypatch.setattr(tool_label_manager_module, "db", _DatabaseBinding(sqlite_engine))

    labels = ToolLabelManager.get_tools_labels([api, wf])

    assert labels.keys() == {"api-1", "wf-1"}
    assert set(labels["api-1"]) == {"search", "news"}
    assert labels["wf-1"] == ["utilities"]


def test_tool_label_manager_get_tools_labels_unsupported():
    """
    Negative Test: Ensure get_tools_labels raises ValueError if the list contains
    unsupported controller types, even alongside valid ones.
    """
    api = _api_controller("api-1")

    # Passing a list with one valid controller and one invalid object()
    with pytest.raises(ValueError, match="Unsupported tool type"):
        ToolLabelManager.get_tools_labels([api, object()])  # type: ignore[list-item]
