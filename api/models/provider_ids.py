"""Provider ID entities for plugin system."""

from typing import override

from werkzeug.exceptions import NotFound

from domain.plugins.provider_id import normalize_provider_id, normalize_tool_provider_id


class GenericProviderID:
    organization: str
    plugin_name: str
    provider_name: str
    is_hardcoded: bool

    def to_string(self) -> str:
        return str(self)

    @override
    def __str__(self) -> str:
        return f"{self.organization}/{self.plugin_name}/{self.provider_name}"

    def __init__(self, value: str, is_hardcoded: bool = False) -> None:
        """Parse a provider ID; retain NotFound for missing IDs and ValueError for malformed IDs."""
        if not value:
            raise NotFound("plugin not found, please add plugin")
        self.organization, self.plugin_name, self.provider_name = normalize_provider_id(value).split("/")
        self.is_hardcoded = is_hardcoded

    def is_langgenius(self) -> bool:
        return self.organization == "langgenius"

    @property
    def plugin_id(self) -> str:
        return f"{self.organization}/{self.plugin_name}"


class ModelProviderID(GenericProviderID):
    def __init__(self, value: str, is_hardcoded: bool = False) -> None:
        super().__init__(value, is_hardcoded)
        if self.organization == "langgenius" and self.provider_name == "google":
            self.plugin_name = "gemini"


class ToolProviderID(GenericProviderID):
    def __init__(self, value: str, is_hardcoded: bool = False) -> None:
        """Normalize tool aliases while preserving the legacy NotFound error for missing IDs."""
        super().__init__(value, is_hardcoded)
        self.organization, self.plugin_name, self.provider_name = normalize_tool_provider_id(value).split("/")


class DatasourceProviderID(GenericProviderID):
    def __init__(self, value: str, is_hardcoded: bool = False) -> None:
        super().__init__(value, is_hardcoded)


class TriggerProviderID(GenericProviderID):
    def __init__(self, value: str, is_hardcoded: bool = False) -> None:
        super().__init__(value, is_hardcoded)
