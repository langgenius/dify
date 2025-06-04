from collections.abc import Mapping, MutableMapping, Sequence
from typing import Any, TypeVar

from pydantic import BaseModel

from core.variables import Segment
from core.variables.consts import MIN_SELECTORS_LENGTH

# Use double underscore (`__`) prefix for internal variables
# to minimize risk of collision with user-defined variable names.
_UPDATED_VARIABLES_KEY = "__updated_variables"


class UpdatedVariable(BaseModel):
    name: str
    selector: Sequence[str]
    new_value: Segment


_T = TypeVar("_T", bound=MutableMapping[str, Any])


def variable_to_processed_data(selector: Sequence[str], seg: Segment) -> UpdatedVariable:
    if len(selector) < MIN_SELECTORS_LENGTH:
        raise Exception("selector too short")
    node_id, var_name = selector[:2]
    return UpdatedVariable(name=var_name, selector=list(selector[:2]), new_value=seg)


def set_updated_variables(m: _T, updates: Sequence[UpdatedVariable]) -> _T:
    m[_UPDATED_VARIABLES_KEY] = updates
    return m


def get_updated_variables(m: Mapping[str, Any]) -> Sequence[UpdatedVariable] | None:
    return m.get(_UPDATED_VARIABLES_KEY, None)
