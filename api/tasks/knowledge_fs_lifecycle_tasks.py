"""Gated poller for KnowledgeFS lifecycle outbox delivery and reconciliation."""

from __future__ import annotations

import socket
from datetime import timedelta
from typing import TypedDict

from celery import shared_task

from configs import dify_config
from core.db.session_factory import session_factory
from libs.datetime_utils import naive_utc_now
from services.knowledge_fs.lifecycle_readiness import get_configured_knowledge_fs_lifecycle_worker_readiness
from services.knowledge_fs.lifecycle_saga import KnowledgeFSLifecycleSagaRunner
from services.knowledge_fs.orphan_reconciler import KnowledgeFSOrphanReconciler
from services.knowledge_fs.remote_registry import get_knowledge_fs_lifecycle_remote


class KnowledgeFSLifecycleWorkerResult(TypedDict):
    status: str
    dispatched: int
    completed: int
    reconciled: int


@shared_task(queue="knowledge_fs_lifecycle")
def run_knowledge_fs_lifecycle_worker() -> KnowledgeFSLifecycleWorkerResult:
    readiness = get_configured_knowledge_fs_lifecycle_worker_readiness()
    if not readiness.ready:
        return {"status": "disabled", "dispatched": 0, "completed": 0, "reconciled": 0}

    remote = get_knowledge_fs_lifecycle_remote()
    session_maker = session_factory.get_session_maker()
    runner = KnowledgeFSLifecycleSagaRunner(session_maker, remote)
    worker_id = f"{socket.gethostname()}:{run_knowledge_fs_lifecycle_worker.request.id or 'manual'}"
    dispatched = 0
    completed = 0
    for _ in range(dify_config.KNOWLEDGE_FS_LIFECYCLE_BATCH_SIZE):
        result = runner.dispatch_one(
            worker_id=worker_id,
            now=naive_utc_now(),
            lease_duration=timedelta(seconds=dify_config.KNOWLEDGE_FS_LIFECYCLE_LEASE_SECONDS),
            product_enabled=dify_config.KNOWLEDGE_FS_ENABLED,
        )
        if not result.claimed:
            break
        dispatched += 1
        completed += result.completed
    report = KnowledgeFSOrphanReconciler(session_maker, remote).reconcile(
        limit=dify_config.KNOWLEDGE_FS_LIFECYCLE_BATCH_SIZE,
        apply_repairs=True,
    )
    reconciled = len(report.repaired_control_space_ids) + len(report.cleanup_control_space_ids)
    return {"status": "ok", "dispatched": dispatched, "completed": completed, "reconciled": reconciled}


__all__ = ["run_knowledge_fs_lifecycle_worker"]
