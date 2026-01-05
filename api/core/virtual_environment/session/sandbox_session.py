from enum import StrEnum
from typing import Any

from pydantic import Field

from core.session import BaseSession, SessionManager
from core.virtual_environment.__base.entities import Arch


class SandboxProvider(StrEnum):
    E2B = "e2b"
    DOCKER = "docker"
    LOCAL = "local"


class SandboxSession(BaseSession):
    provider: SandboxProvider
    sandbox_id: str
    arch: Arch
    connection_config: dict[str, Any] = Field(default_factory=dict)


class SandboxSessionManager(SessionManager[SandboxSession]):
    def __init__(self, ttl: int | None = None):
        super().__init__(key_prefix="sandbox_session", session_class=SandboxSession, ttl=ttl)

    def create(
        self,
        tenant_id: str,
        user_id: str,
        provider: SandboxProvider,
        sandbox_id: str,
        arch: Arch,
        connection_config: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> SandboxSession:
        session = SandboxSession(
            tenant_id=tenant_id,
            user_id=user_id,
            provider=provider,
            sandbox_id=sandbox_id,
            arch=arch,
            connection_config=connection_config or {},
            context=context or {},
        )
        self.save(session)
        return session
