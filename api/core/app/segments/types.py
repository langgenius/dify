from enum import Enum


class SegmentType(str, Enum):
    NONE = 'none'
    NUMBER = 'number'
    STRING = 'string'
    SECRET = 'secret'
    ARRAY = 'array'
    OBJECT = 'object'
    FILE = 'file'
