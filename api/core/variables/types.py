from enum import Enum


class SegmentType(str, Enum):
    NUMBER = "number"
    STRING = "string"
    OBJECT = "object"
    SECRET = "secret"

    FILE = "file"

    ARRAY_ANY = "array[any]"
    ARRAY_STRING = "array[string]"
    ARRAY_NUMBER = "array[number]"
    ARRAY_OBJECT = "array[object]"
    ARRAY_FILE = "array[file]"

    NONE = "none"

    GROUP = "group"
