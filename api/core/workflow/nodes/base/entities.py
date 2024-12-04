import json
from abc import ABC
from enum import StrEnum
from typing import Any, Optional, Union

from pydantic import BaseModel, model_validator

from core.workflow.nodes.base.exc import DefaultValueTypeError
from core.workflow.nodes.enums import ErrorStrategy


class DefaultValueType(StrEnum):
    STRING = "String"
    NUMBER = "Number"
    OBJECT = "Object"
    ARRAY_NUMBER = "Array[Number]"
    ARRAY_STRING = "Array[String]"
    ARRAY_OBJECT = "Array[Object]"
    ARRAY_FILES = "Array[Files]"


NumberType = Union[int, float]
ObjectType = dict[str, Any]


class DefaultValue(BaseModel):
    value: Union[
        str,
        NumberType,
        ObjectType,
        list[NumberType],
        list[str],
        list[ObjectType],
    ]
    type: DefaultValueType
    key: str

    @model_validator(mode="after")
    def validate_value_type(self) -> Any:
        value_type = self.type
        value = self.value
        if value_type is None:
            raise DefaultValueTypeError("type field is required")

        # validate string type
        if value_type == DefaultValueType.STRING:
            if not isinstance(value, str):
                raise DefaultValueTypeError(f"Value must be string type for {value}")

        # validate number type
        elif value_type == DefaultValueType.NUMBER:
            if not isinstance(value, NumberType):
                raise DefaultValueTypeError(f"Value must be number type for {value}")

        # validate object type
        elif value_type == DefaultValueType.OBJECT:
            if isinstance(value, str):
                try:
                    value = json.loads(value)
                except json.JSONDecodeError:
                    raise DefaultValueTypeError(f"Value must be object type for {value}")
            if not isinstance(value, ObjectType):
                raise DefaultValueTypeError(f"Value must be object type for {value}")

        # validate array[number] type
        elif value_type == DefaultValueType.ARRAY_NUMBER:
            if isinstance(value, str):
                try:
                    value = json.loads(value)
                except json.JSONDecodeError:
                    raise DefaultValueTypeError(f"Value must be object type for {value}")
            if not isinstance(value, list):
                raise DefaultValueTypeError(f"Value must be array type for {value}")
            if not all(isinstance(x, NumberType) for x in value):
                raise DefaultValueTypeError(f"All elements must be numbers for {value}")

        # validate array[string] type
        elif value_type == DefaultValueType.ARRAY_STRING:
            if isinstance(value, str):
                try:
                    value = json.loads(value)
                except json.JSONDecodeError:
                    raise DefaultValueTypeError(f"Value must be object type for {value}")
            if not isinstance(value, list):
                raise DefaultValueTypeError(f"Value must be array type for {value}")
            if not all(isinstance(x, str) for x in value):
                raise DefaultValueTypeError(f"All elements must be strings for {value}")

        # validate array[object] type
        elif value_type == DefaultValueType.ARRAY_OBJECT:
            if isinstance(value, str):
                try:
                    value = json.loads(value)
                except json.JSONDecodeError:
                    raise DefaultValueTypeError(f"Value must be object type for {value}")
            if not isinstance(value, list):
                raise DefaultValueTypeError(f"Value must be array type for {value}")
            if not all(isinstance(x, ObjectType) for x in value):
                raise DefaultValueTypeError(f"All elements must be objects for {value}")
        elif value_type == DefaultValueType.ARRAY_FILES:
            # handle files type
            pass


class BaseNodeData(ABC, BaseModel):
    title: str
    desc: Optional[str] = None
    error_strategy: Optional[ErrorStrategy] = None
    default_value: Optional[list[DefaultValue]] = None
    version: str = "1"

    @property
    def default_value_dict(self):
        if self.default_value:
            return {item.key: item.value for item in self.default_value}
        return {}


class BaseIterationNodeData(BaseNodeData):
    start_node_id: Optional[str] = None


class BaseIterationState(BaseModel):
    iteration_node_id: str
    index: int
    inputs: dict

    class MetaData(BaseModel):
        pass

    metadata: MetaData
