from enum import StrEnum


class SegmentType(StrEnum):
    NONE = "none"
    NUMBER = "number"
    STRING = "string"
    SECRET = "secret"
    ARRAY_ANY = "array[any]"
    ARRAY_STRING = "array[string]"
    ARRAY_NUMBER = "array[number]"
    ARRAY_OBJECT = "array[object]"
    OBJECT = "object"
    FILE = "file"
    ARRAY_FILE = "array[file]"

    GROUP = "group"
