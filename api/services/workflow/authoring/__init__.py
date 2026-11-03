"""Fill and check for app packages an agent builds."""

from dataclasses import dataclass

# Imported for its registration: a node's plugin kind is looked up by data model, so every kind must be loaded.
from services.workflow.authoring import tool_reference as tool_reference
from services.workflow.authoring.fill import fill_package


@dataclass(frozen=True)
class FillContext:
    tenant_id: str
    account_id: str


__all__ = ["FillContext", "fill_package"]
