from collections.abc import Mapping
from typing import Any

from pydantic import AliasChoices
from pydantic.fields import FieldInfo


class RemoteSettingsSource:
    def __init__(self, configs: Mapping[str, Any]):
        pass

    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        raise NotImplementedError

    def prepare_field_value(self, field_name: str, field: FieldInfo, value: Any, value_is_complex: bool):
        return value

    @staticmethod
    def _resolve_field_value(remote_configs: Mapping[str, Any], field: FieldInfo, field_name: str) -> tuple[Any, str]:
        """
        Look up ``field`` in ``remote_configs`` by its field name first, then fall back to its
        ``validation_alias`` (a plain string or any ``str`` member of an ``AliasChoices``),
        mirroring how ``EnvSettingsSource`` resolves keys for aliased fields.

        Returns ``(value, key)`` where ``key`` is the name that actually matched, so the caller
        emits a key that ``DifyConfig`` validation accepts. Returns ``(None, field_name)`` on a miss.
        """
        field_value = remote_configs.get(field_name)
        if field_value is not None:
            return field_value, field_name

        validation_alias = field.validation_alias
        if isinstance(validation_alias, str):
            alias_names = [validation_alias]
        elif isinstance(validation_alias, AliasChoices):
            alias_names = [choice for choice in validation_alias.choices if isinstance(choice, str)]
        else:
            alias_names = []

        for alias_name in alias_names:
            alias_value = remote_configs.get(alias_name)
            if alias_value is not None:
                return alias_value, alias_name

        return None, field_name
