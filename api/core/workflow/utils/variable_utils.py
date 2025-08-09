from core.variables.segments import Segment
from core.workflow.entities import VariablePool, VariableValue


def append_variables_recursively(
    pool: VariablePool, node_id: str, variable_key_list: list[str], variable_value: VariableValue | Segment
):
    """
    Append variables to the pool.

    Note: Due to variable pool constraints, only adds the top-level variable with a 2-element selector.
    Nested values are stored as part of the top-level value and can be accessed via the get() method.

    :param pool: variable pool to append variables to
    :param node_id: node id
    :param variable_key_list: variable key list (should be a single element list for the variable name)
    :param variable_value: variable value
    :return:
    """
    # Only add the top-level variable (2-element selector: node_id + variable_name)
    if len(variable_key_list) == 1:
        pool.add([node_id, variable_key_list[0]], variable_value)
    else:
        # For compatibility, join multiple keys into a single key
        combined_key = ".".join(variable_key_list)
        pool.add([node_id, combined_key], variable_value)
