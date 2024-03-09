from typing import Literal, Union

from pydantic import BaseModel

from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.variable_entities import VariableSelector


class HttpRequestNodeData(BaseNodeData):
    """
    Code Node Data.
    """
    class Authorization(BaseModel):
        class Config(BaseModel):
            type: Literal[None, 'basic', 'bearer', 'custom']
            api_key: Union[None, str]
            header: Union[None, str]

        type: Literal['no-auth', 'api-key']
        config: Config

    class Body(BaseModel):
        type: Literal[None, 'form-data', 'x-www-form-urlencoded', 'raw', 'json']
        data: Union[None, str]

    variables: list[VariableSelector]
    method: Literal['get', 'post', 'put', 'patch', 'delete']
    url: str
    authorization: Authorization
    headers: str
    params: str
    body: Body