"""Write the shared application log CSV columns, with formula-safe cells."""

import csv
from collections.abc import Iterable, Mapping
from typing import TextIO

from core.helper.csv_sanitizer import CSVSanitizer

_LOG_CSV_COLUMNS = (
    "app_id",
    "app_type",
    "end_user_id",
    "account_id",
    "account_name",
    "conversation_id",
    "run_id",
    "message_id",
    "created_at",
    "user_input",
    "app_response",
    "feedback_rating",
    "feedback_content",
    "status",
    "trigger_by",
    "source",
    "agent_id",
)


def write_log_export_csv(output: TextIO, rows: Iterable[Mapping[str, str | None]]) -> int:
    """Write the header and stream data rows to an open text file, returning the number of rows.

    The caller owns the stream and publishes it only after success. Columns absent
    from a row are written as empty cells.
    """
    output.write("\ufeff")
    writer = csv.DictWriter(output, fieldnames=_LOG_CSV_COLUMNS, quoting=csv.QUOTE_ALL)
    writer.writeheader()
    row_count = 0
    for row in rows:
        writer.writerow({column: CSVSanitizer.sanitize_value(value) for column, value in row.items()})
        row_count += 1
    return row_count
