"""The source handles a node chooses between at run time, as the graph engine emits them."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, Final

from core.workflow.nodes.human_input.constants import TIMEOUT_HANDLE
from graphon.enums import BuiltinNodeTypes, ErrorStrategy

SOURCE_HANDLE: Final = "source"
_ELSE_HANDLE: Final = "false"
_LEGACY_IF_HANDLE: Final = "true"


def _ids(items: object, key: str) -> frozenset[str]:
    if not isinstance(items, list):
        return frozenset()
    return frozenset(str(item[key]) for item in items if isinstance(item, Mapping) and item.get(key) is not None)


def _if_else(data: Mapping[str, Any]) -> frozenset[str]:
    cases = data.get("cases")
    cases_ids = _ids(cases, "case_id") if isinstance(cases, list) else frozenset({_LEGACY_IF_HANDLE})
    return cases_ids | {_ELSE_HANDLE}


def _question_classifier(data: Mapping[str, Any]) -> frozenset[str]:
    return _ids(data.get("classes"), "id")


def _human_input(data: Mapping[str, Any]) -> frozenset[str]:
    return _ids(data.get("user_actions"), "id") | {TIMEOUT_HANDLE}


_BRANCH_HANDLES: Final[Mapping[str, Callable[[Mapping[str, Any]], frozenset[str]]]] = {
    BuiltinNodeTypes.IF_ELSE: _if_else,
    BuiltinNodeTypes.QUESTION_CLASSIFIER: _question_classifier,
    BuiltinNodeTypes.HUMAN_INPUT: _human_input,
}


def branch_handles(data: Mapping[str, Any]) -> frozenset[str] | None:
    """None for a node that follows every outgoing edge.

    A fail-branch node becomes a branch node: on success it emits its own handles (``source``
    for an ordinary node), on error ``fail-branch``.
    """
    handles = _BRANCH_HANDLES.get(str(data.get("type")))
    fail_branch = data.get("error_strategy") == ErrorStrategy.FAIL_BRANCH
    if handles is None:
        return frozenset({SOURCE_HANDLE, ErrorStrategy.FAIL_BRANCH.value}) if fail_branch else None
    found = handles(data)
    return found | {ErrorStrategy.FAIL_BRANCH.value} if fail_branch else found
