from pydantic import BaseModel

class Segment(BaseModel):
    pass

class ArrayFileSegment(Segment):
    pass

class ArrayNumberSegment(Segment):
    pass

class ArrayStringSegment(Segment):
    pass

class NoneSegment(Segment):
    pass

class FileSegment(Segment):
    pass

class ArrayObjectSegment(Segment):
    pass

class ArrayBooleanSegment(Segment):
    pass

class BooleanSegment(Segment):
    pass

class ObjectSegment(Segment):
    pass

class ArrayAnySegment(Segment):
    pass

class StringSegment(Segment):
    pass

class SegmentGroup(Segment):
    pass
