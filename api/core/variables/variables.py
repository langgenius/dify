from collections.abc import Sequence
from typing import Annotated, Any, TypeAlias
from uuid import uuid4

from pydantic import BaseModel, Discriminator, Field, Tag

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


class VariableBase(Segment):
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


class StringVariable(StringSegment, VariableBase):
    pass


class FloatVariable(FloatSegment, VariableBase):
    pass


class IntegerVariable(IntegerSegment, VariableBase):
    pass


class ObjectVariable(ObjectSegment, VariableBase):
    pass


class ArrayVariable(ArraySegment, VariableBase):
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


class NoneVariable(NoneSegment, VariableBase):
    value_type: SegmentType = SegmentType.NONE
    value: None = None


class FileVariable(FileSegment, VariableBase):
    pass


class BooleanVariable(BooleanSegment, VariableBase):
    pass


class ArrayFileVariable(ArrayFileSegment, ArrayVariable):
    pass


class ArrayBooleanVariable(ArrayBooleanSegment, ArrayVariable):
    pass


class RAGPipelineVariable(BaseModel):
    belong_to_node_id: str = Field(description="belong to which node id, shared means public")
    type: str = Field(description="variable type, text-input, paragraph, select, number,  file, file-list")
    label: str = Field(description="label")
    description: str | None = Field(description="description", default="")
    variable: str = Field(description="variable key", default="")
    max_length: int | None = Field(
        description="max length, applicable to text-input, paragraph, and file-list", default=0
    )
    default_value: Any = Field(description="default value", default="")
    placeholder: str | None = Field(description="placeholder", default="")
    unit: str | None = Field(description="unit, applicable to Number", default="")
    tooltips: str | None = Field(description="helpful text", default="")
    allowed_file_types: list[str] | None = Field(
        description="image, document, audio, video, custom.", default_factory=list
    )
    allowed_file_extensions: list[str] | None = Field(description="e.g. ['.jpg', '.mp3']", default_factory=list)
    allowed_file_upload_methods: list[str] | None = Field(
        description="remote_url, local_file, tool_file.", default_factory=list
    )
    required: bool = Field(description="optional, default false", default=False)
    options: list[str] | None = Field(default_factory=list)


class RAGPipelineVariableInput(BaseModel):
    variable: RAGPipelineVariable
    value: Any


# The `Variable` type is used to enable serialization and deserialization with Pydantic.
# Use `VariableBase` for type hinting when serialization is not required.
#
# Note:
# - All variants in `Variable` must inherit from the `VariableBase` class.
# - The union must include all non-abstract subclasses of `VariableBase`.
Variable: TypeAlias = Annotated[
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
