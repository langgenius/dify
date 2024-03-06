from abc import ABC
from typing import Optional

from pydantic import BaseModel


class BaseNodeData(ABC, BaseModel):
    type: str

    title: str
    desc: Optional[str] = None
