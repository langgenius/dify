from pydantic import BaseModel

from core.tools.entities.tool_entities import ToolParameter


class ApiToolBundle(BaseModel):
    """
    This class is used to store the schema information of an api based tool.
     such as the url, the method, the parameters, etc.
    """

    # server_url
    server_url: str
    # method
    method: str
    # summary
    summary: str | None = None
    # operation_id
    operation_id: str | None = None
    # parameters
    parameters: list[ToolParameter] | None = None
    # author
    author: str
    # icon
    icon: str | None = None
    # openapi operation
    openapi: dict
