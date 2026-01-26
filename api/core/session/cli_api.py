import secrets

from pydantic import BaseModel, Field

from core.skill.entities import ToolAccessPolicy

from .session import BaseSession, SessionManager


class CliApiSession(BaseSession):
    secret: str = Field(default_factory=lambda: secrets.token_urlsafe(32))


class CliContext(BaseModel):
    tool_access: ToolAccessPolicy | None = Field(default=None, description="Tool access policy")


class CliApiSessionManager(SessionManager[CliApiSession]):
    def __init__(self, ttl: int | None = None):
        super().__init__(key_prefix="cli_api_session", session_class=CliApiSession, ttl=ttl)

    def create(self, tenant_id: str, user_id: str, context: CliContext) -> CliApiSession:
        session = CliApiSession(tenant_id=tenant_id, user_id=user_id, context=context.model_dump(mode="json"))
        self.save(session)
        return session
