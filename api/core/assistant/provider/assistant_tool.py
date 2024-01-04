from pydantic import BaseModel

from core.assistant.entities.common_entities import I18nObject
from core.assistant.entities.assistant_entities import AssistantToolIdentity

class AssistantTool(BaseModel):
    identity: AssistantToolIdentity = None