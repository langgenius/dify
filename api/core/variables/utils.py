import json
from collections.abc import Iterable, Sequence

from .segment_group import SegmentGroup
from .segments import ArrayFileSegment, FileSegment, Segment


def to_selector(node_id: str, name: str, paths: Iterable[str] = ()) -> Sequence[str]:
    selectors = [node_id, name]
    if paths:
        selectors.extend(paths)
    return selectors


class SegmentJSONEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, ArrayFileSegment):
            return [v.model_dump() for v in o.value]
        elif isinstance(o, FileSegment):
            return o.value.model_dump()
        elif isinstance(o, SegmentGroup):
            return [self.default(seg) for seg in o.value]
        elif isinstance(o, Segment):
            return o.value
        else:
            super().default(o)
