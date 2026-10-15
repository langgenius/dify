"""Typed fakes shared by the KnowledgeFS service tests that replace mock-based doubles."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from libs.datetime_utils import naive_utc_now
from models.knowledge_fs import KnowledgeFSUpgradeJob


def upgrade_job(*, job_id: str, old_dataset_id: str, tenant_id: str = "tenant-1") -> KnowledgeFSUpgradeJob:
    job = KnowledgeFSUpgradeJob(
        tenant_id=tenant_id,
        old_dataset_id=old_dataset_id,
        requested_by_account_id="account-1",
        owner_account_id="account-1",
        idempotency_key=f"upgrade-{job_id}",
        snapshot_at=naive_utc_now(),
        config_snapshot={},
        permission_snapshot={},
        app_binding_snapshot=[],
        tag_ids_snapshot=[],
    )
    job.id = job_id
    return job


class UnusedSession:
    """Session placeholder for code paths whose session use is patched out."""


class UnusedSessionFactory:
    def __init__(self) -> None:
        self.opened = 0

    @contextmanager
    def __call__(self) -> Iterator[UnusedSession]:
        self.opened += 1
        yield UnusedSession()
