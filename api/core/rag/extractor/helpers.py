"""Document loader helpers."""

import concurrent.futures
from typing import NamedTuple, Optional, cast


class FileEncoding(NamedTuple):
    """A file encoding as the NamedTuple."""

    encoding: Optional[str]
    """The encoding of the file."""
    confidence: float
    """The confidence of the encoding."""
    language: Optional[str]
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
    import chardet

    def read_and_detect(file_path: str) -> list[dict]:
        with open(file_path, "rb") as f:
            # Read only a sample of the file for encoding detection
            # This prevents timeout on large files while still providing accurate encoding detection
            rawdata = f.read(sample_size)
        return cast(list[dict], chardet.detect_all(rawdata))

    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(read_and_detect, file_path)
        try:
            encodings = future.result(timeout=timeout)
        except concurrent.futures.TimeoutError:
            raise TimeoutError(f"Timeout reached while detecting encoding for {file_path}")

    if all(encoding["encoding"] is None for encoding in encodings):
        raise RuntimeError(f"Could not detect encoding for {file_path}")
    return [FileEncoding(**enc) for enc in encodings if enc["encoding"] is not None]
