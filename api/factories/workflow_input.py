"""Map debug inputs to graph variables using the shared tenant-aware file builders."""

from collections.abc import Callable, Mapping, Sequence
from typing import Any

from sqlalchemy.orm import Session

from core.app.file_access import FileAccessControllerProtocol
from core.workflow.variable_prefixes import ENVIRONMENT_VARIABLE_NODE_ID
from factories import file_factory
from graphon.runtime import VariablePool


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
    for node_variable, variable_selector in variable_mapping.items():
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
        variable_key_list = variable_selector[1:]
        variable_key_list = list(variable_key_list)

        # get input value
        input_value = user_inputs.get(node_variable)
        if not input_value:
            input_value = user_inputs.get(node_variable_key)
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
            # In single run, the input_value is set as the LLM's structured output value within the variable_pool.
            if len(variable_key_list) == 2 and variable_key_list[0] == "structured_output":
                input_value = {variable_key_list[1]: input_value}
                variable_key_list = variable_key_list[0:1]

                # Support for a single node to reference multiple structured_output variables
                current_variable = variable_pool.get([variable_node_id] + variable_key_list)
                if current_variable and isinstance(current_variable.value, dict):
                    input_value = current_variable.value | input_value

            variable_pool.add([variable_node_id] + variable_key_list, input_value)
