import json
from collections.abc import Mapping, Sequence
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator

from core.file.file_obj import FileVar
from core.helper import encrypter


class VariableType(str, Enum):
    TEXT = 'text'
    NUMBER = 'number'
    FILE = 'file'

    SECRET = 'secret'

    OBJECT = 'object'

    ARRAY = 'array'
    ARRAY_STRING = 'array[string]'
    ARRAY_NUMBER = 'array[number]'
    ARRAY_OBJECT = 'array[object]'
    ARRAY_FILE = 'array[file]'


class Variable(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str
    value: Any
    value_type: VariableType

    @field_validator('value_type')
    def validate_value_type(cls, value):
        """
        This validator checks if the provided value is equal to the default value of the 'value_type' field.
        If the value is different, a ValueError is raised.
        """
        if value != cls.model_fields['value_type'].default:
            raise ValueError("Cannot modify 'value_type'")
        return value

    def to_markdown(self) -> str:
        return str(self.value)


class TextVariable(Variable):
    value_type: VariableType = VariableType.TEXT
    value: str


class FloatVariable(Variable):
    value_type: VariableType = VariableType.NUMBER
    value: float


class IntegerVariable(Variable):
    value_type: VariableType = VariableType.NUMBER
    value: int


class ObjectVariable(Variable):
    value_type: VariableType = VariableType.OBJECT
    value: Mapping[str, Variable]

    def to_markdown(self) -> str:
        return json.dumps(self.model_dump()['value'], ensure_ascii=False)


class ArrayVariable(Variable):
    value_type: VariableType = VariableType.ARRAY
    value: Sequence[Variable]

    def to_markdown(self) -> str:
        return ' '.join([item.to_markdown() for item in self.value])


class FileVariable(Variable):
    value_type: VariableType = VariableType.FILE
    value: FileVar

    def to_markdown(self) -> str:
        return self.value.to_markdown()


class SecretVariable(Variable):
    value_type: VariableType = VariableType.SECRET
    value: str

    def to_markdown(self) -> str:
        return encrypter.obfuscated_token(self.value)
