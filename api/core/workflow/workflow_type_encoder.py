from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel

from core.file.models import File
from core.variables import Segment


class WorkflowRuntimeTypeConverter:
    def to_json_encodable(self, value: Mapping[str, Any] | None) -> Mapping[str, Any] | None:
        result = self._to_json_encodable_recursive(value)
        return result if isinstance(result, Mapping) or result is None else dict(result)

    def _to_json_encodable_recursive(self, value: Any) -> Any:
        if value is None:
            return value
        if isinstance(value, (bool, int, str, float)):
            return value
        if isinstance(value, Segment):
            return self._to_json_encodable_recursive(value.value)
        if isinstance(value, File):
            return value.to_dict()
        if isinstance(value, BaseModel):
            return value.model_dump(mode="json")
        if isinstance(value, dict):
            res = {}
            for k, v in value.items():
                res[k] = self._to_json_encodable_recursive(v)
            return res
        if isinstance(value, list):
            res_list = []
            for item in value:
                res_list.append(self._to_json_encodable_recursive(item))
            return res_list
        return value
