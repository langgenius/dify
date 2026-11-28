from __future__ import annotations

import os
import tempfile
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace, TracebackType

import pytest

from core.rag.extractor import helpers
from core.rag.extractor.helpers import FileEncoding, detect_file_encodings


class _RecordingSampleReader:
    """Fake :class:`core.rag.extractor.helpers.FileSampleReader` used by the tests.

    It reads from the real file so the detection path stays real, and records
    every requested sample size so the test can assert the read bounds.
    """

    def __init__(self) -> None:
        self.requested_sizes: list[int] = []
        self.byte_counts: list[int] = []

    def __call__(self, file_path: str, sample_size: int) -> bytes:
        self.requested_sizes.append(sample_size)
        with open(file_path, "rb") as stream:
            data = stream.read(sample_size)
        self.byte_counts.append(len(data))
        return data


class TestHelpers:
    @pytest.mark.parametrize(("sample_size", "file_size"), [(None, 1_200_000), (4096, 140_000), (4096, 12)])
    def test_detect_file_encodings_bounds_read(self, tmp_path: Path, sample_size: int | None, file_size: int) -> None:
        file_path = tmp_path / "sample.txt"
        file_path.write_bytes(b"a" * file_size)
        reader = _RecordingSampleReader()

        if sample_size is None:
            encodings = detect_file_encodings(str(file_path), read_sample=reader)
        else:
            encodings = detect_file_encodings(str(file_path), sample_size=sample_size, read_sample=reader)

        expected_limit = 1024 * 1024 if sample_size is None else sample_size
        assert reader.requested_sizes == [expected_limit]
        assert reader.byte_counts == [min(file_size, expected_limit)]
        assert encodings[0].encoding == "ascii"

    def test_detect_file_encodings(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w+t", suffix=".txt", delete=False) as temp:
            temp.write("Shared data")
            temp.flush()
            temp_path = temp.name
        try:
            encodings = detect_file_encodings(temp_path)
        finally:
            os.unlink(temp_path)

        assert len(encodings) == 1
        assert encodings[0].encoding in {"utf_8", "ascii"}
        assert encodings[0].confidence == 0.0
        # Assert the language field for full coverage
        assert encodings[0].language is not None

    def test_detect_file_encodings_timeout(self, monkeypatch: pytest.MonkeyPatch) -> None:
        class FakeFuture:
            def result(self, timeout: int | None = None) -> None:
                raise helpers.concurrent.futures.TimeoutError()

        class FakeExecutor:
            def __enter__(self) -> FakeExecutor:
                return self

            def __exit__(
                self,
                exc_type: type[BaseException] | None,
                exc: BaseException | None,
                tb: TracebackType | None,
            ) -> bool:
                return False

            def submit[**P](
                self, fn: Callable[P, list[FileEncoding]], /, *args: P.args, **kwargs: P.kwargs
            ) -> FakeFuture:
                return FakeFuture()

        monkeypatch.setattr(helpers.concurrent.futures, "ThreadPoolExecutor", lambda: FakeExecutor())

        with pytest.raises(TimeoutError, match="Timeout reached while detecting encoding"):
            detect_file_encodings("file.txt", timeout=1)

    @pytest.mark.parametrize("no_match", [False, True])
    def test_detect_file_encodings_raises_when_encoding_not_detected(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, no_match: bool
    ) -> None:
        class FakeResult:
            encoding: str | None = None
            coherence: float = 0.0
            language: str | None = None

        file_path = tmp_path / "sample.txt"
        file_path.write_bytes(b"sample")
        monkeypatch.setattr(
            helpers.charset_normalizer,
            "from_bytes",
            lambda _: SimpleNamespace(best=lambda: None if no_match else FakeResult()),
        )

        with pytest.raises(RuntimeError, match="Could not detect encoding"):
            detect_file_encodings(str(file_path))
