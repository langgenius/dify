from pydantic import BaseModel

from .segments import Segment


class SegmentGroup(BaseModel):
    segments: list[Segment]

    @property
    def text(self):
        return ''.join([segment.text for segment in self.segments])

    @property
    def log(self):
        return ''.join([segment.log for segment in self.segments])

    @property
    def markdown(self):
        return ''.join([segment.markdown for segment in self.segments])