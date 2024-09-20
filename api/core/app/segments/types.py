from enum import Enum


class SegmentType(str, Enum):
    NONE = "none"
    NUMBER = "number"
    STRING = "string"
    SECRET = "secret"
    ARRAY_ANY = "array[any]"
    ARRAY_STRING = "array[string]"
    ARRAY_NUMBER = "array[number]"
    ARRAY_OBJECT = "array[object]"
    OBJECT = "object"

    GROUP = "group"
