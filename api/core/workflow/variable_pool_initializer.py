from collections.abc import Mapping, Sequence
from typing import Any

from graphon.runtime import VariablePool
from graphon.variables.variables import Variable


def add_variables_to_pool(variable_pool: VariablePool, variables: Sequence[Variable]) -> None:
    for variable in variables:
        variable_pool.add(variable.selector, variable)


def add_node_inputs_to_pool(
    variable_pool: VariablePool,
    *,
    node_id: str,
    inputs: Mapping[str, Any],
    aliases: Sequence[str] = (),
) -> None:
    """Store node inputs under the primary node id and any compatible aliases."""
    node_ids: list[str] = [node_id]
    for alias in aliases:
        if alias not in node_ids:
            node_ids.append(alias)

    for current_node_id in node_ids:
        for key, value in inputs.items():
            variable_pool.add((current_node_id, key), value)
