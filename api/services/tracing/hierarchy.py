"""Deterministically reconstruct the span hierarchy of one workflow run.

Parents come from graph predecessors and from iteration/loop containers;
each iteration or loop round gets a synthetic wrapper. Ambiguous repeated node
IDs and cyclic predecessor data are dropped rather than guessed, so those spans
fall back to the workflow root.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal

from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowNodeExecutionStatus

_WRAPPER_INDEX_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]+$")
_WRAPPER_FIELDS: tuple[tuple[Literal["iteration", "loop"], str, str], ...] = (
    ("iteration", "iteration_id", "iteration_index"),
    ("loop", "loop_id", "loop_index"),
)


@dataclass(frozen=True)
class WrapperKey:
    kind: Literal["iteration", "loop"]
    container_execution_id: str
    index: str


@dataclass(frozen=True)
class WrapperSpec:
    id: str
    key: WrapperKey
    parent_execution_id: str
    child_execution_ids: frozenset[str]
    start_time: datetime
    end_time: datetime
    has_error: bool


@dataclass(frozen=True)
class WorkflowHierarchy:
    parent_by_execution_id: Mapping[str, str]
    wrapper_by_child_execution_id: Mapping[str, WrapperSpec]
    wrappers: tuple[WrapperSpec, ...]


def execution_metadata(execution: WorkflowNodeExecution) -> dict[str, Any]:
    return {str(key): value for key, value in (execution.metadata or {}).items()}


def finished_at(execution: WorkflowNodeExecution) -> datetime:
    return execution.finished_at or execution.created_at + timedelta(seconds=execution.elapsed_time or 0)


def _unique_execution_by_node_id(executions: Sequence[WorkflowNodeExecution]) -> dict[str, str]:
    result: dict[str, str] = {}
    ambiguous: set[str] = set()
    for item in executions:
        if item.node_id in ambiguous:
            continue
        previous = result.get(item.node_id)
        if previous is None:
            result[item.node_id] = item.id
        elif previous != item.id:
            result.pop(item.node_id, None)
            ambiguous.add(item.node_id)
    return result


def _normalize_index(value: Any) -> str | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value) if value >= 0 else None
    if isinstance(value, str) and _WRAPPER_INDEX_PATTERN.fullmatch(value):
        return value
    return None


def _remove_cycles(parent_by_execution_id: dict[str, str]) -> None:
    cyclic: set[str] = set()
    for start in sorted(parent_by_execution_id):
        path: list[str] = []
        position: dict[str, int] = {}
        current = start
        while current in parent_by_execution_id:
            if current in position:
                cyclic.update(path[position[current] :])
                break
            position[current] = len(path)
            path.append(current)
            current = parent_by_execution_id[current]
    for execution in cyclic:
        parent_by_execution_id.pop(execution, None)


def build_workflow_hierarchy(executions: Sequence[WorkflowNodeExecution]) -> WorkflowHierarchy:
    execution_by_node_id = _unique_execution_by_node_id(executions)
    parent_by_execution_id: dict[str, str] = {}

    for item in executions:
        parent_execution_id = (
            execution_by_node_id.get(item.predecessor_node_id) if item.predecessor_node_id is not None else None
        )
        if parent_execution_id is None:
            metadata = execution_metadata(item)
            for structured_key in ("iteration_id", "loop_id"):
                container_node_id = metadata.get(structured_key)
                if isinstance(container_node_id, str):
                    parent_execution_id = execution_by_node_id.get(container_node_id)
                if parent_execution_id is not None:
                    break
        if parent_execution_id and parent_execution_id != item.id:
            parent_by_execution_id[item.id] = parent_execution_id

    _remove_cycles(parent_by_execution_id)

    grouped: dict[WrapperKey, list[WorkflowNodeExecution]] = {}
    for item in executions:
        metadata = execution_metadata(item)
        for kind, container_key, index_key in _WRAPPER_FIELDS:
            container_node_id = metadata.get(container_key)
            index = _normalize_index(metadata.get(index_key))
            if not isinstance(container_node_id, str) or index is None:
                continue
            container_execution_id = execution_by_node_id.get(container_node_id)
            if container_execution_id is None or container_execution_id == item.id:
                continue
            wrapper_key = WrapperKey(kind=kind, container_execution_id=container_execution_id, index=index)
            grouped.setdefault(wrapper_key, []).append(item)
            break

    wrappers: list[WrapperSpec] = []
    wrapper_by_child_execution_id: dict[str, WrapperSpec] = {}
    for wrapper_key in sorted(grouped, key=lambda key: (key.kind, key.container_execution_id, key.index)):
        children = grouped[wrapper_key]
        child_ids = frozenset(item.id for item in children)
        wrapper = WrapperSpec(
            id=f"{wrapper_key.kind}:{wrapper_key.container_execution_id}:{wrapper_key.index}",
            key=wrapper_key,
            parent_execution_id=wrapper_key.container_execution_id,
            child_execution_ids=child_ids,
            start_time=min(item.created_at for item in children),
            end_time=max(finished_at(item) for item in children),
            has_error=any(item.status == WorkflowNodeExecutionStatus.FAILED for item in children),
        )
        wrappers.append(wrapper)
        for child_id in child_ids:
            wrapper_by_child_execution_id[child_id] = wrapper
            parent_by_execution_id[child_id] = wrapper.id

    return WorkflowHierarchy(
        parent_by_execution_id=parent_by_execution_id,
        wrapper_by_child_execution_id=wrapper_by_child_execution_id,
        wrappers=tuple(wrappers),
    )
