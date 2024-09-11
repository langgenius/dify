import json
import sys
from collections.abc import Mapping, Sequence
from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator

from .types import SegmentType


class Segment(BaseModel):
    model_config = ConfigDict(frozen=True)

    value_type: SegmentType
    value: Any

    @field_validator("value_type")
    @classmethod
    def validate_value_type(cls, value):
        """
        This validator checks if the provided value is equal to the default value of the 'value_type' field.
        If the value is different, a ValueError is raised.
        """
        if value != cls.model_fields["value_type"].default:
            raise ValueError("Cannot modify 'value_type'")
        return value

    @property
    def text(self) -> str:
        return str(self.value)

    @property
    def log(self) -> str:
        return str(self.value)

    @property
    def markdown(self) -> str:
        return str(self.value)

    @property
    def size(self) -> int:
        return sys.getsizeof(self.value)

    def to_object(self) -> Any:
        return self.value


class NoneSegment(Segment):
    value_type: SegmentType = SegmentType.NONE
    value: None = None

    @property
    def text(self) -> str:
        return "null"

    @property
    def log(self) -> str:
        return "null"

    @property
    def markdown(self) -> str:
        return "null"


class StringSegment(Segment):
    value_type: SegmentType = SegmentType.STRING
    value: str


class FloatSegment(Segment):
    value_type: SegmentType = SegmentType.NUMBER
    value: float


class IntegerSegment(Segment):
    value_type: SegmentType = SegmentType.NUMBER
    value: int


class ObjectSegment(Segment):
    value_type: SegmentType = SegmentType.OBJECT
    value: Mapping[str, Any]

    @property
    def text(self) -> str:
        return json.dumps(self.model_dump()["value"], ensure_ascii=False)

    @property
    def log(self) -> str:
        return json.dumps(self.model_dump()["value"], ensure_ascii=False, indent=2)

    @property
    def markdown(self) -> str:
        return json.dumps(self.model_dump()["value"], ensure_ascii=False, indent=2)


class ArraySegment(Segment):
    @property
    def markdown(self) -> str:
        items = []
        for item in self.value:
            if hasattr(item, "to_markdown"):
                items.append(item.to_markdown())
            else:
                items.append(str(item))
        return "\n".join(items)


class ArrayAnySegment(ArraySegment):
    value_type: SegmentType = SegmentType.ARRAY_ANY
    value: Sequence[Any]


class ArrayStringSegment(ArraySegment):
    value_type: SegmentType = SegmentType.ARRAY_STRING
    value: Sequence[str]


class ArrayNumberSegment(ArraySegment):
    value_type: SegmentType = SegmentType.ARRAY_NUMBER
    value: Sequence[float | int]


class ArrayObjectSegment(ArraySegment):
    value_type: SegmentType = SegmentType.ARRAY_OBJECT
    value: Sequence[Mapping[str, Any]]
