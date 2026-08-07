from typing import Any

from werkzeug.wrappers import Request as Request

request: Request

class Response:
    def __init__(
        self,
        response: Any = ...,
        status: Any = ...,
        headers: Any = ...,
        mimetype: Any = ...,
        content_type: Any = ...,
        direct_passthrough: bool = ...,
    ) -> None: ...

def redirect(location: str, code: int = ..., Response: type[Response] | None = ...) -> Response: ...  # noqa: N803
def make_response(*args: Any) -> Response: ...
def render_template_string(source: str, **context: Any) -> str: ...
def __getattr__(name: str) -> Any: ...
