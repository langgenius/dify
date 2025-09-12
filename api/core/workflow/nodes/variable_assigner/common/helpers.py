from collections.abc import Mapping, MutableMapping, Sequence
from typing import Any, TypeVar

from pydantic import BaseModel

from core.variables import Segment
from core.variables.consts import SELECTORS_LENGTH
from core.variables.types import SegmentType

# Use double underscore (`__`) prefix for internal variables
# to minimize risk of collision with user-defined variable names.
_UPDATED_VARIABLES_KEY = "__updated_variables"


class UpdatedVariable(BaseModel):
    name: str
    selector: Sequence[str]
    value_type: SegmentType
    new_value: Any = None


_T = TypeVar("_T", bound=MutableMapping[str, Any])


def variable_to_processed_data(selector: Sequence[str], seg: Segment) -> UpdatedVariable:
    if len(selector) < SELECTORS_LENGTH:
        raise Exception("selector too short")
    _, var_name = selector[:2]
    return UpdatedVariable(
        name=var_name,
        selector=list(selector[:2]),
        value_type=seg.value_type,
        new_value=seg.value,
    )


def set_updated_variables(m: _T, updates: Sequence[UpdatedVariable]) -> _T:
    m[_UPDATED_VARIABLES_KEY] = updates
    return m


def get_updated_variables(m: Mapping[str, Any]) -> Sequence[UpdatedVariable] | None:
    updated_values = m.get(_UPDATED_VARIABLES_KEY, None)
    if updated_values is None:
        return None
    result = []
    for items in updated_values:
        if isinstance(items, UpdatedVariable):
            result.append(items)
        elif isinstance(items, dict):
            items = UpdatedVariable.model_validate(items)
            result.append(items)
        else:
            raise TypeError(f"Invalid updated variable: {items}, type={type(items)}")
    return result
