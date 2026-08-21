from collections.abc import Mapping, Sequence
from typing import Any

from graphon.runtime import VariablePool
from graphon.variables.factory import build_segment_with_type
from graphon.variables.input_entities import VariableEntity, VariableEntityType
from graphon.variables.types import SegmentType
from graphon.variables.variables import Variable


def add_variables_to_pool(variable_pool: VariablePool, variables: Sequence[Variable]) -> None:
    for variable in variables:
        variable_pool.add(variable.selector, variable)


def build_input_segment_types(variables: Sequence[VariableEntity]) -> dict[str, SegmentType]:
    """Build declared runtime types for input variables that need type preservation."""
    return {
        variable.variable: SegmentType.ARRAY_STRING
        for variable in variables
        if variable.type == VariableEntityType.MULTI_SELECT
    }


def add_node_inputs_to_pool(
    variable_pool: VariablePool,
    *,
    node_id: str,
    inputs: Mapping[str, Any],
    input_types: Mapping[str, SegmentType] | None = None,
    aliases: Sequence[str] = (),
) -> None:
    """Store node inputs under the primary node id and any compatible aliases."""
    values_to_add = {}
    for key, value in inputs.items():
        expected_type = input_types.get(key) if input_types else None
        if expected_type is not None and value is not None:
            value = build_segment_with_type(expected_type, value)
        values_to_add[key] = value

    node_ids: list[str] = [node_id]
    for alias in aliases:
        if alias not in node_ids:
            node_ids.append(alias)

    for current_node_id in node_ids:
        for key, value in values_to_add.items():
            variable_pool.add((current_node_id, key), value)
