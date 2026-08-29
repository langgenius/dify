from collections.abc import Mapping
from typing import Any

from pydantic import AliasChoices, AliasPath
from pydantic.fields import FieldInfo


class RemoteSettingsSource:
    def __init__(self, configs: Mapping[str, Any]):
        pass

    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        raise NotImplementedError

    @staticmethod
    def resolve_field_value(
        remote_configs: Mapping[str, Any], field: FieldInfo, field_name: str
    ) -> tuple[Any, str, bool]:
        field_value = remote_configs.get(field_name)
        if field_value is not None:
            return field_value, field_name, False

        validation_alias = field.validation_alias
        aliases: list[str] = []
        if isinstance(validation_alias, str):
            aliases.append(validation_alias)
        elif isinstance(validation_alias, AliasChoices):
            for alias in validation_alias.choices:
                if isinstance(alias, str):
                    aliases.append(alias)
                elif isinstance(alias, AliasPath) and alias.path and isinstance(alias.path[0], str):
                    aliases.append(alias.path[0])
        elif (
            isinstance(validation_alias, AliasPath)
            and validation_alias.path
            and isinstance(validation_alias.path[0], str)
        ):
            aliases.append(validation_alias.path[0])

        for alias in aliases:
            field_value = remote_configs.get(alias)
            if field_value is not None:
                return field_value, alias, False

        return None, field_name, False

    def prepare_field_value(self, field_name: str, field: FieldInfo, value: Any, value_is_complex: bool):
        return value
