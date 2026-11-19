from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from core.entities.execution_extra_content import ExecutionExtraContentDomainModel


@dataclass(frozen=True, slots=True)
class HumanInputFormReference:
    """A stored approval reference whose form is outside the legacy table."""

    workflow_run_id: str
    form_id: str


type StoredExecutionExtraContent = ExecutionExtraContentDomainModel | HumanInputFormReference


class ExecutionExtraContentRepository(Protocol):
    def get_by_message_ids(self, message_ids: Sequence[str]) -> list[list[StoredExecutionExtraContent]]: ...


__all__ = ["ExecutionExtraContentRepository"]
