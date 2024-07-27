import json
from collections.abc import Mapping, Sequence
from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator

from core.file.file_obj import FileVar

from .types import SegmentType


class Segment(BaseModel):
    model_config = ConfigDict(frozen=True)

    value_type: SegmentType
    value: Any

    @field_validator('value_type')
    def validate_value_type(cls, value):
        """
        This validator checks if the provided value is equal to the default value of the 'value_type' field.
        If the value is different, a ValueError is raised.
        """
        if value != cls.model_fields['value_type'].default:
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

    def to_object(self) -> Any:
        return self.value


class NoneSegment(Segment):
    value_type: SegmentType = SegmentType.NONE
    value: None = None

    @property
    def text(self) -> str:
        return 'null'

    @property
    def log(self) -> str:
        return 'null'

    @property
    def markdown(self) -> str:
        return 'null'


class StringSegment(Segment):
    value_type: SegmentType = SegmentType.STRING
    value: str


class FloatSegment(Segment):
    value_type: SegmentType = SegmentType.NUMBER
    value: float


class IntegerSegment(Segment):
    value_type: SegmentType = SegmentType.NUMBER
    value: int


class FileSegment(Segment):
    value_type: SegmentType = SegmentType.FILE
    # TODO: embed FileVar in this model.
    value: FileVar

    @property
    def markdown(self) -> str:
        return self.value.to_markdown()


class ObjectSegment(Segment):
    value_type: SegmentType = SegmentType.OBJECT
    value: Mapping[str, Segment]

    @property
    def text(self) -> str:
        # TODO: Process variables.
        return json.dumps(self.model_dump()['value'], ensure_ascii=False)

    @property
    def log(self) -> str:
        # TODO: Process variables.
        return json.dumps(self.model_dump()['value'], ensure_ascii=False, indent=2)

    @property
    def markdown(self) -> str:
        # TODO: Use markdown code block
        return json.dumps(self.model_dump()['value'], ensure_ascii=False, indent=2)

    def to_object(self):
        return {k: v.to_object() for k, v in self.value.items()}


class ArraySegment(Segment):
    @property
    def markdown(self) -> str:
        return '\n'.join(['- ' + item.markdown for item in self.value])

    def to_object(self):
        return [v.to_object() for v in self.value]


class ArrayAnySegment(ArraySegment):
    value_type: SegmentType = SegmentType.ARRAY_ANY
    value: Sequence[Segment]


class ArrayStringSegment(ArraySegment):
    value_type: SegmentType = SegmentType.ARRAY_STRING
    value: Sequence[StringSegment]


class ArrayNumberSegment(ArraySegment):
    value_type: SegmentType = SegmentType.ARRAY_NUMBER
    value: Sequence[FloatSegment | IntegerSegment]


class ArrayObjectSegment(ArraySegment):
    value_type: SegmentType = SegmentType.ARRAY_OBJECT
    value: Sequence[ObjectSegment]


class ArrayFileSegment(ArraySegment):
    value_type: SegmentType = SegmentType.ARRAY_FILE
    value: Sequence[FileSegment]
