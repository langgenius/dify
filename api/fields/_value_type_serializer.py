from typing import TypedDict

from dify_graph.variables.segments import Segment
from dify_graph.variables.types import SegmentType


class _VarTypedDict(TypedDict, total=False):
    value_type: SegmentType


def serialize_value_type(v: _VarTypedDict | Segment) -> str:
    if isinstance(v, Segment):
        return v.value_type.exposed_type().value
    else:
        value_type = v.get("value_type")
        if value_type is None:
            raise ValueError("value_type is required but not provided")
        return value_type.exposed_type().value
