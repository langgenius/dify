from .segments import Segment
from .types import SegmentType


class SegmentGroup(Segment):
    value_type: SegmentType = SegmentType.GROUP
    value: list[Segment]

    @property
    def text(self):
        return "".join([segment.text for segment in self.value])

    @property
    def log(self):
        return "".join([segment.log for segment in self.value])

    @property
    def markdown(self):
        return "".join([segment.markdown for segment in self.value])

    def to_object(self):
        return [segment.to_object() for segment in self.value]
    
    def get_single_value(self):
        """
        Get the single value from the segment group.
        If the group contains only one segment, return its value.
        If the group contains multiple segments, return the text representation of the group.
        """
        if len(self.value) == 1:
            return self.value[0].value
        return self.text
