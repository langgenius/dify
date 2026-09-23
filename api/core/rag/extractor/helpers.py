"""Document loader helpers."""

import concurrent.futures
import csv
import io
from typing import NamedTuple

import charset_normalizer

# The separators a spreadsheet actually writes into a file named ".csv". Excel
# writes the list separator of the machine's locale, which is a semicolon across
# most of Europe, and a tab-separated export is routinely saved as .csv.
CSV_DELIMITERS = (",", ";", "\t", "|")

# How much of the file the detection looks at. A separator that holds for the
# first rows holds for the file.
CSV_DELIMITER_SAMPLE_CHARS = 64 * 1024
CSV_DELIMITER_SAMPLE_ROWS = 20


def _consistent_column_count(sample: str, delimiter: str, truncated: bool = False) -> int:
    """Return the columns per row under `delimiter`, or 0 when the rows disagree.

    A separator the file was not written with either does not occur at all (one
    column) or occurs by accident, and then the rows do not line up. Requiring
    the same count on every row is what keeps a comma inside a sentence, or a
    semicolon inside a quoted field, from being read as a separator.

    When `truncated` is set, the sample is a prefix of a longer file, so the row
    it ends in stops wherever the read did, between two fields or inside a
    quoted one. That row is left out rather than counted as having fewer columns.
    """
    rows: list[list[str]] = []
    try:
        for index, row in enumerate(csv.reader(io.StringIO(sample, newline=""), delimiter=delimiter)):
            if index >= CSV_DELIMITER_SAMPLE_ROWS:
                break
            if any(cell.strip() for cell in row):  # a blank or whitespace-only line says nothing
                rows.append(row)
        else:
            if truncated and len(rows) > 1:
                rows.pop()
    except csv.Error:
        return 0
    count = 0
    for row in rows:
        if count and len(row) != count:
            return 0
        count = len(row)
    return count if count > 1 else 0


def detect_csv_delimiter(sample: str) -> str:
    """Try to detect the separator a CSV was written with, defaulting to a comma.

    `pandas.read_csv` defaults to a comma, and reading a semicolon-separated
    export with one does not fail: every row comes back as a single column
    holding the whole line.

    Pandas' own sniffing (`sep=None, engine="python"`) is not used: it searches
    the whole candidate space and on a single-column file splits the header
    `Note` into `No` and `e`.

    Args:
        sample: The first rows of the file, as text. A sample of
            `CSV_DELIMITER_SAMPLE_CHARS` or more is treated as cut from a longer
            file, so its last row may be incomplete.
    """
    truncated = len(sample) >= CSV_DELIMITER_SAMPLE_CHARS
    sample = sample[:CSV_DELIMITER_SAMPLE_CHARS]
    best_delimiter, best_columns = ",", 0
    for delimiter in CSV_DELIMITERS:
        columns = _consistent_column_count(sample, delimiter, truncated)
        if columns > best_columns:
            best_delimiter, best_columns = delimiter, columns
    return best_delimiter


class FileEncoding(NamedTuple):
    """A file encoding as the NamedTuple."""

    encoding: str | None
    """The encoding of the file."""
    confidence: float
    """The confidence of the encoding."""
    language: str | None
    """The language of the file."""


def detect_file_encodings(file_path: str, timeout: int = 5, sample_size: int = 1024 * 1024) -> list[FileEncoding]:
    """Try to detect the file encoding.

    Returns a list of `FileEncoding` tuples with the detected encodings ordered
    by confidence.

    Args:
        file_path: The path to the file to detect the encoding for.
        timeout: The timeout in seconds for the encoding detection.
        sample_size: The number of bytes to read for encoding detection. Default is 1MB.
                    For large files, reading only a sample is sufficient and prevents timeout.
    """

    def read_and_detect(filename: str):
        with open(filename, "rb") as file:
            sample = file.read(sample_size)
        rst = charset_normalizer.from_bytes(sample)
        best = rst.best()
        if best is None:
            return []
        file_encoding = FileEncoding(encoding=best.encoding, confidence=best.coherence, language=best.language)
        return [file_encoding]

    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(read_and_detect, file_path)
        try:
            encodings = future.result(timeout=timeout)
        except concurrent.futures.TimeoutError:
            raise TimeoutError(f"Timeout reached while detecting encoding for {file_path}")

    if all(encoding.encoding is None for encoding in encodings):
        raise RuntimeError(f"Could not detect encoding for {file_path}")
    return [enc for enc in encodings if enc.encoding is not None]
