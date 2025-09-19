from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel

from core.helper.code_executor.code_executor import CodeLanguage
from core.variables.types import SegmentType
from core.workflow.nodes.base import BaseNodeData
from core.workflow.nodes.base.entities import VariableSelector

_ALLOWED_OUTPUT_FROM_CODE = frozenset(
    [
        SegmentType.STRING,
        SegmentType.NUMBER,
        SegmentType.OBJECT,
        SegmentType.BOOLEAN,
        SegmentType.ARRAY_STRING,
        SegmentType.ARRAY_NUMBER,
        SegmentType.ARRAY_OBJECT,
        SegmentType.ARRAY_BOOLEAN,
    ]
)


def _validate_type(segment_type: SegmentType) -> SegmentType:
    if segment_type not in _ALLOWED_OUTPUT_FROM_CODE:
        raise ValueError(f"invalid type for code output, expected {_ALLOWED_OUTPUT_FROM_CODE}, actual {segment_type}")
    return segment_type


class CodeNodeData(BaseNodeData):
    """
    Code Node Data.
    """

    class Output(BaseModel):
        type: Annotated[SegmentType, AfterValidator(_validate_type)]
        children: dict[str, Self] | None = None

    class Dependency(BaseModel):
        name: str
        version: str

    variables: list[VariableSelector]
    code_language: Literal[CodeLanguage.PYTHON3, CodeLanguage.JAVASCRIPT]
    code: str
    outputs: dict[str, Output]
    dependencies: list[Dependency] | None = None
