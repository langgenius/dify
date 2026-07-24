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


def segment_orjson_default(o: Any):
    """Default function for orjson serialization of Segment types"""
    if isinstance(o, ArrayFileSegment):
        return [v.model_dump() for v in o.value]
    elif isinstance(o, FileSegment):
        return o.value.model_dump()
    elif isinstance(o, SegmentGroup):
        return [segment_orjson_default(seg) for seg in o.value]
    elif isinstance(o, Segment):
        return o.value
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")


def dumps_with_segments(obj: Any, ensure_ascii: bool = False) -> str:
    """JSON dumps with segment support using orjson"""
    option = orjson.OPT_NON_STR_KEYS
    return orjson.dumps(obj, default=segment_orjson_default, option=option).decode("utf-8")
