"""Form state read by execution event and pause adapters."""

from typing import Protocol

from models.human_input_contracts import HumanInputFormRecord


class HumanInputFormReader(Protocol):
    def get_by_form_id(self, form_id: str) -> HumanInputFormRecord | None: ...
