from abc import ABC

from pydantic import BaseModel


class BaseNodeData(ABC, BaseModel):
    pass
