import json
from collections.abc import Mapping, Sequence
from typing import Any

from pydantic import BaseModel

from core.file.file_obj import FileVar
from core.helper import encrypter


class Variable(BaseModel):
    value_type: str = 'unknown'
    name: str
    value: Any


class TextVariable(Variable):
    value_type: str = 'text'
    value: str

    def __str__(self) -> str:
        return self.value


class FloatVariable(Variable):
    value_type: str = 'number'
    value: float

    def __str__(self) -> str:
        return str(self.value)


class IntegerVariable(Variable):
    value_type: str = 'number'
    value: int

    def __str__(self) -> str:
        return str(self.value)


class ObjectVariable(Variable):
    value_type: str = 'object'
    value: Mapping[str, Variable]

    def __str__(self) -> str:
        return json.dumps(self.model_dump()['value'], ensure_ascii=False)


class ArrayStringVariable(Variable):
    value_type: str = 'array'
    value: Sequence[Variable]


class FileVariable(Variable):
    value_type: str = 'file'
    value: FileVar

    def __str__(self) -> str:
        return self.value.to_markdown()


class SecretVariable(Variable):
    value_type: str = 'secret'
    value: str

    def __str__(self) -> str:
        return encrypter.obfuscated_token(self.value)
