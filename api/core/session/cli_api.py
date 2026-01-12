import secrets
from typing import Any

from pydantic import Field

from .session import BaseSession, SessionManager


class CliApiSession(BaseSession):
    secret: str = Field(default_factory=lambda: secrets.token_urlsafe(32))
    secret: str = Field(default_factory=lambda: secrets.token_urlsafe(32))


class CliApiSessionManager(SessionManager[CliApiSession]):
    def __init__(self, ttl: int | None = None):
        super().__init__(key_prefix="cli_api_session", session_class=CliApiSession, ttl=ttl)

    def create(self, tenant_id: str, user_id: str, context: dict[str, Any] | None = None) -> CliApiSession:
        session = CliApiSession(tenant_id=tenant_id, user_id=user_id, context=context or {})
        self.save(session)
        return session
