from enum import Enum


class SegmentType(str, Enum):
    STRING = 'string'
    NUMBER = 'number'
    FILE = 'file'

    SECRET = 'secret'

    OBJECT = 'object'

    ARRAY = 'array'
    ARRAY_STRING = 'array[string]'
    ARRAY_NUMBER = 'array[number]'
    ARRAY_OBJECT = 'array[object]'
    ARRAY_FILE = 'array[file]'