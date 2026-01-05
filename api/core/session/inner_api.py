from typing import Any

from .session import BaseSession, SessionManager


class InnerApiSession(BaseSession):
    """Inner API Session"""

    pass


class InnerApiSessionManager(SessionManager[InnerApiSession]):
    def __init__(self, ttl: int | None = None):
        super().__init__(key_prefix="inner_api_session", session_class=InnerApiSession, ttl=ttl)

    def create(self, tenant_id: str, user_id: str, context: dict[str, Any] | None = None) -> InnerApiSession:
        session = InnerApiSession(tenant_id=tenant_id, user_id=user_id, context=context or {})
        self.save(session)
        return session
