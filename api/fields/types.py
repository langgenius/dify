from typing import Annotated, Any

from pydantic import WithJsonSchema

type ShallowJSONValue = str | int | float | bool | None | dict[str, Any] | list[Any]
type JSONObject = dict[str, Any]

URLString = Annotated[str, WithJsonSchema({"format": "url", "type": "string"})]
UUIDString = Annotated[str, WithJsonSchema({"format": "uuid", "type": "string"})]
Int64 = Annotated[int, WithJsonSchema({"format": "int64", "type": "integer"})]
FloatNumber = Annotated[float, WithJsonSchema({"format": "float", "type": "number"})]
DoubleNumber = Annotated[float, WithJsonSchema({"format": "double", "type": "number"})]
DecimalString = Annotated[str, WithJsonSchema({"format": "decimal", "type": "string"})]
