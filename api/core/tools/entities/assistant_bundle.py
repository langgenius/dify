from pydantic import BaseModel
from typing import Dict, Optional, Any

from core.tools.entities.assistant_entities import AssistantAppType

class AssistantApiBasedToolBundle(BaseModel):
    """
    This class is used to store the schema information of an api based tool. such as the url, the method, the parameters, etc.
    """
    pass

class AssistantAppToolBundle(BaseModel):
    """
    This class is used to store the schema information of an tool for an app.
    """
    type: AssistantAppType
    credential: Optional[Dict[str, Any]] = None
    provider_id: str
    tool_name: str