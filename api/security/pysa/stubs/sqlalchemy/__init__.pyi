from typing import Any

from .engine import Connection as Connection
from .orm import Session as Session

def text(text: str) -> Any: ...
def __getattr__(name: str) -> Any: ...
