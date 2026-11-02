from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from core.rag.extractor import helpers
from core.rag.extractor.helpers import detect_file_encodings


class TestHelpers:
    @pytest.mark.parametrize("encoding", ["gbk", "gb18030", "big5", "utf-8"])
    @pytest.mark.parametrize("sample_size", [4096, 1024 * 1024])
    def test_detect_encoding_with_incomplete_sample_character(
        self, tmp_path: Path, encoding: str, sample_size: int
    ) -> None:
        text = "知識文件需要正確保留文字內容。" * (sample_size // 10 + 1)
        data = text.encode(encoding)
        # End the sample after the first byte of a multibyte character.
        prefix_size = (sample_size - 1) % len("知".encode(encoding))
        data = b"\n" * prefix_size + data
        file_path = tmp_path / "sample.txt"
        file_path.write_bytes(data)

        encodings = detect_file_encodings(str(file_path), sample_size=sample_size)

        detected_encoding = encodings[0].encoding
        assert detected_encoding is not None
        assert data.decode(detected_encoding) == "\n" * prefix_size + text

    def test_incomplete_character_at_file_end_is_not_repaired(self, tmp_path: Path) -> None:
        file_path = tmp_path / "incomplete.txt"
        file_path.write_bytes(("知識文件需要正確保留文字內容。\n" * 300).encode("utf-8") + b"\xe4")

        with pytest.raises(RuntimeError, match="Could not detect encoding"):
            detect_file_encodings(str(file_path))

    @pytest.mark.parametrize("encoding", ["gb18030", "utf-8"])
    @pytest.mark.parametrize("incomplete_bytes", [1, 2, 3])
    def test_sample_ending_inside_four_byte_character(
        self, tmp_path: Path, encoding: str, incomplete_bytes: int
    ) -> None:
        prefix = "知識文件需要正確保留文字內容。" * 300
        text = prefix + "😀" + prefix
        data = text.encode(encoding)
        file_path = tmp_path / "four-byte.txt"
        file_path.write_bytes(data)

        encodings = detect_file_encodings(str(file_path), sample_size=len(prefix.encode(encoding)) + incomplete_bytes)

        detected_encoding = encodings[0].encoding
        assert detected_encoding is not None
        assert data.decode(detected_encoding) == text

    @pytest.mark.parametrize(("sample_size", "file_size"), [(None, 1_200_000), (4096, 140_000), (4096, 12)])
    def test_detect_file_encodings_bounds_read(self, tmp_path: Path, sample_size: int | None, file_size: int):
        file_path = tmp_path / "sample.txt"
        file_path.write_bytes(b"a" * file_size)
        real_open = open
        reads = []
        byte_counts = []

        def tracked_open(filename, *args, **kwargs):
            stream = real_open(filename, *args, **kwargs)
            if str(filename) == str(file_path):
                real_read = stream.read

                def tracked_read(*read_args, **read_kwargs):
                    data = real_read(*read_args, **read_kwargs)
                    byte_counts.append(len(data))
                    return data

                stream.read = Mock(side_effect=tracked_read)
                reads.append(stream.read)
            return stream

        with patch("builtins.open", side_effect=tracked_open):
            if sample_size is None:
                encodings = detect_file_encodings(str(file_path))
            else:
                encodings = detect_file_encodings(str(file_path), sample_size=sample_size)

        expected_limit = 1024 * 1024 if sample_size is None else sample_size
        assert len(reads) == 1
        reads[0].assert_called_once_with(expected_limit)
        assert byte_counts == [min(file_size, expected_limit)]
        assert encodings[0].encoding == "ascii"

    def test_detect_file_encodings(self, tmp_path: Path) -> None:
        file_path = tmp_path / "sample.txt"
        file_path.write_text("Shared data", encoding="utf-8")
        encodings = detect_file_encodings(str(file_path))

        assert len(encodings) == 1
        assert encodings[0].encoding in {"utf_8", "ascii"}
        assert encodings[0].confidence == 0.0
        # Assert the language field for full coverage
        assert encodings[0].language is not None

    def test_detect_file_encodings_timeout(self, monkeypatch: pytest.MonkeyPatch):
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

    @pytest.mark.parametrize("no_match", [False, True])
    def test_detect_file_encodings_raises_when_encoding_not_detected(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, no_match: bool
    ):
        class FakeResult:
            encoding = None
            coherence = 0.0
            language = None

        file_path = tmp_path / "sample.txt"
        file_path.write_bytes(b"sample")
        monkeypatch.setattr(
            helpers.charset_normalizer,
            "from_bytes",
            lambda _: SimpleNamespace(best=lambda: None if no_match else FakeResult()),
        )

        with pytest.raises(RuntimeError, match="Could not detect encoding"):
            detect_file_encodings(str(file_path))
