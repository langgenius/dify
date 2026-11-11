"""Map debug inputs to graph variables using the shared tenant-aware file builders."""

from collections.abc import Callable, Mapping, Sequence
from typing import Any

from sqlalchemy.orm import Session

from core.app.file_access import FileAccessControllerProtocol
from core.workflow.variable_prefixes import ENVIRONMENT_VARIABLE_NODE_ID
from factories import file_factory
from graphon.runtime import VariablePool
from services.workflow_node_variables import add_node_input_to_variable_pool


def map_user_inputs_to_variable_pool(
    *,
    variable_mapping: Mapping[str, Sequence[str]],
    user_inputs: Mapping[str, Any],
    variable_pool: VariablePool,
    tenant_id: str,
    access_controller: FileAccessControllerProtocol,
    sessions: Callable[[], Session] | None = None,
) -> None:
    # NOTE(QuantumGhost): This logic should remain synchronized with
    # the implementation of `load_into_variable_pool`, specifically the logic about
    # variable existence checking.

    # WARNING(QuantumGhost): The semantics of this method are not clearly defined,
    # and multiple parts of the codebase depend on its current behavior.
    # Modify with caution.
    # Apply whole objects before nested overrides, independent of editor field order.
    for node_variable, variable_selector in sorted(variable_mapping.items(), key=lambda item: len(item[1])):
        # fetch node id and variable key from node_variable
        node_variable_list = node_variable.split(".")
        if len(node_variable_list) < 1:
            raise ValueError(f"Invalid node variable {node_variable}")

        node_variable_key = ".".join(node_variable_list[1:])

        if (node_variable_key not in user_inputs and node_variable not in user_inputs) and not variable_pool.get(
            variable_selector
        ):
            raise ValueError(f"Variable key {node_variable} not found in user inputs.")

        # environment variable already exist in variable pool, not from user inputs
        if variable_pool.get(variable_selector) and variable_selector[0] == ENVIRONMENT_VARIABLE_NODE_ID:
            continue

        # fetch variable node id from variable selector
        variable_node_id = variable_selector[0]
        # get input value
        input_value = user_inputs[node_variable] if node_variable in user_inputs else user_inputs.get(node_variable_key)
        if input_value is None:
            continue

        if isinstance(input_value, dict) and "type" in input_value and "transfer_method" in input_value:
            input_value = file_factory.build_from_mapping(
                mapping=input_value,
                tenant_id=tenant_id,
                access_controller=access_controller,
                sessions=sessions,
            )
        if (
            isinstance(input_value, list)
            and all(isinstance(item, dict) for item in input_value)
            and all("type" in item and "transfer_method" in item for item in input_value)
        ):
            input_value = file_factory.build_from_mappings(
                mappings=input_value,
                tenant_id=tenant_id,
                access_controller=access_controller,
                sessions=sessions,
            )

        # append variable and value to variable pool
        if variable_node_id != ENVIRONMENT_VARIABLE_NODE_ID:
            add_node_input_to_variable_pool(variable_pool, variable_selector, input_value)
