from typing import List, Union

from typing_extensions import Literal

__all__ = ["FunctionToolBlock"]

from .....core import BaseModel


class FunctionToolOutput(BaseModel):
    content: str


class FunctionTool(BaseModel):
    name: str
    arguments: Union[str,dict]
    outputs: List[FunctionToolOutput]


class FunctionToolBlock(BaseModel):
    function: FunctionTool

    type: Literal["function"]
    """Always `drawing_tool`."""