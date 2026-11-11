"""Select current records before applying mutable-field filters or aggregates."""

from collections.abc import Mapping, Sequence

from extensions.logstore.sql_escape import escape_identifier, escape_sql_string


def latest_records(logstore: str, owner: Mapping[str, str]) -> str:
    """Owner fields are immutable; status/time/aggregate predicates belong outside."""
    conditions = " AND ".join(
        f"\"{escape_identifier(field)}\" = '{escape_sql_string(value)}'" for field, value in owner.items()
    )
    return f"""
        SELECT * FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) AS _version_rank
            FROM "{escape_identifier(logstore)}" WHERE __time__ > 0 AND {conditions}
        ) versions WHERE _version_rank = 1
    """


def node_execution_page(
    current_records: str, *, order_by: Sequence[str], include_paused: bool, offset: int, count: int
) -> str:
    """Paginate final SLS results using its LIMIT offset, count dialect."""
    status_filter = "" if include_paused else " WHERE status != 'paused'"
    return (
        f"SELECT * FROM ({current_records}) nodes{status_filter} ORDER BY {', '.join(order_by)} LIMIT {offset}, {count}"
    )
