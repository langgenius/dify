from collections.abc import Sequence

from pydantic import BaseModel


class VariableSelector(BaseModel):
    """
    Variable Selector.
    """

    variable: str
    value_selector: Sequence[str]
