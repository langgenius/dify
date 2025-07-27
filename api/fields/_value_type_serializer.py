from typing import TypedDict

from core.variables.segments import Segment
from core.variables.types import SegmentType


class _VarTypedDict(TypedDict, total=False):
    value_type: SegmentType


def serialize_value_type(v: _VarTypedDict | Segment) -> str:
    if isinstance(v, Segment):
        return v.value_type.exposed_type().value
    else:
        return v["value_type"].exposed_type().value
