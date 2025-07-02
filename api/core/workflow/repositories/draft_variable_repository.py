import abc
from collections.abc import Mapping
from typing import Any, Protocol

from sqlalchemy.orm import Session

from core.workflow.nodes.enums import NodeType


class DraftVariableSaver(Protocol):
    @abc.abstractmethod
    def save(self, process_data: Mapping[str, Any] | None, outputs: Mapping[str, Any] | None):
        pass


class DraftVariableSaverFactory(Protocol):
    @abc.abstractmethod
    def __call__(
        self,
        session: Session,
        app_id: str,
        node_id: str,
        node_type: NodeType,
        node_execution_id: str,
        enclosing_node_id: str | None = None,
    ) -> "DraftVariableSaver":
        pass


class NoopDraftVariableSaver(DraftVariableSaver):
    def save(self, process_data: Mapping[str, Any] | None, outputs: Mapping[str, Any] | None):
        pass
