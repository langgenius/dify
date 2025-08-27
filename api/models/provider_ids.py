"""Provider ID entities for plugin system."""

import re

from werkzeug.exceptions import NotFound


class GenericProviderID:
    organization: str
    plugin_name: str
    provider_name: str
    is_hardcoded: bool

    def to_string(self) -> str:
        return str(self)

    def __str__(self) -> str:
        return f"{self.organization}/{self.plugin_name}/{self.provider_name}"

    def __init__(self, value: str, is_hardcoded: bool = False) -> None:
        if not value:
            raise NotFound("plugin not found, please add plugin")
        # check if the value is a valid plugin id with format: $organization/$plugin_name/$provider_name
        if not re.match(r"^[a-z0-9_-]+\/[a-z0-9_-]+\/[a-z0-9_-]+$", value):
            # check if matches [a-z0-9_-]+, if yes, append with langgenius/$value/$value
            if re.match(r"^[a-z0-9_-]+$", value):
                value = f"langgenius/{value}/{value}"
            else:
                raise ValueError(f"Invalid plugin id {value}")

        self.organization, self.plugin_name, self.provider_name = value.split("/")
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
        super().__init__(value, is_hardcoded)
        if self.organization == "langgenius":
            if self.provider_name in ["jina", "siliconflow", "stepfun", "gitee_ai"]:
                self.plugin_name = f"{self.provider_name}_tool"


class DatasourceProviderID(GenericProviderID):
    def __init__(self, value: str, is_hardcoded: bool = False) -> None:
        super().__init__(value, is_hardcoded)
