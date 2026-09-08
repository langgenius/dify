"""Deterministically reconstruct provider-neutral workflow execution hierarchy."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any, Literal

from core.workflow.node_execution_process_data import (
    WORKFLOW_TOOL_INVOCATION_ID_KEY,
    WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY,
)
from graphon.entities import WorkflowNodeExecution

if TYPE_CHECKING:
    from models.workflow import WorkflowNodeExecutionModel

_WRAPPER_INDEX_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]+$")
_WRAPPER_FIELDS: tuple[tuple[Literal["iteration", "loop"], str, str], ...] = (
    ("iteration", "iteration_id", "iteration_index"),
    ("loop", "loop_id", "loop_index"),
)


WorkflowExecutionLike = WorkflowNodeExecution


def _read_attribute(value: object, name: str, default: Any = None) -> Any:
    """Read fields shared by persisted executions and legacy trace objects."""
    return getattr(value, name, default)  # guard-ignore: no-new-getattr -- supports legacy trace objects


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


def execution_id(execution: WorkflowNodeExecution | WorkflowNodeExecutionModel) -> str:
    """Return the persisted execution identifier used as a canonical span ID."""
    return str(_read_attribute(execution, "id") or execution.node_execution_id)


def execution_metadata(execution: object) -> Mapping[str, Any]:
    """Read metadata from repository models and older trace test doubles."""
    value = _read_attribute(execution, "execution_metadata_dict")
    if not isinstance(value, Mapping):
        value = _read_attribute(execution, "metadata")
    if not isinstance(value, Mapping):
        return {}
    return {str(key): item for key, item in value.items()}


def _node_key(execution: WorkflowExecutionLike, node_id: str) -> tuple[str, str, str]:
    process_data = _read_attribute(execution, "process_data") or {}
    invocation_id = process_data.get(WORKFLOW_TOOL_INVOCATION_ID_KEY)
    return (
        _read_attribute(execution, "workflow_id", ""),
        invocation_id if isinstance(invocation_id, str) else "",
        node_id,
    )


def workflow_tool_parent_ids(
    executions: Sequence[WorkflowNodeExecution | WorkflowNodeExecutionModel],
) -> dict[str, str]:
    """Resolve Tool parent references only against executions in the admitted trace."""
    execution_ids = {execution_id(item): execution_id(item) for item in executions}
    execution_ids.update(
        (node_execution_id, execution_id(item))
        for item in executions
        if isinstance(node_execution_id := _read_attribute(item, "node_execution_id"), str) and node_execution_id
    )
    parents: dict[str, str] = {}
    for item in executions:
        process_data = _read_attribute(item, "process_data")
        if not isinstance(process_data, Mapping):
            process_data = _read_attribute(item, "process_data_dict") or {}
        parent_id = process_data.get(WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY)
        if isinstance(parent_id, str) and parent_id in execution_ids:
            parents[execution_id(item)] = execution_ids[parent_id]
    _remove_cycles(parents)
    return parents


def _unique_execution_by_node_id(executions: Sequence[WorkflowExecutionLike]) -> dict[tuple[str, str, str], str]:
    result: dict[tuple[str, str, str], str] = {}
    ambiguous: set[tuple[str, str, str]] = set()
    for item in executions:
        node_id = item.node_id
        if not isinstance(node_id, str):
            continue
        key = _node_key(item, node_id)
        if key in ambiguous:
            continue
        item_execution_id = execution_id(item)
        previous = result.get(key)
        if previous is None:
            result[key] = item_execution_id
        elif previous != item_execution_id:
            result.pop(key, None)
            ambiguous.add(key)
    return result


def _metadata_or_attr(execution: object, metadata: Mapping[str, Any], key: str) -> Any:
    value = metadata.get(key)
    return value if value is not None else _read_attribute(execution, key)


def _normalize_index(value: Any) -> str | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value) if value >= 0 else None
    if isinstance(value, str) and _WRAPPER_INDEX_PATTERN.fullmatch(value):
        return value
    return None


def _finished_at(execution: WorkflowExecutionLike) -> datetime:
    explicit_end = _read_attribute(execution, "end_time")
    if isinstance(explicit_end, datetime):
        return explicit_end
    started_at = execution.created_at or _read_attribute(execution, "start_time") or datetime.now()
    return started_at + timedelta(seconds=execution.elapsed_time or 0)


def _failed(execution: WorkflowExecutionLike) -> bool:
    status = _read_attribute(execution.status, "value", execution.status)
    return status == "failed"


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


def build_workflow_hierarchy(executions: Sequence[WorkflowExecutionLike]) -> WorkflowHierarchy:
    """Build stable parents and synthetic loop/iteration wrappers.

    Ambiguous repeated graph node IDs and cyclic predecessor data are dropped
    rather than guessed. Their spans consequently fall back to the workflow root.
    """
    execution_by_node_id = _unique_execution_by_node_id(executions)
    tool_parents = workflow_tool_parent_ids(executions)
    parent_by_execution_id: dict[str, str] = {}

    for item in executions:
        item_execution_id = execution_id(item)
        predecessor_node_id = item.predecessor_node_id
        parent_execution_id = (
            execution_by_node_id.get(_node_key(item, predecessor_node_id))
            if isinstance(predecessor_node_id, str)
            else None
        )
        if parent_execution_id is None:
            metadata = execution_metadata(item)
            for structured_key in ("iteration_id", "loop_id"):
                container_node_id = _metadata_or_attr(item, metadata, structured_key)
                if isinstance(container_node_id, str):
                    parent_execution_id = execution_by_node_id.get(_node_key(item, container_node_id))
                if parent_execution_id is not None:
                    break
        parent_execution_id = parent_execution_id or tool_parents.get(item_execution_id)
        if parent_execution_id and parent_execution_id != item_execution_id:
            parent_by_execution_id[item_execution_id] = parent_execution_id

    _remove_cycles(parent_by_execution_id)

    grouped: dict[WrapperKey, list[WorkflowExecutionLike]] = {}
    for item in executions:
        metadata = execution_metadata(item)
        for kind, container_key, index_key in _WRAPPER_FIELDS:
            container_node_id = _metadata_or_attr(item, metadata, container_key)
            index = _normalize_index(_metadata_or_attr(item, metadata, index_key))
            if not isinstance(container_node_id, str) or index is None:
                continue
            container_execution_id = execution_by_node_id.get(_node_key(item, container_node_id))
            if container_execution_id is None or container_execution_id == execution_id(item):
                continue
            wrapper_key = WrapperKey(kind=kind, container_execution_id=container_execution_id, index=index)
            grouped.setdefault(wrapper_key, []).append(item)
            break

    wrappers: list[WrapperSpec] = []
    wrapper_by_child_execution_id: dict[str, WrapperSpec] = {}
    for wrapper_key in sorted(grouped, key=lambda item: (item.kind, item.container_execution_id, item.index)):
        children = grouped[wrapper_key]
        child_ids = frozenset(execution_id(item) for item in children)
        wrapper = WrapperSpec(
            id=f"{wrapper_key.kind}:{wrapper_key.container_execution_id}:{wrapper_key.index}",
            key=wrapper_key,
            parent_execution_id=wrapper_key.container_execution_id,
            child_execution_ids=child_ids,
            start_time=min(item.created_at or datetime.now() for item in children),
            end_time=max(_finished_at(item) for item in children),
            has_error=any(_failed(item) for item in children),
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
