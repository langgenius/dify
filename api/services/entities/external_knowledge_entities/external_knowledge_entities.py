from typing import Literal, Union, Optional

from pydantic import BaseModel


class AuthorizationConfig(BaseModel):
    type: Literal[None, 'basic', 'bearer', 'custom']
    api_key: Union[None, str] = None
    header: Union[None, str] = None


class Authorization(BaseModel):
    type: Literal['no-auth', 'api-key']
    config: Optional[AuthorizationConfig] = None


class ProcessStatusSetting(BaseModel):
    request_method: str
    url: str


class ApiTemplateSetting(BaseModel):
    method: str
    url: str
    request_method: str
    authorization: Authorization
    headers: Optional[dict] = None
    params: Optional[dict] = None
    callback_setting: Optional[ProcessStatusSetting] = None
