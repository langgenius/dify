import tempfile
from types import SimpleNamespace

import pytest

from core.rag.extractor import helpers
from core.rag.extractor.helpers import detect_file_encodings


class TestHelpers:
    def test_detect_file_encodings(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w+t", suffix=".txt") as temp:
            temp.write("Shared data")
            temp.flush()
            temp_path = temp.name
            encodings = detect_file_encodings(temp_path)

        assert len(encodings) == 1
        assert encodings[0].encoding in {"utf_8", "ascii"}
        assert encodings[0].confidence == 0.0
        # Assert the language field for full coverage
        assert encodings[0].language is not None

    def test_detect_file_encodings_timeout(self, monkeypatch):
        class FakeFuture:
            def result(self, timeout=None):
                raise helpers.concurrent.futures.TimeoutError()

        class FakeExecutor:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def submit(self, fn, file_path):
                return FakeFuture()

        monkeypatch.setattr(helpers.concurrent.futures, "ThreadPoolExecutor", lambda: FakeExecutor())

        with pytest.raises(TimeoutError, match="Timeout reached while detecting encoding"):
            detect_file_encodings("file.txt", timeout=1)

    def test_detect_file_encodings_raises_when_encoding_not_detected(self, monkeypatch):
        class FakeResult:
            encoding = None
            coherence = 0.0
            language = None

        monkeypatch.setattr(
            helpers.charset_normalizer, "from_path", lambda _: SimpleNamespace(best=lambda: FakeResult())
        )

        with pytest.raises(RuntimeError, match="Could not detect encoding"):
            detect_file_encodings("file.txt")
