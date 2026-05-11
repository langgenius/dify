"""Workflow data migration CLI commands.

TODO: Remove the legacy system file workflow migration command after the production migration is complete.
"""

import logging
from dataclasses import dataclass

import click
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_database import db
from models.workflow import Workflow, WorkflowType

logger = logging.getLogger(__name__)


@dataclass
class LegacySysFilesWorkflowMigrationStats:
    scanned: int = 0
    migrated: int = 0
    failed: int = 0
    batches: int = 0
    last_id: str | None = None


def _build_legacy_sys_files_workflow_query(
    *,
    start_after_id: str | None,
    batch_size: int,
    tenant_id: str | None,
    app_id: str | None,
):
    # Workflow IDs are UUID4, so this is not chronological pagination. The migration only needs a stable total
    # order that matches the resume cursor; ordering by the same primary-key column used in the `id > cursor`
    # predicate lets each batch continue deterministically without offset scans.
    stmt = (
        select(Workflow)
        .where(Workflow.type.in_((WorkflowType.WORKFLOW, WorkflowType.CHAT)))
        .order_by(Workflow.id)
        .limit(batch_size)
    )
    if start_after_id:
        stmt = stmt.where(Workflow.id > start_after_id)
    if tenant_id:
        stmt = stmt.where(Workflow.tenant_id == tenant_id)
    if app_id:
        stmt = stmt.where(Workflow.app_id == app_id)
    return stmt


def _migrate_legacy_sys_files_workflow_batch(
    *,
    session: Session,
    start_after_id: str | None,
    batch_size: int,
    tenant_id: str | None,
    app_id: str | None,
    dry_run: bool,
) -> LegacySysFilesWorkflowMigrationStats:
    stats = LegacySysFilesWorkflowMigrationStats()
    workflows = session.scalars(
        _build_legacy_sys_files_workflow_query(
            start_after_id=start_after_id,
            batch_size=batch_size,
            tenant_id=tenant_id,
            app_id=app_id,
        )
    ).all()

    for workflow in workflows:
        stats.scanned += 1
        stats.last_id = workflow.id
        try:
            if workflow.migrate_legacy_sys_files_graph_in_place():
                stats.migrated += 1
        except Exception:
            stats.failed += 1
            logger.exception("Failed to migrate legacy sys.files workflow, workflow_id=%s", workflow.id)

    if dry_run:
        session.rollback()
    else:
        session.commit()
    return stats


def run_legacy_sys_files_workflow_migration(
    *,
    batch_size: int,
    limit: int | None,
    start_after_id: str | None,
    tenant_id: str | None,
    app_id: str | None,
    dry_run: bool,
) -> LegacySysFilesWorkflowMigrationStats:
    """Scan Workflow and Advanced Chat graphs in keyset-paginated batches."""
    if batch_size <= 0:
        raise click.UsageError("--batch-size must be greater than 0")
    if limit is not None and limit <= 0:
        raise click.UsageError("--limit must be greater than 0 when provided")

    session_maker = sessionmaker(db.engine, expire_on_commit=False)
    total = LegacySysFilesWorkflowMigrationStats(last_id=start_after_id)
    next_start_after_id = start_after_id

    while limit is None or total.scanned < limit:
        remaining = None if limit is None else limit - total.scanned
        current_batch_size = batch_size if remaining is None else min(batch_size, remaining)
        if current_batch_size <= 0:
            break

        with session_maker() as session:
            batch_stats = _migrate_legacy_sys_files_workflow_batch(
                session=session,
                start_after_id=next_start_after_id,
                batch_size=current_batch_size,
                tenant_id=tenant_id,
                app_id=app_id,
                dry_run=dry_run,
            )

        if batch_stats.scanned == 0:
            break

        total.scanned += batch_stats.scanned
        total.migrated += batch_stats.migrated
        total.failed += batch_stats.failed
        total.batches += 1
        total.last_id = batch_stats.last_id
        next_start_after_id = batch_stats.last_id

        if batch_stats.scanned < current_batch_size:
            break

    return total


@click.command(
    "migrate-legacy-sys-files-workflows",
    help="Migrate Workflow and Advanced Chat graphs that still reference deprecated sys.files.",
)
@click.option("--batch-size", default=1000, show_default=True, type=int, help="Number of workflows to scan per batch.")
@click.option("--limit", default=None, type=int, help="Maximum number of workflows to scan in this run.")
@click.option("--start-after-id", default=None, help="Resume scanning after this workflow ID.")
@click.option("--tenant-id", default=None, help="Limit migration to one tenant.")
@click.option("--app-id", default=None, help="Limit migration to one app.")
@click.option("--dry-run", is_flag=True, default=False, help="Scan and report without saving changes.")
def migrate_legacy_sys_files_workflows(
    batch_size: int,
    limit: int | None,
    start_after_id: str | None,
    tenant_id: str | None,
    app_id: str | None,
    dry_run: bool,
) -> None:
    stats = run_legacy_sys_files_workflow_migration(
        batch_size=batch_size,
        limit=limit,
        start_after_id=start_after_id,
        tenant_id=tenant_id,
        app_id=app_id,
        dry_run=dry_run,
    )
    click.echo(
        "Legacy sys.files workflow migration finished: "
        f"scanned={stats.scanned} migrated={stats.migrated} failed={stats.failed} "
        f"batches={stats.batches} last_id={stats.last_id or ''}"
    )
    if dry_run:
        click.echo("Dry run only: no workflow graph changes were saved.")
