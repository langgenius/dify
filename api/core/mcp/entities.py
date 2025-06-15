from dataclasses import dataclass
from typing import Any, Generic, TypeVar

from core.mcp.session.base_session import BaseSession
from core.mcp.types import LATEST_PROTOCOL_VERSION, RequestId, RequestParams

SUPPORTED_PROTOCOL_VERSIONS: tuple[int, str] = (1, LATEST_PROTOCOL_VERSION)


SessionT = TypeVar("SessionT", bound=BaseSession[Any, Any, Any, Any, Any])
LifespanContextT = TypeVar("LifespanContextT")


@dataclass
class RequestContext(Generic[SessionT, LifespanContextT]):
    request_id: RequestId
    meta: RequestParams.Meta | None
    session: SessionT
    lifespan_context: LifespanContextT
