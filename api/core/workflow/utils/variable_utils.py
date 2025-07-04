from core.variables.segments import ObjectSegment, Segment
from core.workflow.entities.variable_pool import VariablePool, VariableValue


def append_variables_recursively(
    pool: VariablePool, node_id: str, variable_key_list: list[str], variable_value: VariableValue | Segment
):
    """
    Append variables recursively
    :param pool: variable pool to append variables to
    :param node_id: node id
    :param variable_key_list: variable key list
    :param variable_value: variable value
    :return:
    """
    pool.add([node_id] + variable_key_list, variable_value)

    # if variable_value is a dict, then recursively append variables
    if isinstance(variable_value, ObjectSegment):
        variable_dict = variable_value.value
    elif isinstance(variable_value, dict):
        variable_dict = variable_value
    else:
        return

    for key, value in variable_dict.items():
        # construct new key list
        new_key_list = variable_key_list + [key]
        append_variables_recursively(pool, node_id=node_id, variable_key_list=new_key_list, variable_value=value)
