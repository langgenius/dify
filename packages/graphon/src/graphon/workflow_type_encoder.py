from collections.abc import Mapping
from decimal import Decimal
from typing import Any, overload

from pydantic import BaseModel

from graphon.file.models import File
from graphon.variables.segments import Segment
from graphon.variables.sensitivity import is_sensitive


class WorkflowRuntimeTypeConverter:
    @overload
    def to_json_encodable(self, value: Mapping[str, Any]) -> Mapping[str, Any]: ...
    @overload
    def to_json_encodable(self, value: None) -> None: ...

    def to_json_encodable(
        self,
        value: Mapping[str, Any] | None,
    ) -> Mapping[str, Any] | None:
        """Convert runtime values to JSON-serializable structures."""
        result = self.value_to_json_encodable_recursive(value)
        if isinstance(result, Mapping) or result is None:
            return result
        return {}

    def value_to_json_encodable_recursive(self, value: Any) -> Any:
        result = value
        match value:
            case None | bool() | int() | str() | float():
                result = value
            case Decimal():
                # Convert Decimal to float for JSON serialization
                result = float(value)
            case Segment() if is_sensitive(value):
                result = value.log
            case Segment():
                result = self.value_to_json_encodable_recursive(value.value)
            case File():
                result = value.to_dict()
            case BaseModel():
                result = value.model_dump(mode="json")
            case dict():
                encoded_mapping = {}
                for key, item in value.items():
                    encoded_mapping[key] = self.value_to_json_encodable_recursive(item)
                result = encoded_mapping
            case list():
                result = [
                    self.value_to_json_encodable_recursive(item) for item in value
                ]
        return result
