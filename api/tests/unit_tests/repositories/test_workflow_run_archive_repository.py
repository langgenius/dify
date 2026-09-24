import datetime

from sqlalchemy.orm import Session, sessionmaker

from models.workflow import WorkflowRunArchiveBundle
from repositories.workflow_run_archive_repository import WorkflowRunArchiveBundleQueryRepository
from services.retention.workflow_run.archive_log_service import WorkflowRunArchiveBundleRecord


def _bundle(
    *,
    tenant_id: str,
    year: int,
    month: int,
    shard: str,
    bundle_id: str,
    workflow_run_count: int = 1,
    row_count: int = 9,
    archive_bytes: int = 1024,
    archived_at: datetime.datetime | None = None,
) -> WorkflowRunArchiveBundle:
    return WorkflowRunArchiveBundle(
        tenant_id=tenant_id,
        year=year,
        month=month,
        shard=shard,
        bundle_id=bundle_id,
        workflow_run_count=workflow_run_count,
        row_count=row_count,
        archive_bytes=archive_bytes,
        archived_at=archived_at or datetime.datetime(2026, 6, 25, 8, 0),
    )


def test_list_for_tenant_returns_ordered_pure_records(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    latest = datetime.datetime(2026, 6, 26, 8, 0)
    previous = datetime.datetime(2026, 6, 25, 8, 0)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _bundle(
                    tenant_id="tenant-1",
                    year=2025,
                    month=2,
                    shard="00-of-01",
                    bundle_id="bundle-c",
                ),
                _bundle(
                    tenant_id="tenant-1",
                    year=2025,
                    month=3,
                    shard="01-of-02",
                    bundle_id="bundle-b",
                    workflow_run_count=60,
                    row_count=540,
                    archive_bytes=3072,
                    archived_at=latest,
                ),
                _bundle(
                    tenant_id="tenant-1",
                    year=2025,
                    month=3,
                    shard="00-of-02",
                    bundle_id="bundle-a",
                    workflow_run_count=40,
                    row_count=360,
                    archive_bytes=1024,
                    archived_at=previous,
                ),
                _bundle(
                    tenant_id="tenant-2",
                    year=2026,
                    month=1,
                    shard="00-of-01",
                    bundle_id="other-tenant-bundle",
                ),
            ]
        )

    records = WorkflowRunArchiveBundleQueryRepository(session_factory=sqlite_session_factory).list_for_tenant(
        "tenant-1"
    )

    assert records == (
        WorkflowRunArchiveBundleRecord(2025, 3, "00-of-02", "bundle-a", 40, 360, 1024, previous),
        WorkflowRunArchiveBundleRecord(2025, 3, "01-of-02", "bundle-b", 60, 540, 3072, latest),
        WorkflowRunArchiveBundleRecord(2025, 2, "00-of-01", "bundle-c", 1, 9, 1024, previous),
    )


def test_list_for_tenant_month_filters_and_orders_bundles(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    archived_at = datetime.datetime(2026, 6, 25, 8, 0)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _bundle(
                    tenant_id="tenant-1",
                    year=2025,
                    month=3,
                    shard="00-of-01",
                    bundle_id="bundle-b",
                ),
                _bundle(
                    tenant_id="tenant-1",
                    year=2025,
                    month=3,
                    shard="00-of-01",
                    bundle_id="bundle-a",
                ),
                _bundle(
                    tenant_id="tenant-1",
                    year=2025,
                    month=2,
                    shard="00-of-01",
                    bundle_id="previous-month",
                ),
                _bundle(
                    tenant_id="tenant-2",
                    year=2025,
                    month=3,
                    shard="00-of-01",
                    bundle_id="other-tenant-bundle",
                ),
            ]
        )

    records = WorkflowRunArchiveBundleQueryRepository(session_factory=sqlite_session_factory).list_for_tenant_month(
        "tenant-1", year=2025, month=3
    )

    assert records == (
        WorkflowRunArchiveBundleRecord(2025, 3, "00-of-01", "bundle-a", 1, 9, 1024, archived_at),
        WorkflowRunArchiveBundleRecord(2025, 3, "00-of-01", "bundle-b", 1, 9, 1024, archived_at),
    )
