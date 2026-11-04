from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


class SessionResponseSource[SourceT]:
    """Wrap a model so session-backed accessors resolve during response validation.

    Subclasses override the accessors that need the session as properties;
    every other attribute is delegated to the wrapped model unchanged.
    """

    def __init__(self, source: SourceT, *, session: Session) -> None:
        self._source = source
        self._session = session

    def __getattr__(self, name: str) -> object:
        return getattr(self._source, name)  # guard-ignore: no-new-getattr -- delegates model fields


class ResponseModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        extra="ignore",
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
        protected_namespaces=(),
    )
