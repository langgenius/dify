"""Stream application log CSVs with formula-safe cells."""

import csv
from collections.abc import Callable, Iterable, Mapping
from typing import TextIO

from core.helper.csv_sanitizer import CSVSanitizer

type CsvRowProgress = Callable[[int], None]


def write_log_export_csv(
    output: TextIO,
    rows: Iterable[Mapping[str, str | None]],
    *,
    columns: tuple[str, ...],
    report_rows: CsvRowProgress | None = None,
) -> int:
    """Write the supplied columns and their row values to an open text file, returning the row count.

    The caller owns the stream and publishes it after success. Each row follows the
    header order, with an empty cell for a selected column without a value.
    When supplied, report_rows receives the cumulative count after each data row.
    """
    output.write("\ufeff")
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    writer.writerow(columns)
    row_count = 0
    for row in rows:
        writer.writerow(CSVSanitizer.sanitize_value(row.get(column)) for column in columns)
        row_count += 1
        if report_rows is not None:
            report_rows(row_count)
    return row_count
