from pydantic import BaseModel
from enum import Enum
from typing import List, Dict

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.assistant_entities import AssistantCredentials

class UserToolProvider(BaseModel):
    class ProviderType(Enum):
        BUILTIN = "builtin"
        APP = "app"
        API = "api"

    author: str
    name: str # identifier
    description: I18nObject
    icon: str
    label: I18nObject # label
    type: ProviderType
    team_credentials: dict = None
    self_credentails: List[dict] = None
    is_team_authorization: bool = False
    self_authorization_count: int = 0

    def to_dict(self) -> dict:
        return {
            'author': self.author,
            'name': self.name,
            'description': self.description.to_dict(),
            'icon': self.icon,
            'label': self.label.to_dict(),
            'type': self.type.value,
            'team_credentials': self.team_credentials,
            'self_credentails': self.self_credentails,
            'is_team_authorization': self.is_team_authorization,
            'self_authorization_count': self.self_authorization_count,
        }

class UserToolProviderCredentials(BaseModel):
    credentails: Dict[str, AssistantCredentials]

class UserTool(BaseModel):
    author: str
    name: str # identifier
    label: I18nObject # label
    icon: str
    class Description(BaseModel):
        human: I18nObject
        llm: str
    description: Description