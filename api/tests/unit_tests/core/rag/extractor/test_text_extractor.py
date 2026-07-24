from pathlib import Path
from types import SimpleNamespace

import pytest

import core.rag.extractor.text_extractor as text_module
from core.rag.extractor.text_extractor import TextExtractor


class TestTextExtractor:
    def test_extract_success(self, tmp_path):
        file_path = tmp_path / "data.txt"
        file_path.write_text("hello world", encoding="utf-8")

        extractor = TextExtractor(str(file_path))
        docs = extractor.extract()

        assert len(docs) == 1
        assert docs[0].page_content == "hello world"
        assert docs[0].metadata == {"source": str(file_path)}

    def test_extract_autodetect_success_after_decode_error(self, monkeypatch):
        extractor = TextExtractor("dummy.txt", autodetect_encoding=True)

        calls = []

        def fake_read_text(self, encoding=None):
            calls.append(encoding)
            if encoding is None:
                raise UnicodeDecodeError("utf-8", b"x", 0, 1, "decode")
            if encoding == "bad":
                raise UnicodeDecodeError("utf-8", b"x", 0, 1, "decode")
            return "decoded text"

        monkeypatch.setattr(Path, "read_text", fake_read_text, raising=True)
        monkeypatch.setattr(
            text_module,
            "detect_file_encodings",
            lambda _: [SimpleNamespace(encoding="bad"), SimpleNamespace(encoding="utf-8")],
        )

        docs = extractor.extract()

        assert docs[0].page_content == "decoded text"
        assert calls == [None, "bad", "utf-8"]

    def test_extract_autodetect_all_fail_raises_runtime_error(self, monkeypatch):
        extractor = TextExtractor("dummy.txt", autodetect_encoding=True)

        def always_decode_error(self, encoding=None):
            raise UnicodeDecodeError("utf-8", b"x", 0, 1, "decode")

        monkeypatch.setattr(Path, "read_text", always_decode_error, raising=True)
        monkeypatch.setattr(text_module, "detect_file_encodings", lambda _: [SimpleNamespace(encoding="latin-1")])

        with pytest.raises(RuntimeError, match="all detected encodings failed"):
            extractor.extract()

    def test_extract_decode_error_without_autodetect_raises_runtime_error(self, monkeypatch):
        extractor = TextExtractor("dummy.txt", autodetect_encoding=False)

        def always_decode_error(self, encoding=None):
            raise UnicodeDecodeError("utf-8", b"x", 0, 1, "decode")

        monkeypatch.setattr(Path, "read_text", always_decode_error, raising=True)

        with pytest.raises(RuntimeError, match="specified encoding failed"):
            extractor.extract()

    def test_extract_wraps_non_decode_exceptions(self, monkeypatch):
        extractor = TextExtractor("dummy.txt")

        def raise_other(self, encoding=None):
            raise OSError("io error")

        monkeypatch.setattr(Path, "read_text", raise_other, raising=True)

        with pytest.raises(RuntimeError, match="Error loading dummy.txt"):
            extractor.extract()
