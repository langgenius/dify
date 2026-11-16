"""Document loader helpers."""

import concurrent.futures
from typing import NamedTuple, Protocol

import charset_normalizer


class FileEncoding(NamedTuple):
    """A file encoding as the NamedTuple."""

    encoding: str | None
    """The encoding of the file."""
    confidence: float
    """The confidence of the encoding."""
    language: str | None
    """The language of the file."""


class FileSampleReader(Protocol):
    """Boundary that reads a bounded byte sample from a file on disk.

    ``detect_file_encodings`` takes one of these so callers and tests can hand
    in the filesystem access instead of patching ``builtins.open``.
    """

    def __call__(self, file_path: str, sample_size: int) -> bytes: ...


def read_file_sample(file_path: str, sample_size: int) -> bytes:
    """Read at most ``sample_size`` bytes from ``file_path``.

    This is the production :class:`FileSampleReader`: it touches the local
    filesystem, so callers that run inside a sandbox must pass their own
    implementation instead.
    """
    with open(file_path, "rb") as file:
        return file.read(sample_size)


def detect_file_encodings(
    file_path: str,
    timeout: int = 5,
    sample_size: int = 1024 * 1024,
    *,
    read_sample: FileSampleReader = read_file_sample,
) -> list[FileEncoding]:
    """Try to detect the file encoding.

    Returns a list of `FileEncoding` tuples with the detected encodings ordered
    by confidence.

    Args:
        file_path: The path to the file to detect the encoding for.
        timeout: The timeout in seconds for the encoding detection.
        sample_size: The number of bytes to read for encoding detection. Default is 1MB.
                    For large files, reading only a sample is sufficient and prevents timeout.
        read_sample: The filesystem boundary used to read the sample. Defaults to
                    reading ``file_path`` from the local filesystem.
    """

    def read_and_detect(filename: str) -> list[FileEncoding]:
        sample = read_sample(filename, sample_size)
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
        except concurrent.futures.TimeoutError as caught_error:
            raise TimeoutError(f"Timeout reached while detecting encoding for {file_path}") from caught_error

    if all(encoding.encoding is None for encoding in encodings):
        raise RuntimeError(f"Could not detect encoding for {file_path}")
    return [enc for enc in encodings if enc.encoding is not None]
