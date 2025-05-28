from collections.abc import Sequence
from typing import Any, TypedDict

from core.variables import Segment, SegmentType
from core.variables.consts import MIN_SELECTORS_LENGTH


class VariableOutput(TypedDict):
    name: str
    selector: Sequence[str]
    new_value: Any
    type: SegmentType


def variable_to_output_mapping(selector: Sequence[str], seg: Segment) -> VariableOutput:
    if len(selector) < MIN_SELECTORS_LENGTH:
        raise Exception("selector too short")
    node_id, var_name = selector[:2]
    return {
        "name": var_name,
        "selector": selector[:2],
        "new_value": seg.value,
        "type": seg.value_type,
    }
