from __future__ import annotations

from unittest.mock import MagicMock

from core.workflow.enums import NodeType
from core.workflow.repositories.draft_variable_repository import (
    DraftVariableSaver,
    DraftVariableSaverFactory,
    NoopDraftVariableSaver,
)


def test_noop_draft_variable_saver_save_is_noop() -> None:
    saver = NoopDraftVariableSaver()

    assert saver.save(process_data={"a": 1}, outputs={"b": 2}) is None


def test_protocol_abstract_methods_are_callable_for_runtime_compatibility() -> None:
    dummy = object()

    assert DraftVariableSaver.save(dummy, process_data=None, outputs=None) is None
    assert (
        DraftVariableSaverFactory.__call__(
            dummy,
            session=MagicMock(),
            app_id="app",
            node_id="node",
            node_type=NodeType.CODE,
            node_execution_id="exec",
            enclosing_node_id=None,
        )
        is None
    )
