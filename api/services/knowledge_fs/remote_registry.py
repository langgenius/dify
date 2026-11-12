"""Process-local assembly hook for the injectable KnowledgeFS lifecycle port."""

from __future__ import annotations

from collections.abc import Callable

from services.knowledge_fs.lifecycle_port import KnowledgeFSLifecycleRemotePort

_remote_factory: Callable[[], KnowledgeFSLifecycleRemotePort] | None = None


def configure_knowledge_fs_lifecycle_remote_factory(
    factory: Callable[[], KnowledgeFSLifecycleRemotePort],
) -> None:
    global _remote_factory
    _remote_factory = factory


def get_knowledge_fs_lifecycle_remote() -> KnowledgeFSLifecycleRemotePort:
    if _remote_factory is not None:
        return _remote_factory()
    return create_configured_knowledge_fs_lifecycle_remote()


def create_configured_knowledge_fs_lifecycle_remote() -> KnowledgeFSLifecycleRemotePort:
    """Assemble the production adapter lazily in API, worker, and operator processes."""

    from configs import dify_config
    from core.db.session_factory import session_factory
    from repositories.sqlalchemy_knowledge_fs_capability_issuance_auditor import (
        SQLAlchemyKnowledgeFSCapabilityIssuanceAuditor,
    )
    from services.knowledge_fs.lifecycle_remote_http import HTTPKnowledgeFSLifecycleRemoteClient
    from services.knowledge_fs_capability import create_configured_knowledge_fs_capability_issuer

    if dify_config.KNOWLEDGE_FS_BASE_URL is None:
        raise RuntimeError("KnowledgeFS lifecycle remote requires KNOWLEDGE_FS_BASE_URL")
    issuer = create_configured_knowledge_fs_capability_issuer(
        audit=SQLAlchemyKnowledgeFSCapabilityIssuanceAuditor(session_factory.get_session_maker())
    )
    if issuer is None:
        raise RuntimeError("KnowledgeFS lifecycle remote requires Capability v2 issuance")
    return HTTPKnowledgeFSLifecycleRemoteClient(
        base_url=dify_config.KNOWLEDGE_FS_BASE_URL,
        issuer=issuer,
        timeout_seconds=dify_config.KNOWLEDGE_FS_TIMEOUT_SECONDS,
    )


__all__ = [
    "configure_knowledge_fs_lifecycle_remote_factory",
    "create_configured_knowledge_fs_lifecycle_remote",
    "get_knowledge_fs_lifecycle_remote",
]
