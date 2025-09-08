from collections.abc import Sequence
from typing import Annotated, TypeAlias
from uuid import uuid4

from pydantic import Discriminator, Field, Tag

from core.helper import encrypter

from .segments import (
    ArrayAnySegment,
    ArrayBooleanSegment,
    ArrayFileSegment,
    ArrayNumberSegment,
    ArrayObjectSegment,
    ArraySegment,
    ArrayStringSegment,
    BooleanSegment,
    FileSegment,
    FloatSegment,
    IntegerSegment,
    NoneSegment,
    ObjectSegment,
    Segment,
    StringSegment,
    get_segment_discriminator,
)
from .types import SegmentType


class Variable(Segment):
    """
    A variable is a segment that has a name.

    It is mainly used to store segments and their selector in VariablePool.

    Note: this class is abstract, you should use subclasses of this class instead.
    """

    id: str = Field(
        default_factory=lambda: str(uuid4()),
        description="Unique identity for variable.",
    )
    name: str
    description: str = Field(default="", description="Description of the variable.")
    selector: Sequence[str] = Field(default_factory=list)


class StringVariable(StringSegment, Variable):
    pass


class FloatVariable(FloatSegment, Variable):
    pass


class IntegerVariable(IntegerSegment, Variable):
    pass


class ObjectVariable(ObjectSegment, Variable):
    pass


class ArrayVariable(ArraySegment, Variable):
    pass


class ArrayAnyVariable(ArrayAnySegment, ArrayVariable):
    pass


class ArrayStringVariable(ArrayStringSegment, ArrayVariable):
    pass


class ArrayNumberVariable(ArrayNumberSegment, ArrayVariable):
    pass


class ArrayObjectVariable(ArrayObjectSegment, ArrayVariable):
    pass


class SecretVariable(StringVariable):
    value_type: SegmentType = SegmentType.SECRET

    @property
    def log(self) -> str:
        return encrypter.obfuscated_token(self.value)


class NoneVariable(NoneSegment, Variable):
    value_type: SegmentType = SegmentType.NONE
    value: None = None


class FileVariable(FileSegment, Variable):
    pass


class BooleanVariable(BooleanSegment, Variable):
    pass


class ArrayFileVariable(ArrayFileSegment, ArrayVariable):
    pass


class ArrayBooleanVariable(ArrayBooleanSegment, ArrayVariable):
    pass


# The `VariableUnion`` type is used to enable serialization and deserialization with Pydantic.
# Use `Variable` for type hinting when serialization is not required.
#
# Note:
# - All variants in `VariableUnion` must inherit from the `Variable` class.
# - The union must include all non-abstract subclasses of `Segment`, except:
VariableUnion: TypeAlias = Annotated[
    (
        Annotated[NoneVariable, Tag(SegmentType.NONE)]
        | Annotated[StringVariable, Tag(SegmentType.STRING)]
        | Annotated[FloatVariable, Tag(SegmentType.FLOAT)]
        | Annotated[IntegerVariable, Tag(SegmentType.INTEGER)]
        | Annotated[ObjectVariable, Tag(SegmentType.OBJECT)]
        | Annotated[FileVariable, Tag(SegmentType.FILE)]
        | Annotated[BooleanVariable, Tag(SegmentType.BOOLEAN)]
        | Annotated[ArrayAnyVariable, Tag(SegmentType.ARRAY_ANY)]
        | Annotated[ArrayStringVariable, Tag(SegmentType.ARRAY_STRING)]
        | Annotated[ArrayNumberVariable, Tag(SegmentType.ARRAY_NUMBER)]
        | Annotated[ArrayObjectVariable, Tag(SegmentType.ARRAY_OBJECT)]
        | Annotated[ArrayFileVariable, Tag(SegmentType.ARRAY_FILE)]
        | Annotated[ArrayBooleanVariable, Tag(SegmentType.ARRAY_BOOLEAN)]
        | Annotated[SecretVariable, Tag(SegmentType.SECRET)]
    ),
    Discriminator(get_segment_discriminator),
]
