import json
import sys
from collections.abc import Mapping, Sequence
from typing import Annotated, Any, TypeAlias

from pydantic import BaseModel, ConfigDict, Discriminator, Tag, field_validator

from core.file import File

from .types import SegmentType


class Segment(BaseModel):
    """Segment is runtime type used during the execution of workflow.

    Note: this class is abstract, you should use subclasses of this class instead.
    """

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
        """
        Return the size of the value in bytes.
        """
        return sys.getsizeof(self.value)

    def to_object(self):
        return self.value


class NoneSegment(Segment):
    value_type: SegmentType = SegmentType.NONE
    value: None = None

    @property
    def text(self) -> str:
        return ""

    @property
    def log(self) -> str:
        return ""

    @property
    def markdown(self) -> str:
        return ""


class StringSegment(Segment):
    value_type: SegmentType = SegmentType.STRING
    value: str


class FloatSegment(Segment):
    value_type: SegmentType = SegmentType.FLOAT
    value: float
    # NOTE(QuantumGhost): seems that the equality for FloatSegment with `NaN` value has some problems.
    # The following tests cannot pass.
    #
    #     def test_float_segment_and_nan():
    #         nan = float("nan")
    #         assert nan != nan
    #
    #         f1 = FloatSegment(value=float("nan"))
    #         f2 = FloatSegment(value=float("nan"))
    #         assert f1 != f2
    #
    #         f3 = FloatSegment(value=nan)
    #         f4 = FloatSegment(value=nan)
    #         assert f3 != f4


class IntegerSegment(Segment):
    value_type: SegmentType = SegmentType.INTEGER
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
    def text(self) -> str:
        # Return empty string for empty arrays instead of "[]"
        if not self.value:
            return ""
        return super().text

    @property
    def markdown(self) -> str:
        items = []
        for item in self.value:
            items.append(f"- {item}")
        return "\n".join(items)


class FileSegment(Segment):
    value_type: SegmentType = SegmentType.FILE
    value: File

    @property
    def markdown(self) -> str:
        return self.value.markdown

    @property
    def log(self) -> str:
        return ""

    @property
    def text(self) -> str:
        return ""


class BooleanSegment(Segment):
    value_type: SegmentType = SegmentType.BOOLEAN
    value: bool


class ArrayAnySegment(ArraySegment):
    value_type: SegmentType = SegmentType.ARRAY_ANY
    value: Sequence[Any]


class ArrayStringSegment(ArraySegment):
    value_type: SegmentType = SegmentType.ARRAY_STRING
    value: Sequence[str]

    @property
    def text(self) -> str:
        # Return empty string for empty arrays instead of "[]"
        if not self.value:
            return ""
        return json.dumps(self.value, ensure_ascii=False)


class ArrayNumberSegment(ArraySegment):
    value_type: SegmentType = SegmentType.ARRAY_NUMBER
    value: Sequence[float | int]


class ArrayObjectSegment(ArraySegment):
    value_type: SegmentType = SegmentType.ARRAY_OBJECT
    value: Sequence[Mapping[str, Any]]


class ArrayFileSegment(ArraySegment):
    value_type: SegmentType = SegmentType.ARRAY_FILE
    value: Sequence[File]

    @property
    def markdown(self) -> str:
        items = []
        for item in self.value:
            items.append(item.markdown)
        return "\n".join(items)

    @property
    def log(self) -> str:
        return ""

    @property
    def text(self) -> str:
        return ""


class ArrayBooleanSegment(ArraySegment):
    value_type: SegmentType = SegmentType.ARRAY_BOOLEAN
    value: Sequence[bool]


def get_segment_discriminator(v: Any) -> SegmentType | None:
    if isinstance(v, Segment):
        return v.value_type
    elif isinstance(v, dict):
        value_type = v.get("value_type")
        if value_type is None:
            return None
        try:
            seg_type = SegmentType(value_type)
        except ValueError:
            return None
        return seg_type
    else:
        # return None if the discriminator value isn't found
        return None


# The `SegmentUnion`` type is used to enable serialization and deserialization with Pydantic.
# Use `Segment` for type hinting when serialization is not required.
#
# Note:
# - All variants in `SegmentUnion` must inherit from the `Segment` class.
# - The union must include all non-abstract subclasses of `Segment`, except:
#   - `SegmentGroup`, which is not added to the variable pool.
#   - `VariableBase` and its subclasses, which are handled by `Variable`.
SegmentUnion: TypeAlias = Annotated[
    (
        Annotated[NoneSegment, Tag(SegmentType.NONE)]
        | Annotated[StringSegment, Tag(SegmentType.STRING)]
        | Annotated[FloatSegment, Tag(SegmentType.FLOAT)]
        | Annotated[IntegerSegment, Tag(SegmentType.INTEGER)]
        | Annotated[ObjectSegment, Tag(SegmentType.OBJECT)]
        | Annotated[FileSegment, Tag(SegmentType.FILE)]
        | Annotated[BooleanSegment, Tag(SegmentType.BOOLEAN)]
        | Annotated[ArrayAnySegment, Tag(SegmentType.ARRAY_ANY)]
        | Annotated[ArrayStringSegment, Tag(SegmentType.ARRAY_STRING)]
        | Annotated[ArrayNumberSegment, Tag(SegmentType.ARRAY_NUMBER)]
        | Annotated[ArrayObjectSegment, Tag(SegmentType.ARRAY_OBJECT)]
        | Annotated[ArrayFileSegment, Tag(SegmentType.ARRAY_FILE)]
        | Annotated[ArrayBooleanSegment, Tag(SegmentType.ARRAY_BOOLEAN)]
    ),
    Discriminator(get_segment_discriminator),
]
