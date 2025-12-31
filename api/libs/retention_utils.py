"""
Retention helpers for archive/export storage paths.
"""

import datetime


def build_workflow_run_prefix(
    *,
    tenant_id: str,
    app_id: str,
    created_at: datetime.datetime | None,
    run_id: str,
) -> str:
    archive_time = created_at or datetime.datetime.now(datetime.UTC)
    year = archive_time.strftime("%Y")
    month = archive_time.strftime("%m")
    return f"{tenant_id}/app_id={app_id}/year={year}/month={month}/workflow_run_id={run_id}"
