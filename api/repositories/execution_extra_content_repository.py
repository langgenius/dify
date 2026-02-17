from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from core.entities.execution_extra_content import ExecutionExtraContentDomainModel


class ExecutionExtraContentRepository(Protocol):
    def get_by_message_ids(self, message_ids: Sequence[str]) -> list[list[ExecutionExtraContentDomainModel]]: ...


__all__ = ["ExecutionExtraContentRepository"]
