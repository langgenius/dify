from collections.abc import Mapping, MutableMapping, Sequence
from typing import Any

from pydantic import BaseModel

from graphon.nodes.variable_assigner.common.exc import VariableOperatorNodeError
from graphon.variables.consts import SELECTORS_LENGTH
from graphon.variables.segments import Segment
from graphon.variables.types import SegmentType

# Use double underscore (`__`) prefix for internal variables
# to minimize risk of collision with user-defined variable names.
_UPDATED_VARIABLES_KEY = "__updated_variables"


class UpdatedVariable(BaseModel):
    name: str
    selector: Sequence[str]
    value_type: SegmentType
    new_value: Any = None


def variable_to_processed_data(
    selector: Sequence[str],
    seg: Segment,
) -> UpdatedVariable:
    if len(selector) < SELECTORS_LENGTH:
        msg = "selector too short"
        raise VariableOperatorNodeError(msg)
    _, var_name = selector[:2]
    return UpdatedVariable(
        name=var_name,
        selector=list(selector[:2]),
        value_type=seg.value_type,
        new_value=seg.value,
    )


def set_updated_variables[T: MutableMapping[str, Any]](
    m: T,
    updates: Sequence[UpdatedVariable],
) -> T:
    m[_UPDATED_VARIABLES_KEY] = updates
    return m


def get_updated_variables(m: Mapping[str, Any]) -> Sequence[UpdatedVariable] | None:
    updated_values = m.get(_UPDATED_VARIABLES_KEY, None)
    if updated_values is None:
        return None
    result = []
    for item in updated_values:
        if isinstance(item, UpdatedVariable):
            result.append(item)
        elif isinstance(item, dict):
            validated_item = UpdatedVariable.model_validate(item)
            result.append(validated_item)
        else:
            msg = f"Invalid updated variable: {item}, type={type(item)}"
            raise TypeError(msg)
    return result
