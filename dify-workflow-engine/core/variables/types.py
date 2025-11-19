from pydantic import BaseModel
from typing import ClassVar

class SegmentType(BaseModel):
    STRING: ClassVar[str] = "string"
    NUMBER: ClassVar[str] = "number"
    OBJECT: ClassVar[str] = "object"
    ARRAY_STRING: ClassVar[str] = "array[string]"
    ARRAY_NUMBER: ClassVar[str] = "array[number]"
    ARRAY_OBJECT: ClassVar[str] = "array[object]"
    BOOLEAN: ClassVar[str] = "boolean"
    ARRAY_BOOLEAN: ClassVar[str] = "array[boolean]"
    SECRET: ClassVar[str] = "secret"
    FILE: ClassVar[str] = "file"
    ARRAY_FILE: ClassVar[str] = "array[file]"
    GROUP: ClassVar[str] = "group"

class ArrayValidation(BaseModel):
    pass
