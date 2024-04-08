from abc import ABC
from typing import Optional

from pydantic import BaseModel


class BaseNodeData(ABC, BaseModel):
    title: str
    desc: Optional[str] = None
