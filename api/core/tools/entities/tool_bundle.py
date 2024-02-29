from typing import Any, Optional

from pydantic import BaseModel

from core.tools.entities.tool_entities import ToolParameter, ToolProviderType


class ApiBasedToolBundle(BaseModel):
    """
    This class is used to store the schema information of an api based tool. such as the url, the method, the parameters, etc.
    """
    # server_url
    server_url: str
    # method
    method: str
    # summary
    summary: Optional[str] = None
    # operation_id
    operation_id: str = None
    # parameters
    parameters: Optional[list[ToolParameter]] = None
    # author
    author: str
    # icon
    icon: Optional[str] = None
    # openapi operation
    openapi: dict

class AppToolBundle(BaseModel):
    """
    This class is used to store the schema information of an tool for an app.
    """
    type: ToolProviderType
    credential: Optional[dict[str, Any]] = None
    provider_id: str
    tool_name: str