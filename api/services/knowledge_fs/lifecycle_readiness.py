"""Fail-closed rollout gates for the KnowledgeFS lifecycle worker."""

from __future__ import annotations

from typing import NamedTuple


class KnowledgeFSLifecycleWorkerReadiness(NamedTuple):
    ready: bool
    blockers: tuple[str, ...]


def evaluate_knowledge_fs_lifecycle_worker_readiness(
    *,
    worker_enabled: bool,
    capability_v2_enabled: bool,
    integrated_provision_ready: bool,
    legacy_acl_freeze_ready: bool,
) -> KnowledgeFSLifecycleWorkerReadiness:
    """Require every security dependency without coupling cleanup to the product flag."""

    gates = (
        ("worker", worker_enabled),
        ("capability_v2", capability_v2_enabled),
        ("integrated_provision", integrated_provision_ready),
        ("legacy_acl_freeze", legacy_acl_freeze_ready),
    )
    blockers = tuple(name for name, enabled in gates if not enabled)
    return KnowledgeFSLifecycleWorkerReadiness(ready=not blockers, blockers=blockers)


def get_configured_knowledge_fs_lifecycle_worker_readiness() -> KnowledgeFSLifecycleWorkerReadiness:
    from configs import dify_config

    return evaluate_knowledge_fs_lifecycle_worker_readiness(
        worker_enabled=dify_config.KNOWLEDGE_FS_LIFECYCLE_WORKER_ENABLED,
        capability_v2_enabled=dify_config.KNOWLEDGE_FS_CAPABILITY_V2_ENABLED,
        integrated_provision_ready=dify_config.KNOWLEDGE_FS_INTEGRATED_PROVISION_READY,
        legacy_acl_freeze_ready=dify_config.KNOWLEDGE_FS_LEGACY_ACL_FREEZE_READY,
    )


__all__ = [
    "KnowledgeFSLifecycleWorkerReadiness",
    "evaluate_knowledge_fs_lifecycle_worker_readiness",
    "get_configured_knowledge_fs_lifecycle_worker_readiness",
]
