from collections.abc import Mapping, Sequence
from typing import Any

from graphon.runtime import VariablePool
from graphon.variables.variables import Variable


def add_variables_to_pool(variable_pool: VariablePool, variables: Sequence[Variable]) -> None:
    for variable in variables:
        variable_pool.add(variable.selector, variable)


def add_node_inputs_to_pool(variable_pool: VariablePool, *, node_id: str, inputs: Mapping[str, Any]) -> None:
    for key, value in inputs.items():
        variable_pool.add((node_id, key), value)
