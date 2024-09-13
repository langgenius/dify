from typing import List, Union, Optional, ClassVar

from ....core import BaseModel, PYDANTIC_V2, ConfigDict

__all__ = ["FineTunedModelsStatus"]


class FineTunedModelsStatus(BaseModel):
    if PYDANTIC_V2:
        model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow", protected_namespaces=())
    request_id: str  #请求id
    model_name: str  #模型名称
    delete_status: str  #删除状态 deleting（删除中）, deleted （已删除）
