from enum import StrEnum
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.nodes.base.entities import VariableSelector
from graphon.variables.types import SegmentType


class CodeLanguage(StrEnum):
    PYTHON3 = "python3"
    JINJA2 = "jinja2"
    JAVASCRIPT = "javascript"


_ALLOWED_OUTPUT_FROM_CODE = frozenset([
    SegmentType.STRING,
    SegmentType.NUMBER,
    SegmentType.OBJECT,
    SegmentType.BOOLEAN,
    SegmentType.ARRAY_STRING,
    SegmentType.ARRAY_NUMBER,
    SegmentType.ARRAY_OBJECT,
    SegmentType.ARRAY_BOOLEAN,
])


def _validate_type(segment_type: SegmentType) -> SegmentType:
    if segment_type not in _ALLOWED_OUTPUT_FROM_CODE:
        msg = (
            f"invalid type for code output, expected {_ALLOWED_OUTPUT_FROM_CODE}, "
            f"actual {segment_type}"
        )
        raise ValueError(msg)
    return segment_type


class CodeNodeData(BaseNodeData):
    """Code Node Data."""

    type: NodeType = BuiltinNodeTypes.CODE

    class Output(BaseModel):
        """Schema for a single code-node output."""

        type: Annotated[SegmentType, AfterValidator(_validate_type)]
        children: dict[str, "CodeNodeData.Output"] | None = None

    class Dependency(BaseModel):
        """Dependency required by a code node."""

        name: str
        version: str

    variables: list[VariableSelector]
    code_language: Literal[CodeLanguage.PYTHON3, CodeLanguage.JAVASCRIPT]
    code: str
    outputs: dict[str, Output]
    dependencies: list[Dependency] | None = None
