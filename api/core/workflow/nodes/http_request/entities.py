from typing import Literal, Optional, Union

from pydantic import BaseModel, validator

from core.workflow.entities.base_node_data_entities import BaseNodeData


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
        config: Optional[Config]

        @validator('config', always=True, pre=True)
        def check_config(cls, v, values):
            """
            Check config, if type is no-auth, config should be None, otherwise it should be a dict.
            """
            if values['type'] == 'no-auth':
                return None
            else:
                if not v or not isinstance(v, dict):
                    raise ValueError('config should be a dict')
                
                return v

    class Body(BaseModel):
        type: Literal['none', 'form-data', 'x-www-form-urlencoded', 'raw-text', 'json']
        data: Union[None, str]

    method: Literal['get', 'post', 'put', 'patch', 'delete', 'head']
    url: str
    authorization: Authorization
    headers: str
    params: str
    body: Optional[Body]