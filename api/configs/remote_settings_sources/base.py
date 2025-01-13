from collections.abc import Mapping
from typing import Any

from pydantic.fields import FieldInfo


class RemoteSettingsSource:
    def __init__(self, configs: Mapping[str, Any]):
        pass

    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        raise NotImplementedError

    def prepare_field_value(self, field_name: str, field: FieldInfo, value: Any, value_is_complex: bool) -> Any:
        return value
