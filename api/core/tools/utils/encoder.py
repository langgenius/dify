from pydantic import BaseModel
from enum import Enum
from typing import List

def serialize_base_model_array(l: List[BaseModel]) -> str:
    class _BaseModel(BaseModel):
        __root__: List[BaseModel]

    """
        {"__root__": [BaseModel, BaseModel, ...]}
    """
    return _BaseModel(__root__=l).json()