
from pydantic import BaseModel


def serialize_base_model_array(l: list[BaseModel]) -> str:
    class _BaseModel(BaseModel):
        __root__: list[BaseModel]

    """
        {"__root__": [BaseModel, BaseModel, ...]}
    """
    return _BaseModel(__root__=l).json()

def serialize_base_model_dict(b: dict) -> str:
    class _BaseModel(BaseModel):
        __root__: dict

    """
        {"__root__": {BaseModel}}
    """
    return _BaseModel(__root__=b).json()
