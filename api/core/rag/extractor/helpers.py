"""Document loader helpers."""

import concurrent.futures
from typing import NamedTuple

import charset_normalizer


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

    The sample size must be positive. If a bounded sample has no match, retry
    without up to three trailing bytes that may belong to an incomplete character.
    Never trim a sample that reaches EOF. File and detection failures propagate;
    no match raises RuntimeError and a detection timeout raises TimeoutError.
    """

    def read_and_detect(filename: str):
        with open(filename, "rb") as file:
            sample = file.read(sample_size)
            truncated = file.seek(0, 2) > len(sample)
        rst = charset_normalizer.from_bytes(sample)
        best = rst.best()
        trimmed = 0
        while best is None and truncated and trimmed < min(3, len(sample) - 1):
            trimmed += 1
            best = charset_normalizer.from_bytes(sample[:-trimmed]).best()
        if best is None:
            return []
        file_encoding = FileEncoding(encoding=best.encoding, confidence=best.coherence, language=best.language)
        return [file_encoding]

    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(read_and_detect, file_path)
        try:
            encodings = future.result(timeout=timeout)
        except concurrent.futures.TimeoutError as caught_error:
            raise TimeoutError(f"Timeout reached while detecting encoding for {file_path}") from caught_error

    if all(encoding.encoding is None for encoding in encodings):
        raise RuntimeError(f"Could not detect encoding for {file_path}")
    return [enc for enc in encodings if enc.encoding is not None]
