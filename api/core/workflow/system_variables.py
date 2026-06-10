from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Any, Protocol
from uuid import uuid4

from graphon.enums import BuiltinNodeTypes
from graphon.variables import build_segment, segment_to_variable
from graphon.variables.segments import Segment
from graphon.variables.variables import RAGPipelineVariableInput, Variable

from .variable_prefixes import (
    CONVERSATION_VARIABLE_NODE_ID,
    ENVIRONMENT_VARIABLE_NODE_ID,
    RAG_PIPELINE_VARIABLE_NODE_ID,
    SYSTEM_VARIABLE_NODE_ID,
)


class SystemVariableKey(StrEnum):
    QUERY = "query"
    FILES = "files"
    CONVERSATION_ID = "conversation_id"
    USER_ID = "user_id"
    DIALOGUE_COUNT = "dialogue_count"
    APP_ID = "app_id"
    WORKFLOW_ID = "workflow_id"
    WORKFLOW_EXECUTION_ID = "workflow_run_id"
    TIMESTAMP = "timestamp"
    DOCUMENT_ID = "document_id"
    ORIGINAL_DOCUMENT_ID = "original_document_id"
    BATCH = "batch"
    DATASET_ID = "dataset_id"
    DATASOURCE_TYPE = "datasource_type"
    DATASOURCE_INFO = "datasource_info"
    INVOKE_FROM = "invoke_from"


class _VariablePoolReader(Protocol):
    def get(self, selector: Sequence[str], /) -> Segment | None: ...

    def get_by_prefix(self, prefix: str, /) -> Mapping[str, object]: ...


class _VariablePoolWriter(_VariablePoolReader, Protocol):
    def add(self, selector: Sequence[str], value: object, /) -> None: ...


class _VariableLoader(Protocol):
    def load_variables(self, selectors: list[list[str]]) -> Sequence[object]: ...


def system_variable_name(key: str | SystemVariableKey) -> str:
    return key.value if isinstance(key, SystemVariableKey) else key


def system_variable_selector(key: str | SystemVariableKey) -> tuple[str, str]:
    return SYSTEM_VARIABLE_NODE_ID, system_variable_name(key)


def _normalize_system_variable_values(values: Mapping[str, Any] | None = None, /, **kwargs: Any) -> dict[str, Any]:
    raw_values = dict(values or {})
    raw_values.update(kwargs)

    workflow_execution_id = raw_values.pop("workflow_execution_id", None)
    if workflow_execution_id is not None and SystemVariableKey.WORKFLOW_EXECUTION_ID.value not in raw_values:
        raw_values[SystemVariableKey.WORKFLOW_EXECUTION_ID.value] = workflow_execution_id

    normalized: dict[str, Any] = {}
    for key, value in raw_values.items():
        if value is None:
            continue
        normalized[system_variable_name(key)] = value

    normalized.setdefault(SystemVariableKey.FILES.value, [])
    return normalized


def build_system_variables(values: Mapping[str, Any] | None = None, /, **kwargs: Any) -> list[Variable]:
    normalized = _normalize_system_variable_values(values, **kwargs)

    return [
        segment_to_variable(
            segment=build_segment(value),
            selector=system_variable_selector(key),
            name=key,
        )
        for key, value in normalized.items()
    ]


def default_system_variables() -> list[Variable]:
    return build_system_variables(workflow_run_id=str(uuid4()))


def system_variables_to_mapping(system_variables: Sequence[Variable]) -> dict[str, Any]:
    return {variable.name: variable.value for variable in system_variables}


def _with_selector(variable: Variable, node_id: str) -> Variable:
    selector = [node_id, variable.name]
    if list(variable.selector) == selector:
        return variable
    return variable.model_copy(update={"selector": selector})


def build_bootstrap_variables(
    *,
    system_variables: Sequence[Variable] = (),
    environment_variables: Sequence[Variable] = (),
    conversation_variables: Sequence[Variable] = (),
    rag_pipeline_variables: Sequence[RAGPipelineVariableInput] = (),
) -> list[Variable]:
    variables = [
        *(_with_selector(variable, SYSTEM_VARIABLE_NODE_ID) for variable in system_variables),
        *(_with_selector(variable, ENVIRONMENT_VARIABLE_NODE_ID) for variable in environment_variables),
        *(_with_selector(variable, CONVERSATION_VARIABLE_NODE_ID) for variable in conversation_variables),
    ]

    rag_pipeline_variables_map: defaultdict[str, dict[str, Any]] = defaultdict(dict)
    for rag_var in rag_pipeline_variables:
        node_id = rag_var.variable.belong_to_node_id
        key = rag_var.variable.variable
        rag_pipeline_variables_map[node_id][key] = rag_var.value

    for node_id, value in rag_pipeline_variables_map.items():
        variables.append(
            segment_to_variable(
                segment=build_segment(value),
                selector=(RAG_PIPELINE_VARIABLE_NODE_ID, node_id),
                name=node_id,
            )
        )

    return variables


def get_system_segment(variable_pool: _VariablePoolReader, key: str | SystemVariableKey) -> Segment | None:
    return variable_pool.get(system_variable_selector(key))


def get_system_value(variable_pool: _VariablePoolReader, key: str | SystemVariableKey) -> Any:
    segment = get_system_segment(variable_pool, key)
    return None if segment is None else segment.value


def get_system_text(variable_pool: _VariablePoolReader, key: str | SystemVariableKey) -> str | None:
    segment = get_system_segment(variable_pool, key)
    if segment is None:
        return None
    text = getattr(segment, "text", None)
    return text if isinstance(text, str) else None


def get_all_system_variables(variable_pool: _VariablePoolReader) -> Mapping[str, object]:
    return variable_pool.get_by_prefix(SYSTEM_VARIABLE_NODE_ID)


_MEMORY_BOOTSTRAP_NODE_TYPES = frozenset(
    (
        BuiltinNodeTypes.LLM,
        BuiltinNodeTypes.QUESTION_CLASSIFIER,
        BuiltinNodeTypes.PARAMETER_EXTRACTOR,
    )
)


def get_node_creation_preload_selectors(
    *,
    node_type: str,
    node_data: object,
) -> tuple[tuple[str, str], ...]:
    """Return selectors that must exist before node construction begins."""

    if node_type not in _MEMORY_BOOTSTRAP_NODE_TYPES or getattr(node_data, "memory", None) is None:
        return ()

    return (system_variable_selector(SystemVariableKey.CONVERSATION_ID),)


def preload_node_creation_variables(
    *,
    variable_loader: _VariableLoader,
    variable_pool: _VariablePoolWriter,
    selectors: Sequence[Sequence[str]],
) -> None:
    """Load constructor-time variables before node or graph creation."""

    seen_selectors: set[tuple[str, ...]] = set()
    selectors_to_load: list[list[str]] = []
    for selector in selectors:
        normalized_selector = tuple(selector)
        if len(normalized_selector) < 2:
            raise ValueError(f"Invalid preload selector: {selector}")
        if normalized_selector in seen_selectors:
            continue
        seen_selectors.add(normalized_selector)
        if variable_pool.get(normalized_selector) is None:
            selectors_to_load.append(list(normalized_selector))

    loaded_variables = variable_loader.load_variables(selectors_to_load)
    for variable in loaded_variables:
        raw_selector = getattr(variable, "selector", ())
        loaded_selector = list(raw_selector)
        if len(loaded_selector) < 2:
            raise ValueError(f"Invalid loaded variable selector: {raw_selector}")
        variable_pool.add(loaded_selector[:2], variable)


def inject_default_system_variable_mappings(
    *,
    node_id: str,
    node_type: str,
    node_data: object,
    variable_mapping: Mapping[str, Sequence[str]],
) -> Mapping[str, Sequence[str]]:
    """Add workflow-owned implicit sys mappings that `graphon` should not know about."""

    if node_type != BuiltinNodeTypes.LLM or getattr(node_data, "memory", None) is None:
        return variable_mapping

    query_mapping_key = f"{node_id}.#sys.query#"
    if query_mapping_key in variable_mapping:
        return variable_mapping

    augmented_mapping = dict(variable_mapping)
    augmented_mapping[query_mapping_key] = system_variable_selector(SystemVariableKey.QUERY)
    return augmented_mapping
