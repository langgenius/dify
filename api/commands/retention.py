import datetime
import logging
import time
from typing import Any

import click
import sqlalchemy as sa

from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from services.clear_free_plan_tenant_expired_logs import ClearFreePlanTenantExpiredLogs
from services.retention.conversation.messages_clean_policy import create_message_clean_policy
from services.retention.conversation.messages_clean_service import MessagesCleanService
from services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs import WorkflowRunCleanup
from tasks.remove_app_and_related_data_task import delete_draft_variables_batch

logger = logging.getLogger(__name__)


@click.command("clear-free-plan-tenant-expired-logs", help="Clear free plan tenant expired logs.")
@click.option("--days", prompt=True, help="The days to clear free plan tenant expired logs.", default=30)
@click.option("--batch", prompt=True, help="The batch size to clear free plan tenant expired logs.", default=100)
@click.option(
    "--tenant_ids",
    prompt=True,
    multiple=True,
    help="The tenant ids to clear free plan tenant expired logs.",
)
def clear_free_plan_tenant_expired_logs(days: int, batch: int, tenant_ids: list[str]):
    """
    Clear free plan tenant expired logs.
    """
    click.echo(click.style("Starting clear free plan tenant expired logs.", fg="white"))

    ClearFreePlanTenantExpiredLogs.process(days, batch, tenant_ids)

    click.echo(click.style("Clear free plan tenant expired logs completed.", fg="green"))


@click.command("clean-workflow-runs", help="Clean expired workflow runs and related data for free tenants.")
@click.option(
    "--before-days",
    "--days",
    default=30,
    show_default=True,
    type=click.IntRange(min=0),
    help="Delete workflow runs created before N days ago.",
)
@click.option("--batch-size", default=200, show_default=True, help="Batch size for selecting workflow runs.")
@click.option(
    "--from-days-ago",
    default=None,
    type=click.IntRange(min=0),
    help="Lower bound in days ago (older). Must be paired with --to-days-ago.",
)
@click.option(
    "--to-days-ago",
    default=None,
    type=click.IntRange(min=0),
    help="Upper bound in days ago (newer). Must be paired with --from-days-ago.",
)
@click.option(
    "--start-from",
    type=click.DateTime(formats=["%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"]),
    default=None,
    help="Optional lower bound (inclusive) for created_at; must be paired with --end-before.",
)
@click.option(
    "--end-before",
    type=click.DateTime(formats=["%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"]),
    default=None,
    help="Optional upper bound (exclusive) for created_at; must be paired with --start-from.",
)
@click.option(
    "--dry-run",
    is_flag=True,
    help="Preview cleanup results without deleting any workflow run data.",
)
def clean_workflow_runs(
    before_days: int,
    batch_size: int,
    from_days_ago: int | None,
    to_days_ago: int | None,
    start_from: datetime.datetime | None,
    end_before: datetime.datetime | None,
    dry_run: bool,
):
    """
    Clean workflow runs and related workflow data for free tenants.
    """
    from extensions.otel.runtime import flush_telemetry

    if (start_from is None) ^ (end_before is None):
        raise click.UsageError("--start-from and --end-before must be provided together.")

    if (from_days_ago is None) ^ (to_days_ago is None):
        raise click.UsageError("--from-days-ago and --to-days-ago must be provided together.")

    if from_days_ago is not None and to_days_ago is not None:
        if start_from or end_before:
            raise click.UsageError("Choose either day offsets or explicit dates, not both.")
        if from_days_ago <= to_days_ago:
            raise click.UsageError("--from-days-ago must be greater than --to-days-ago.")
        now = datetime.datetime.now()
        start_from = now - datetime.timedelta(days=from_days_ago)
        end_before = now - datetime.timedelta(days=to_days_ago)
        before_days = 0

    if from_days_ago is not None and to_days_ago is not None:
        task_label = f"{from_days_ago}to{to_days_ago}"
    elif start_from is None:
        task_label = f"before-{before_days}"
    else:
        task_label = "custom"

    start_time = datetime.datetime.now(datetime.UTC)
    click.echo(click.style(f"Starting workflow run cleanup at {start_time.isoformat()}.", fg="white"))

    try:
        WorkflowRunCleanup(
            days=before_days,
            batch_size=batch_size,
            start_from=start_from,
            end_before=end_before,
            dry_run=dry_run,
            task_label=task_label,
        ).run()
    finally:
        flush_telemetry()

    end_time = datetime.datetime.now(datetime.UTC)
    elapsed = end_time - start_time
    click.echo(
        click.style(
            f"Workflow run cleanup completed. start={start_time.isoformat()} "
            f"end={end_time.isoformat()} duration={elapsed}",
            fg="green",
        )
    )


@click.command(
    "archive-workflow-runs",
    help="Archive workflow runs for paid plan tenants to S3-compatible storage.",
)
@click.option("--tenant-ids", default=None, help="Optional comma-separated tenant IDs for grayscale rollout.")
@click.option("--before-days", default=90, show_default=True, help="Archive runs older than N days.")
@click.option(
    "--from-days-ago",
    default=None,
    type=click.IntRange(min=0),
    help="Lower bound in days ago (older). Must be paired with --to-days-ago.",
)
@click.option(
    "--to-days-ago",
    default=None,
    type=click.IntRange(min=0),
    help="Upper bound in days ago (newer). Must be paired with --from-days-ago.",
)
@click.option(
    "--start-from",
    type=click.DateTime(formats=["%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"]),
    default=None,
    help="Archive runs created at or after this timestamp (UTC if no timezone).",
)
@click.option(
    "--end-before",
    type=click.DateTime(formats=["%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"]),
    default=None,
    help="Archive runs created before this timestamp (UTC if no timezone).",
)
@click.option("--batch-size", default=100, show_default=True, help="Batch size for processing.")
@click.option("--workers", default=1, show_default=True, type=int, help="Concurrent workflow runs to archive.")
@click.option("--limit", default=None, type=int, help="Maximum number of runs to archive.")
@click.option("--dry-run", is_flag=True, help="Preview without archiving.")
@click.option("--delete-after-archive", is_flag=True, help="Delete runs and related data after archiving.")
def archive_workflow_runs(
    tenant_ids: str | None,
    before_days: int,
    from_days_ago: int | None,
    to_days_ago: int | None,
    start_from: datetime.datetime | None,
    end_before: datetime.datetime | None,
    batch_size: int,
    workers: int,
    limit: int | None,
    dry_run: bool,
    delete_after_archive: bool,
):
    """
    Archive workflow runs for paid plan tenants older than the specified days.

    This command archives the following tables to storage:
    - workflow_node_executions
    - workflow_node_execution_offload
    - workflow_pauses
    - workflow_pause_reasons
    - workflow_trigger_logs

    The workflow_runs and workflow_app_logs tables are preserved for UI listing.
    """
    from services.retention.workflow_run.archive_paid_plan_workflow_run import WorkflowRunArchiver

    run_started_at = datetime.datetime.now(datetime.UTC)
    click.echo(
        click.style(
            f"Starting workflow run archiving at {run_started_at.isoformat()}.",
            fg="white",
        )
    )

    if (start_from is None) ^ (end_before is None):
        click.echo(click.style("start-from and end-before must be provided together.", fg="red"))
        return

    if (from_days_ago is None) ^ (to_days_ago is None):
        click.echo(click.style("from-days-ago and to-days-ago must be provided together.", fg="red"))
        return

    if from_days_ago is not None and to_days_ago is not None:
        if start_from or end_before:
            click.echo(click.style("Choose either day offsets or explicit dates, not both.", fg="red"))
            return
        if from_days_ago <= to_days_ago:
            click.echo(click.style("from-days-ago must be greater than to-days-ago.", fg="red"))
            return
        now = datetime.datetime.now()
        start_from = now - datetime.timedelta(days=from_days_ago)
        end_before = now - datetime.timedelta(days=to_days_ago)
        before_days = 0

    if start_from and end_before and start_from >= end_before:
        click.echo(click.style("start-from must be earlier than end-before.", fg="red"))
        return
    if workers < 1:
        click.echo(click.style("workers must be at least 1.", fg="red"))
        return

    archiver = WorkflowRunArchiver(
        days=before_days,
        batch_size=batch_size,
        start_from=start_from,
        end_before=end_before,
        workers=workers,
        tenant_ids=[tid.strip() for tid in tenant_ids.split(",")] if tenant_ids else None,
        limit=limit,
        dry_run=dry_run,
        delete_after_archive=delete_after_archive,
    )
    summary = archiver.run()
    click.echo(
        click.style(
            f"Summary: processed={summary.total_runs_processed}, archived={summary.runs_archived}, "
            f"skipped={summary.runs_skipped}, failed={summary.runs_failed}, "
            f"time={summary.total_elapsed_time:.2f}s",
            fg="cyan",
        )
    )

    run_finished_at = datetime.datetime.now(datetime.UTC)
    elapsed = run_finished_at - run_started_at
    click.echo(
        click.style(
            f"Workflow run archiving completed. start={run_started_at.isoformat()} "
            f"end={run_finished_at.isoformat()} duration={elapsed}",
            fg="green",
        )
    )


@click.command(
    "restore-workflow-runs",
    help="Restore archived workflow runs from S3-compatible storage.",
)
@click.option(
    "--tenant-ids",
    required=False,
    help="Tenant IDs (comma-separated).",
)
@click.option("--run-id", required=False, help="Workflow run ID to restore.")
@click.option(
    "--start-from",
    type=click.DateTime(formats=["%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"]),
    default=None,
    help="Optional lower bound (inclusive) for created_at; must be paired with --end-before.",
)
@click.option(
    "--end-before",
    type=click.DateTime(formats=["%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"]),
    default=None,
    help="Optional upper bound (exclusive) for created_at; must be paired with --start-from.",
)
@click.option("--workers", default=1, show_default=True, type=int, help="Concurrent workflow runs to restore.")
@click.option("--limit", type=int, default=100, show_default=True, help="Maximum number of runs to restore.")
@click.option("--dry-run", is_flag=True, help="Preview without restoring.")
def restore_workflow_runs(
    tenant_ids: str | None,
    run_id: str | None,
    start_from: datetime.datetime | None,
    end_before: datetime.datetime | None,
    workers: int,
    limit: int,
    dry_run: bool,
):
    """
    Restore an archived workflow run from storage to the database.

    This restores the following tables:
    - workflow_node_executions
    - workflow_node_execution_offload
    - workflow_pauses
    - workflow_pause_reasons
    - workflow_trigger_logs
    """
    from services.retention.workflow_run.restore_archived_workflow_run import WorkflowRunRestore

    parsed_tenant_ids = None
    if tenant_ids:
        parsed_tenant_ids = [tid.strip() for tid in tenant_ids.split(",") if tid.strip()]
        if not parsed_tenant_ids:
            raise click.BadParameter("tenant-ids must not be empty")

    if (start_from is None) ^ (end_before is None):
        raise click.UsageError("--start-from and --end-before must be provided together.")
    if run_id is None and (start_from is None or end_before is None):
        raise click.UsageError("--start-from and --end-before are required for batch restore.")
    if workers < 1:
        raise click.BadParameter("workers must be at least 1")

    start_time = datetime.datetime.now(datetime.UTC)
    click.echo(
        click.style(
            f"Starting restore of workflow run {run_id} at {start_time.isoformat()}.",
            fg="white",
        )
    )

    restorer = WorkflowRunRestore(dry_run=dry_run, workers=workers)
    if run_id:
        results = [restorer.restore_by_run_id(run_id)]
    else:
        assert start_from is not None
        assert end_before is not None
        results = restorer.restore_batch(
            parsed_tenant_ids,
            start_date=start_from,
            end_date=end_before,
            limit=limit,
        )

    end_time = datetime.datetime.now(datetime.UTC)
    elapsed = end_time - start_time

    successes = sum(1 for result in results if result.success)
    failures = len(results) - successes

    if failures == 0:
        click.echo(
            click.style(
                f"Restore completed successfully. success={successes} duration={elapsed}",
                fg="green",
            )
        )
    else:
        click.echo(
            click.style(
                f"Restore completed with failures. success={successes} failed={failures} duration={elapsed}",
                fg="red",
            )
        )


@click.command(
    "delete-archived-workflow-runs",
    help="Delete archived workflow runs from the database.",
)
@click.option(
    "--tenant-ids",
    required=False,
    help="Tenant IDs (comma-separated).",
)
@click.option("--run-id", required=False, help="Workflow run ID to delete.")
@click.option(
    "--start-from",
    type=click.DateTime(formats=["%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"]),
    default=None,
    help="Optional lower bound (inclusive) for created_at; must be paired with --end-before.",
)
@click.option(
    "--end-before",
    type=click.DateTime(formats=["%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"]),
    default=None,
    help="Optional upper bound (exclusive) for created_at; must be paired with --start-from.",
)
@click.option("--limit", type=int, default=100, show_default=True, help="Maximum number of runs to delete.")
@click.option("--dry-run", is_flag=True, help="Preview without deleting.")
def delete_archived_workflow_runs(
    tenant_ids: str | None,
    run_id: str | None,
    start_from: datetime.datetime | None,
    end_before: datetime.datetime | None,
    limit: int,
    dry_run: bool,
):
    """
    Delete archived workflow runs from the database.
    """
    from services.retention.workflow_run.delete_archived_workflow_run import ArchivedWorkflowRunDeletion

    parsed_tenant_ids = None
    if tenant_ids:
        parsed_tenant_ids = [tid.strip() for tid in tenant_ids.split(",") if tid.strip()]
        if not parsed_tenant_ids:
            raise click.BadParameter("tenant-ids must not be empty")

    if (start_from is None) ^ (end_before is None):
        raise click.UsageError("--start-from and --end-before must be provided together.")
    if run_id is None and (start_from is None or end_before is None):
        raise click.UsageError("--start-from and --end-before are required for batch delete.")

    start_time = datetime.datetime.now(datetime.UTC)
    target_desc = f"workflow run {run_id}" if run_id else "workflow runs"
    click.echo(
        click.style(
            f"Starting delete of {target_desc} at {start_time.isoformat()}.",
            fg="white",
        )
    )

    deleter = ArchivedWorkflowRunDeletion(dry_run=dry_run)
    if run_id:
        results = [deleter.delete_by_run_id(run_id)]
    else:
        assert start_from is not None
        assert end_before is not None
        results = deleter.delete_batch(
            parsed_tenant_ids,
            start_date=start_from,
            end_date=end_before,
            limit=limit,
        )

    for result in results:
        if result.success:
            click.echo(
                click.style(
                    f"{'[DRY RUN] Would delete' if dry_run else 'Deleted'} "
                    f"workflow run {result.run_id} (tenant={result.tenant_id})",
                    fg="green",
                )
            )
        else:
            click.echo(
                click.style(
                    f"Failed to delete workflow run {result.run_id}: {result.error}",
                    fg="red",
                )
            )

    end_time = datetime.datetime.now(datetime.UTC)
    elapsed = end_time - start_time

    successes = sum(1 for result in results if result.success)
    failures = len(results) - successes

    if failures == 0:
        click.echo(
            click.style(
                f"Delete completed successfully. success={successes} duration={elapsed}",
                fg="green",
            )
        )
    else:
        click.echo(
            click.style(
                f"Delete completed with failures. success={successes} failed={failures} duration={elapsed}",
                fg="red",
            )
        )


def _find_orphaned_draft_variables(batch_size: int = 1000) -> list[str]:
    """
    Find draft variables that reference non-existent apps.

    Args:
        batch_size: Maximum number of orphaned app IDs to return

    Returns:
        List of app IDs that have draft variables but don't exist in the apps table
    """
    query = """
        SELECT DISTINCT wdv.app_id
        FROM workflow_draft_variables AS wdv
        WHERE NOT EXISTS(
            SELECT 1 FROM apps WHERE apps.id = wdv.app_id
        )
        LIMIT :batch_size
    """

    with db.engine.connect() as conn:
        result = conn.execute(sa.text(query), {"batch_size": batch_size})
        return [row[0] for row in result]


def _count_orphaned_draft_variables() -> dict[str, Any]:
    """
    Count orphaned draft variables by app, including associated file counts.

    Returns:
        Dictionary with statistics about orphaned variables and files
    """
    # Count orphaned variables by app
    variables_query = """
        SELECT
            wdv.app_id,
            COUNT(*) as variable_count,
            COUNT(wdv.file_id) as file_count
        FROM workflow_draft_variables AS wdv
        WHERE NOT EXISTS(
            SELECT 1 FROM apps WHERE apps.id = wdv.app_id
        )
        GROUP BY wdv.app_id
        ORDER BY variable_count DESC
    """

    with db.engine.connect() as conn:
        result = conn.execute(sa.text(variables_query))
        orphaned_by_app = {}
        total_files = 0

        for row in result:
            app_id, variable_count, file_count = row
            orphaned_by_app[app_id] = {"variables": variable_count, "files": file_count}
            total_files += file_count

        total_orphaned = sum(app_data["variables"] for app_data in orphaned_by_app.values())
        app_count = len(orphaned_by_app)

        return {
            "total_orphaned_variables": total_orphaned,
            "total_orphaned_files": total_files,
            "orphaned_app_count": app_count,
            "orphaned_by_app": orphaned_by_app,
        }


@click.command()
@click.option("--dry-run", is_flag=True, help="Show what would be deleted without actually deleting")
@click.option("--batch-size", default=1000, help="Number of records to process per batch (default 1000)")
@click.option("--max-apps", default=None, type=int, help="Maximum number of apps to process (default: no limit)")
@click.option("-f", "--force", is_flag=True, help="Skip user confirmation and force the command to execute.")
def cleanup_orphaned_draft_variables(
    dry_run: bool,
    batch_size: int,
    max_apps: int | None,
    force: bool = False,
):
    """
    Clean up orphaned draft variables from the database.

    This script finds and removes draft variables that belong to apps
    that no longer exist in the database.
    """
    logger = logging.getLogger(__name__)

    # Get statistics
    stats = _count_orphaned_draft_variables()

    logger.info("Found %s orphaned draft variables", stats["total_orphaned_variables"])
    logger.info("Found %s associated offload files", stats["total_orphaned_files"])
    logger.info("Across %s non-existent apps", stats["orphaned_app_count"])

    if stats["total_orphaned_variables"] == 0:
        logger.info("No orphaned draft variables found. Exiting.")
        return

    if dry_run:
        logger.info("DRY RUN: Would delete the following:")
        for app_id, data in sorted(stats["orphaned_by_app"].items(), key=lambda x: x[1]["variables"], reverse=True)[
            :10
        ]:  # Show top 10
            logger.info("  App %s: %s variables, %s files", app_id, data["variables"], data["files"])
        if len(stats["orphaned_by_app"]) > 10:
            logger.info("  ... and %s more apps", len(stats["orphaned_by_app"]) - 10)
        return

    # Confirm deletion
    if not force:
        click.confirm(
            f"Are you sure you want to delete {stats['total_orphaned_variables']} "
            f"orphaned draft variables and {stats['total_orphaned_files']} associated files "
            f"from {stats['orphaned_app_count']} apps?",
            abort=True,
        )

    total_deleted = 0
    processed_apps = 0

    while True:
        if max_apps and processed_apps >= max_apps:
            logger.info("Reached maximum app limit (%s). Stopping.", max_apps)
            break

        orphaned_app_ids = _find_orphaned_draft_variables(batch_size=10)
        if not orphaned_app_ids:
            logger.info("No more orphaned draft variables found.")
            break

        for app_id in orphaned_app_ids:
            if max_apps and processed_apps >= max_apps:
                break

            try:
                deleted_count = delete_draft_variables_batch(app_id, batch_size)
                total_deleted += deleted_count
                processed_apps += 1

                logger.info("Deleted %s variables for app %s", deleted_count, app_id)

            except Exception:
                logger.exception("Error processing app %s", app_id)
                continue

    logger.info("Cleanup completed. Total deleted: %s variables across %s apps", total_deleted, processed_apps)


@click.command("clean-expired-messages", help="Clean expired messages.")
@click.option(
    "--start-from",
    type=click.DateTime(formats=["%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"]),
    required=False,
    default=None,
    help="Lower bound (inclusive) for created_at.",
)
@click.option(
    "--end-before",
    type=click.DateTime(formats=["%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"]),
    required=False,
    default=None,
    help="Upper bound (exclusive) for created_at.",
)
@click.option(
    "--from-days-ago",
    type=int,
    default=None,
    help="Relative lower bound in days ago (inclusive). Must be used with --before-days.",
)
@click.option(
    "--before-days",
    type=int,
    default=None,
    help="Relative upper bound in days ago (exclusive). Required for relative mode.",
)
@click.option("--batch-size", default=1000, show_default=True, help="Batch size for selecting messages.")
@click.option(
    "--graceful-period",
    default=21,
    show_default=True,
    help="Graceful period in days after subscription expiration, will be ignored when billing is disabled.",
)
@click.option("--dry-run", is_flag=True, default=False, help="Show messages logs would be cleaned without deleting")
def clean_expired_messages(
    batch_size: int,
    graceful_period: int,
    start_from: datetime.datetime | None,
    end_before: datetime.datetime | None,
    from_days_ago: int | None,
    before_days: int | None,
    dry_run: bool,
):
    """
    Clean expired messages and related data for tenants based on clean policy.
    """
    from extensions.otel.runtime import flush_telemetry

    click.echo(click.style("clean_messages: start clean messages.", fg="green"))

    start_at = time.perf_counter()

    try:
        abs_mode = start_from is not None and end_before is not None
        rel_mode = before_days is not None

        if abs_mode and rel_mode:
            raise click.UsageError(
                "Options are mutually exclusive: use either (--start-from,--end-before) "
                "or (--from-days-ago,--before-days)."
            )

        if from_days_ago is not None and before_days is None:
            raise click.UsageError("--from-days-ago must be used together with --before-days.")

        if (start_from is None) ^ (end_before is None):
            raise click.UsageError("Both --start-from and --end-before are required when using absolute time range.")

        if not abs_mode and not rel_mode:
            raise click.UsageError(
                "You must provide either (--start-from,--end-before) or (--before-days [--from-days-ago])."
            )

        if rel_mode:
            assert before_days is not None
            if before_days < 0:
                raise click.UsageError("--before-days must be >= 0.")
            if from_days_ago is not None:
                if from_days_ago < 0:
                    raise click.UsageError("--from-days-ago must be >= 0.")
                if from_days_ago <= before_days:
                    raise click.UsageError("--from-days-ago must be greater than --before-days.")

        # Create policy based on billing configuration
        # NOTE: graceful_period will be ignored when billing is disabled.
        policy = create_message_clean_policy(graceful_period_days=graceful_period)

        if from_days_ago is not None and before_days is not None:
            task_label = f"{from_days_ago}to{before_days}"
        elif start_from is None and before_days is not None:
            task_label = f"before-{before_days}"
        else:
            task_label = "custom"

        # Create and run the cleanup service
        if abs_mode:
            assert start_from is not None
            assert end_before is not None
            service = MessagesCleanService.from_time_range(
                policy=policy,
                start_from=start_from,
                end_before=end_before,
                batch_size=batch_size,
                dry_run=dry_run,
                task_label=task_label,
            )
        elif from_days_ago is None:
            assert before_days is not None
            service = MessagesCleanService.from_days(
                policy=policy,
                days=before_days,
                batch_size=batch_size,
                dry_run=dry_run,
                task_label=task_label,
            )
        else:
            assert before_days is not None
            assert from_days_ago is not None
            now = naive_utc_now()
            service = MessagesCleanService.from_time_range(
                policy=policy,
                start_from=now - datetime.timedelta(days=from_days_ago),
                end_before=now - datetime.timedelta(days=before_days),
                batch_size=batch_size,
                dry_run=dry_run,
                task_label=task_label,
            )
        stats = service.run()

        end_at = time.perf_counter()
        click.echo(
            click.style(
                f"clean_messages: completed successfully\n"
                f"  - Latency: {end_at - start_at:.2f}s\n"
                f"  - Batches processed: {stats['batches']}\n"
                f"  - Total messages scanned: {stats['total_messages']}\n"
                f"  - Messages filtered: {stats['filtered_messages']}\n"
                f"  - Messages deleted: {stats['total_deleted']}",
                fg="green",
            )
        )
    except Exception as e:
        end_at = time.perf_counter()
        logger.exception("clean_messages failed")
        click.echo(
            click.style(
                f"clean_messages: failed after {end_at - start_at:.2f}s - {str(e)}",
                fg="red",
            )
        )
        raise
    finally:
        flush_telemetry()

    click.echo(click.style("messages cleanup completed.", fg="green"))


@click.command("export-app-messages", help="Export messages for an app to JSONL.GZ.")
@click.option("--app-id", required=True, help="Application ID to export messages for.")
@click.option(
    "--start-from",
    type=click.DateTime(formats=["%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"]),
    default=None,
    help="Optional lower bound (inclusive) for created_at.",
)
@click.option(
    "--end-before",
    type=click.DateTime(formats=["%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"]),
    required=True,
    help="Upper bound (exclusive) for created_at.",
)
@click.option(
    "--filename",
    required=True,
    help="Base filename (relative path). Do not include suffix like .jsonl.gz.",
)
@click.option("--use-cloud-storage", is_flag=True, default=False, help="Upload to cloud storage instead of local file.")
@click.option("--batch-size", default=1000, show_default=True, help="Batch size for cursor pagination.")
@click.option("--dry-run", is_flag=True, default=False, help="Scan only, print stats without writing any file.")
def export_app_messages(
    app_id: str,
    start_from: datetime.datetime | None,
    end_before: datetime.datetime,
    filename: str,
    use_cloud_storage: bool,
    batch_size: int,
    dry_run: bool,
):
    if start_from and start_from >= end_before:
        raise click.UsageError("--start-from must be before --end-before.")

    from services.retention.conversation.message_export_service import AppMessageExportService

    try:
        validated_filename = AppMessageExportService.validate_export_filename(filename)
    except ValueError as e:
        raise click.BadParameter(str(e), param_hint="--filename") from e

    click.echo(click.style(f"export_app_messages: starting export for app {app_id}.", fg="green"))
    start_at = time.perf_counter()

    try:
        service = AppMessageExportService(
            app_id=app_id,
            end_before=end_before,
            filename=validated_filename,
            start_from=start_from,
            batch_size=batch_size,
            use_cloud_storage=use_cloud_storage,
            dry_run=dry_run,
        )
        stats = service.run()

        elapsed = time.perf_counter() - start_at
        click.echo(
            click.style(
                f"export_app_messages: completed in {elapsed:.2f}s\n"
                f"  - Batches: {stats.batches}\n"
                f"  - Total messages: {stats.total_messages}\n"
                f"  - Messages with feedback: {stats.messages_with_feedback}\n"
                f"  - Total feedbacks: {stats.total_feedbacks}",
                fg="green",
            )
        )
    except Exception as e:
        elapsed = time.perf_counter() - start_at
        logger.exception("export_app_messages failed")
        click.echo(click.style(f"export_app_messages: failed after {elapsed:.2f}s - {e}", fg="red"))
        raise
