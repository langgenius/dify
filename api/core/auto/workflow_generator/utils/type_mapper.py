"""
Type Mapping Utility
Used to map string types to Dify types
"""

from core.auto.node_types.common import InputVarType, VarType


def map_var_type_to_input_type(var_type: str) -> InputVarType:
    """
    Map variable type to input variable type

    Args:
        var_type: Variable type string

    Returns:
        Input variable type
    """
    type_map = {
        "string": InputVarType.text_input,
        "number": InputVarType.number,
        "boolean": InputVarType.select,
        "object": InputVarType.json,
        "array": InputVarType.json,
        "file": InputVarType.file,
    }

    return type_map.get(var_type.lower(), InputVarType.text_input)


def map_string_to_var_type(type_str: str) -> VarType:
    """
    Map string to variable type

    Args:
        type_str: Type string

    Returns:
        Variable type
    """
    type_map = {
        "string": VarType.string,
        "number": VarType.number,
        "boolean": VarType.boolean,
        "object": VarType.object,
        "array": VarType.array,
        "file": VarType.file,
    }

    return type_map.get(type_str.lower(), VarType.string)
