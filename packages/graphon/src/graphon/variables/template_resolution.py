from __future__ import annotations

import re
from abc import abstractmethod
from collections.abc import Sequence
from typing import Protocol

from graphon.variables.factory import build_segment
from graphon.variables.segment_group import SegmentGroup
from graphon.variables.segments import Segment

VARIABLE_PATTERN = re.compile(
    r"\{\{#([a-zA-Z0-9_]{1,50}(?:\.[a-zA-Z_][a-zA-Z0-9_]{0,29}){1,10})#\}\}",
)


class _TemplateLookupPool(Protocol):
    @abstractmethod
    def get(self, selector: Sequence[str], /) -> Segment | None: ...


def convert_template(
    pool: _TemplateLookupPool,
    template: str,
    /,
) -> SegmentGroup:
    segments: list[Segment] = []
    for part in filter(None, VARIABLE_PATTERN.split(template)):
        if "." in part and (variable := pool.get(part.split("."))) is not None:
            segments.append(variable)
        else:
            segments.append(build_segment(part))
    return SegmentGroup(value=segments)
