from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Generic, TypeVar

from pydantic import BaseModel

from core.mcp.session.base_session import BaseSession
from core.mcp.types import LATEST_PROTOCOL_VERSION, OAuthClientInformation, OAuthMetadata, RequestId, RequestParams

SUPPORTED_PROTOCOL_VERSIONS: list[str] = ["2024-11-05", "2025-03-26", LATEST_PROTOCOL_VERSION]


SessionT = TypeVar("SessionT", bound=BaseSession[Any, Any, Any, Any, Any])
LifespanContextT = TypeVar("LifespanContextT")


@dataclass
class RequestContext(Generic[SessionT, LifespanContextT]):
    request_id: RequestId
    meta: RequestParams.Meta | None
    session: SessionT
    lifespan_context: LifespanContextT


class AuthActionType(StrEnum):
    """Types of actions that can be performed during auth flow."""

    SAVE_CLIENT_INFO = "save_client_info"
    SAVE_TOKENS = "save_tokens"
    SAVE_CODE_VERIFIER = "save_code_verifier"
    START_AUTHORIZATION = "start_authorization"
    SUCCESS = "success"


class AuthAction(BaseModel):
    """Represents an action that needs to be performed as a result of auth flow."""

    action_type: AuthActionType
    data: dict[str, Any]
    provider_id: str | None = None
    tenant_id: str | None = None


class AuthResult(BaseModel):
    """Result of auth function containing actions to be performed and response data."""

    actions: list[AuthAction]
    response: dict[str, str]


class OAuthCallbackState(BaseModel):
    """State data stored in Redis during OAuth callback flow."""

    provider_id: str
    tenant_id: str
    server_url: str
    metadata: OAuthMetadata | None = None
    client_information: OAuthClientInformation
    code_verifier: str
    redirect_uri: str
