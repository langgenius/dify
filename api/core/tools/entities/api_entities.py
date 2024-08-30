from typing import Literal, Optional

from pydantic import BaseModel, Field

from core.entities.provider_entities import ProviderConfig
from core.model_runtime.utils.encoders import jsonable_encoder
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.tool.tool import ToolParameter


class UserTool(BaseModel):
    author: str
    name: str # identifier
    label: I18nObject # label
    description: I18nObject
    parameters: Optional[list[ToolParameter]] = None
    labels: list[str] = Field(default_factory=list)

UserToolProviderTypeLiteral = Optional[Literal[
    'builtin', 'api', 'workflow'
]]

class UserToolProvider(BaseModel):
    id: str
    author: str
    name: str # identifier
    description: I18nObject
    icon: str | dict
    label: I18nObject # label
    type: ToolProviderType
    masked_credentials: Optional[dict] = None
    original_credentials: Optional[dict] = None
    is_team_authorization: bool = False
    allow_delete: bool = True
    tools: list[UserTool] = Field(default_factory=list)
    labels: list[str] = Field(default_factory=list)

    def to_dict(self) -> dict:
        # -------------
        # overwrite tool parameter types for temp fix
        tools = jsonable_encoder(self.tools)
        for tool in tools:
            if tool.get('parameters'):
                for parameter in tool.get('parameters'):
                    if parameter.get('type') == ToolParameter.ToolParameterType.FILE.value:
                        parameter['type'] = 'files'
        # -------------

        return {
            'id': self.id,
            'author': self.author,
            'name': self.name,
            'description': self.description.to_dict(),
            'icon': self.icon,
            'label': self.label.to_dict(),
            'type': self.type.value,
            'team_credentials': self.masked_credentials,
            'is_team_authorization': self.is_team_authorization,
            'allow_delete': self.allow_delete,
            'tools': tools,
            'labels': self.labels,
        }

class UserToolProviderCredentials(BaseModel):
    credentials: dict[str, ProviderConfig]