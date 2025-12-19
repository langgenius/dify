from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from core.datasource.entities.datasource_entities import DatasourceParameter
from core.model_runtime.utils.encoders import jsonable_encoder
from core.tools.entities.common_entities import I18nObject


class DatasourceApiEntity(BaseModel):
    author: str
    name: str  # identifier
    label: I18nObject  # label
    description: I18nObject
    parameters: list[DatasourceParameter] | None = None
    labels: list[str] = Field(default_factory=list)
    output_schema: dict | None = None


ToolProviderTypeApiLiteral = Optional[Literal["builtin", "api", "workflow"]]


class DatasourceProviderApiEntity(BaseModel):
    id: str
    author: str
    name: str  # identifier
    description: I18nObject
    icon: str | dict
    label: I18nObject  # label
    type: str
    masked_credentials: dict | None = None
    original_credentials: dict | None = None
    is_team_authorization: bool = False
    allow_delete: bool = True
    plugin_id: str | None = Field(default="", description="The plugin id of the datasource")
    plugin_unique_identifier: str | None = Field(default="", description="The unique identifier of the datasource")
    datasources: list[DatasourceApiEntity] = Field(default_factory=list)
    labels: list[str] = Field(default_factory=list)

    @field_validator("datasources", mode="before")
    @classmethod
    def convert_none_to_empty_list(cls, v):
        return v if v is not None else []

    def to_dict(self) -> dict:
        # -------------
        # overwrite datasource parameter types for temp fix
        datasources = jsonable_encoder(self.datasources)
        for datasource in datasources:
            if datasource.get("parameters"):
                for parameter in datasource.get("parameters"):
                    if parameter.get("type") == DatasourceParameter.DatasourceParameterType.SYSTEM_FILES:
                        parameter["type"] = "files"
        # -------------

        return {
            "id": self.id,
            "author": self.author,
            "name": self.name,
            "plugin_id": self.plugin_id,
            "plugin_unique_identifier": self.plugin_unique_identifier,
            "description": self.description.to_dict(),
            "icon": self.icon,
            "label": self.label.to_dict(),
            "type": self.type,
            "team_credentials": self.masked_credentials,
            "is_team_authorization": self.is_team_authorization,
            "allow_delete": self.allow_delete,
            "datasources": datasources,
            "labels": self.labels,
        }
