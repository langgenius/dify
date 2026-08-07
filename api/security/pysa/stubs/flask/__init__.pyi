from typing import Any

from werkzeug.wrappers import Request as Request

request: Request

def __getattr__(name: str) -> Any: ...
