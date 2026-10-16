from collections.abc import Mapping
from typing import Any, ClassVar

from pydantic import BaseModel
from werkzeug.exceptions import HTTPException


class BaseHTTPException(HTTPException):
    """An HTTP error whose body carries a stable ``code`` beside its English ``message``.

    A class that declares ``details_model`` is templated: ``description`` is a ``str.format``
    template over that model's fields, and raise sites pass ``details`` instead of a message.
    The body carries those values as ``details``, so clients can translate the error by
    ``code`` and interpolate them, while ``message`` stays the rendered English sentence.
    """

    error_code: str = "unknown"
    details_model: ClassVar[type[BaseModel] | None] = None
    data: dict[str, Any] | None = None

    def __init__(self, description=None, response=None, *, details: BaseModel | None = None):
        rendered: dict[str, Any] | None = None
        if self.details_model is not None:
            if description is not None:
                raise TypeError(f"{type(self).__name__} renders its message from details; pass details only")
            if type(details) is not self.details_model:
                raise TypeError(f"{type(self).__name__} requires details of type {self.details_model.__name__}")
            rendered = details.model_dump(mode="json")
            description = (self.description or "").format(**rendered)
        elif details is not None:
            raise TypeError(f"{type(self).__name__} declares no details_model")

        super().__init__(description, response)

        self.data = {
            "code": self.error_code,
            "message": self.description,
            "status": self.code,
        }
        if rendered is not None:
            self.data["details"] = rendered


class RelayedHTTPError(BaseHTTPException):
    """An error whose ``code`` and status are relayed from a downstream service at runtime.

    Emits the standard error body, but its codes cannot be listed per class. Declaring it
    with ``error_responses`` keeps the operation's error codes and statuses open.
    """

    def __init__(self, *, status: int, error_code: str, message: str, details: Mapping[str, Any] | None = None) -> None:
        self.code = status
        self.error_code = error_code
        super().__init__(description=message)
        if details:
            assert self.data is not None
            self.data["details"] = dict(details)
