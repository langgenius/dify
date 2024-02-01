from enum import Enum
from typing import Dict, List, Optional

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderCredentials
from core.tools.tool.tool import ToolParameter
from pydantic import BaseModel


class UserToolProvider(BaseModel):
    class ProviderType(Enum):
        BUILTIN = "builtin"
        APP = "app"
        API = "api"

    id: str
    author: str
    name: str # identifier
    description: I18nObject
    icon: str
    label: I18nObject # label
    type: ProviderType
    team_credentials: dict = None
    is_team_authorization: bool = False
    allow_delete: bool = True

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'author': self.author,
            'name': self.name,
            'description': self.description.to_dict(),
            'icon': self.icon,
            'label': self.label.to_dict(),
            'type': self.type.value,
            'team_credentials': self.team_credentials,
            'is_team_authorization': self.is_team_authorization,
            'allow_delete': self.allow_delete
        }

class UserToolProviderCredentials(BaseModel):
    credentials: Dict[str, ToolProviderCredentials]

class UserTool(BaseModel):
    author: str
    name: str # identifier
    label: I18nObject # label
    description: I18nObject
    parameters: Optional[List[ToolParameter]]