"""Bounded file-encoding detection shared by document loaders."""

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
        timeout: Maximum seconds the caller waits for encoding detection.
        sample_size: The number of bytes to read for encoding detection. Default is 1MB.
                    For large files, reading only a sample is sufficient and prevents timeout.

    Notes:
        Running detector work cannot be interrupted. A timeout bounds the caller
        wait; detection continues in the background and may delay process shutdown.
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

    executor = concurrent.futures.ThreadPoolExecutor()
    try:
        future = executor.submit(read_and_detect, file_path)
        try:
            encodings = future.result(timeout=timeout)
        except concurrent.futures.TimeoutError as error:
            raise TimeoutError(f"Timeout reached while detecting encoding for {file_path}") from error
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    if all(encoding.encoding is None for encoding in encodings):
        raise RuntimeError(f"Could not detect encoding for {file_path}")
    return [enc for enc in encodings if enc.encoding is not None]
