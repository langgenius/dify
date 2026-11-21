from collections.abc import Iterable, Sequence
from typing import Any

import orjson

from .segment_group import SegmentGroup
from .segments import ArrayFileSegment, FileSegment, Segment


def to_selector(node_id: str, name: str, paths: Iterable[str] = ()) -> Sequence[str]:
    selectors = [node_id, name]
    if paths:
        selectors.extend(paths)
    return selectors


def segment_orjson_default(o: Any) -> object:
    """Default function for orjson serialization of Segment types"""
    result: object
    match o:
        case ArrayFileSegment():
            result = [v.model_dump() for v in o.value]
        case FileSegment():
            result = o.value.model_dump()
        case SegmentGroup():
            result = [segment_orjson_default(seg) for seg in o.value]
        case Segment():
            result = o.value
        case _:
            msg = f"Object of type {type(o).__name__} is not JSON serializable"
            raise TypeError(msg)
    return result


def dumps_with_segments(obj: Any) -> str:
    """JSON dumps with segment support using orjson"""
    option = orjson.OPT_NON_STR_KEYS
    return orjson.dumps(obj, default=segment_orjson_default, option=option).decode(
        "utf-8",
    )
