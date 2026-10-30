"""Read-only operator reports for retrieval tuning."""

import csv
from collections import Counter
from datetime import timedelta
from typing import IO
from uuid import UUID

import click

from extensions.ext_application_services import application_services
from libs.datetime_utils import naive_utc_now

_REPORT_PAGE_SIZE = 200
# Graphs are large, so this report loads fewer apps per page.
_GRAPH_REPORT_PAGE_SIZE = 100

_FEEDBACK_VOLUME_COLUMNS = (
    "tenant_id",
    "app_id",
    "messages",
    "user_likes",
    "user_dislikes",
    "user_rating_rate",
    "user_rated_workflow_run_share",
    "admin_likes",
    "admin_dislikes",
)

_NODE_ELIGIBILITY_COLUMNS = (
    "tenant_id",
    "app_id",
    "workflow_id",
    "node_id",
    "category",
    "available_dataset_count",
    "unavailable_dataset_count",
    "vector_stores",
    "has_parent_child_documents",
    "in_iteration_or_loop",
    "app_retrieval_node_count",
)


def _format_ratio(value: float | None) -> str:
    """Render a ratio to four decimals; None (undefined) becomes an empty CSV cell."""
    return "" if value is None else f"{value:.4f}"


@click.group("retrieval-tuning")
def retrieval_tuning_reports() -> None:
    """Inspect data available for tuning retrieval weights."""


@retrieval_tuning_reports.command("feedback-volume")
@click.option("--days", type=click.IntRange(min=1), default=90, show_default=True, help="Report window in days.")
@click.option("--tenant-id", type=click.UUID, default=None, help="Limit the report to one tenant; omit for all.")
@click.option("--output", type=click.File("w", encoding="utf-8"), default="-", help="CSV path; defaults to stdout.")
def feedback_volume(days: int, tenant_id: UUID | None, output: IO[str]) -> None:
    """Write per-app Chatflow feedback counts as CSV, without message or feedback text.

    Requires an application context. Reads only, and writes rows to output as each page
    arrives, so a database failure can leave a partial file and exits with an error.
    """
    until = naive_utc_now()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(_FEEDBACK_VOLUME_COLUMNS)
    writer.writerows(
        (
            record.tenant_id,
            record.app_id,
            record.messages,
            record.user_likes,
            record.user_dislikes,
            _format_ratio(record.user_rating_rate),
            _format_ratio(record.user_rated_workflow_run_share),
            record.admin_likes,
            record.admin_dislikes,
        )
        for record in application_services().retrieval_tuning.feedback_volume.report(
            since=until - timedelta(days=days),
            until=until,
            tenant_id=str(tenant_id) if tenant_id else None,
            page_size=_REPORT_PAGE_SIZE,
        )
    )


@retrieval_tuning_reports.command("node-eligibility")
@click.option("--tenant-id", type=click.UUID, default=None, help="Limit the report to one tenant; omit for all.")
@click.option("--output", type=click.File("w", encoding="utf-8"), default="-", help="CSV path; defaults to stdout.")
def node_eligibility(tenant_id: UUID | None, output: IO[str]) -> None:
    """Write one CSV row per published retrieval node, then per-category totals to stderr.

    Join to feedback-volume on app_id; apps with several retrieval nodes share their
    app's rating count. Requires an application context. Reads only, and writes rows as
    each page arrives, so a database failure can leave a partial file and exits with an
    error before printing totals.
    """
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(_NODE_ELIGIBILITY_COLUMNS)
    totals: Counter[str] = Counter()
    for record in application_services().retrieval_tuning.node_eligibility.report(
        tenant_id=str(tenant_id) if tenant_id else None,
        page_size=_GRAPH_REPORT_PAGE_SIZE,
    ):
        totals[record.category.value] += 1
        writer.writerow(
            (
                record.tenant_id,
                record.app_id,
                record.workflow_id,
                record.node_id or "",
                record.category.value,
                record.available_dataset_count,
                record.unavailable_dataset_count,
                ";".join(record.vector_stores),
                record.has_parent_child_documents,
                record.in_iteration_or_loop,
                record.app_retrieval_node_count,
            )
        )
    for category, count in sorted(totals.items()):
        click.echo(f"{category}: {count}", err=True)
