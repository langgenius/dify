import os
from typing import Literal, Optional, Union

from pydantic import BaseModel, ValidationInfo, field_validator

from core.workflow.entities.base_node_data_entities import BaseNodeData

MAX_CONNECT_TIMEOUT = int(os.environ.get('HTTP_REQUEST_MAX_CONNECT_TIMEOUT', '300'))
MAX_READ_TIMEOUT = int(os.environ.get('HTTP_REQUEST_MAX_READ_TIMEOUT', '600'))
MAX_WRITE_TIMEOUT = int(os.environ.get('HTTP_REQUEST_MAX_WRITE_TIMEOUT', '600'))

class HttpRequestNodeData(BaseNodeData):
    """
    Code Node Data.
    """
    class Authorization(BaseModel):
        # TODO[pydantic]: The `Config` class inherits from another class, please create the `model_config` manually.
        # Check https://docs.pydantic.dev/dev-v2/migration/#changes-to-config for more information.
        class Config(BaseModel):
            type: Literal[None, 'basic', 'bearer', 'custom']
            api_key: Union[None, str] = None
            header: Union[None, str] = None

        type: Literal['no-auth', 'api-key']
        config: Optional[Config] = None

        @field_validator('config', mode='before')
        @classmethod
        def check_config(cls, v: Config, values: ValidationInfo):
            """
            Check config, if type is no-auth, config should be None, otherwise it should be a dict.
            """
            if values.data['type'] == 'no-auth':
                return None
            else:
                if not v or not isinstance(v, dict):
                    raise ValueError('config should be a dict')
                
                return v

    class Body(BaseModel):
        type: Literal['none', 'form-data', 'x-www-form-urlencoded', 'raw-text', 'json']
        data: Union[None, str] = None

    class Timeout(BaseModel):
        connect: Optional[int] = MAX_CONNECT_TIMEOUT
        read:  Optional[int] = MAX_READ_TIMEOUT
        write:  Optional[int] = MAX_WRITE_TIMEOUT

    method: Literal['get', 'post', 'put', 'patch', 'delete', 'head']
    url: str
    authorization: Authorization
    headers: str
    params: str
    body: Optional[Body] = None
    timeout: Optional[Timeout] = None
    mask_authorization_header: Optional[bool] = True
