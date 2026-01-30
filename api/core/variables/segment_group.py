import json

from .segments import Segment
from .types import SegmentType
from .variables import StringVariable


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

    def escape_string_variables(self):
        for i, segment in enumerate(self.value):
            if isinstance(segment, StringVariable):
                # use json.dumps() to uniformly and safely escape strings,
                # and use [1:-1] to remove the surrounding quotes after conversion.
                new_text = json.dumps(segment.text, ensure_ascii=False)[1:-1]
                self.value[i] = StringVariable(value=new_text, name=segment.name)
