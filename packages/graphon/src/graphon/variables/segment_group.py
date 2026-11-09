from .segments import Segment
from .types import SegmentType


class SegmentGroup(Segment):
    value_type: SegmentType = SegmentType.GROUP
    value: list[Segment]

    @property
    def text(self) -> str:
        return "".join([segment.text for segment in self.value])

    @property
    def log(self) -> str:
        return "".join([segment.log for segment in self.value])

    @property
    def markdown(self) -> str:
        return "".join([segment.markdown for segment in self.value])

    def to_object(self) -> list[object]:
        return [segment.to_object() for segment in self.value]
