from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from sqlalchemy.orm import Session

from core.entities.execution_extra_content import ExecutionExtraContentDomainModel


class ExecutionExtraContentRepository(Protocol):
    def get_by_message_ids(self, message_ids: Sequence[str]) -> list[list[ExecutionExtraContentDomainModel]]: ...
    def delete_by_workflow_run_ids(self, session: Session, workflow_run_ids: Sequence[str]) -> int: ...
    def count_by_workflow_run_ids(self, session: Session, workflow_run_ids: Sequence[str]) -> int: ...


__all__ = ["ExecutionExtraContentRepository"]
