from __future__ import annotations

import abc
from collections.abc import Mapping
from typing import Any, Protocol

from graphon.enums import NodeType


class DraftVariableSaver(Protocol):
    @abc.abstractmethod
    def save(self, process_data: Mapping[str, Any] | None, outputs: Mapping[str, Any] | None) -> None:
        """Persist node draft variables for a completed execution."""
        raise NotImplementedError


class DraftVariableSaverFactory(Protocol):
    @abc.abstractmethod
    def __call__(
        self,
        app_id: str,
        node_id: str,
        node_type: NodeType,
        node_execution_id: str,
        enclosing_node_id: str | None = None,
    ) -> DraftVariableSaver:
        """Build a saver bound to a concrete node execution."""
        raise NotImplementedError


class NoopDraftVariableSaver(DraftVariableSaver):
    def save(self, process_data: Mapping[str, Any] | None, outputs: Mapping[str, Any] | None) -> None:
        return None
