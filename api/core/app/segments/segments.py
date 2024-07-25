from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator

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
