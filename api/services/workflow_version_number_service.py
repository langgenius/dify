"""Allocation of user-facing workflow version numbers (`#N`).

Numbers are unique and monotonically increasing within an app, and are never
reused: `workflow_version_counters` keeps the highest number handed out so far,
so deleting a published version does not free its number.

The counter is keyed by `Workflow.app_id`, which is polymorphic — it holds an app
id, a pipeline id or a snippet id depending on the workflow kind. UUID uniqueness
across those tables is why the same counter table serves all of them.
"""

from sqlalchemy import select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from configs import dify_config
from models.workflow import WorkflowVersionCounter


def allocate_version_number(*, session: Session, app_id: str) -> int:
    """Reserve and return the next version number for `app_id`.

    The upsert acquires a row lock that is held until the caller's transaction
    commits, so concurrent publishes of the same app serialize and never receive
    the same number. Callers must run inside a transaction; if it rolls back,
    both the counter update and workflow creation roll back, leaving the number
    available for the next successful publish.
    """
    # Dialect-specific upsert, mirroring `workflow_draft_variable_service`: the
    # ORM cannot express "insert or increment" and a read-then-write would race.
    # PostgreSQL returns the new value inline; MySQL has no RETURNING, so the
    # value is read back within the same transaction while the row is still
    # locked by the upsert.
    if dify_config.SQLALCHEMY_DATABASE_URI_SCHEME == "postgresql":
        stmt = (
            pg_insert(WorkflowVersionCounter)
            .values(app_id=app_id, last_version_number=1)
            .on_conflict_do_update(
                index_elements=[WorkflowVersionCounter.app_id],
                set_={"last_version_number": WorkflowVersionCounter.last_version_number + 1},
            )
            .returning(WorkflowVersionCounter.last_version_number)
        )
        version_number = session.scalar(stmt)
    else:
        insert_stmt = mysql_insert(WorkflowVersionCounter).values(app_id=app_id, last_version_number=1)
        session.execute(
            insert_stmt.on_duplicate_key_update(  # type: ignore[attr-defined]
                last_version_number=WorkflowVersionCounter.last_version_number + 1,
            )
        )
        version_number = session.scalar(
            select(WorkflowVersionCounter.last_version_number).where(WorkflowVersionCounter.app_id == app_id)
        )

    if version_number is None:
        raise ValueError(f"Failed to allocate a workflow version number for app {app_id}.")
    return version_number
