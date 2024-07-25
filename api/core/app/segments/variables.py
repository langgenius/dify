import json
from collections.abc import Mapping, Sequence

from pydantic import Field

from core.file.file_obj import FileVar
from core.helper import encrypter

from .segments import NoneSegment, Segment, StringSegment
from .types import SegmentType


class Variable(Segment):
    """
    A variable is a segment that has a name.
    """

    id: str = Field(
        default='',
        description="Unique identity for variable. It's only used by environment variables now.",
    )
    name: str
    description: str = Field(default='', description='Description of the variable.')


class StringVariable(StringSegment, Variable):
    pass


class FloatVariable(Variable):
    value_type: SegmentType = SegmentType.NUMBER
    value: float


class IntegerVariable(Variable):
    value_type: SegmentType = SegmentType.NUMBER
    value: int


class ObjectVariable(Variable):
    value_type: SegmentType = SegmentType.OBJECT
    value: Mapping[str, Variable]

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


class ArrayVariable(Variable):
    value_type: SegmentType = SegmentType.ARRAY
    value: Sequence[Variable]

    @property
    def markdown(self) -> str:
        return '\n'.join(['- ' + item.markdown for item in self.value])


class FileVariable(Variable):
    value_type: SegmentType = SegmentType.FILE
    # TODO: embed FileVar in this model.
    value: FileVar

    @property
    def markdown(self) -> str:
        return self.value.to_markdown()


class SecretVariable(StringVariable):
    value_type: SegmentType = SegmentType.SECRET

    @property
    def log(self) -> str:
        return encrypter.obfuscated_token(self.value)


class NoneVariable(NoneSegment, Variable):
    value_type: SegmentType = SegmentType.NONE
    value: None = None
