from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.tools import ToolLabelBinding
from services.tools.api.provider import ApiToolProviderController
from services.tools.tool_label_manager import ToolLabelManager


# Factory function to create a "lightweight" controller for testing
def _api_controller(provider_id: str = "api-1") -> ApiToolProviderController:
    controller = object.__new__(ApiToolProviderController)
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
def test_tool_label_manager_update_tool_labels_unsupported(sqlite_session: Session):
    with pytest.raises(ValueError, match="Unsupported tool type"):
        ToolLabelManager.update_tool_labels(object(), ["search"], session=sqlite_session)  # type: ignore[arg-type]
