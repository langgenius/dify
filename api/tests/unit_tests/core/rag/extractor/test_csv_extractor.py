import csv
import io
from types import SimpleNamespace

import pandas as pd
import pytest

import core.rag.extractor.csv_extractor as csv_module
from core.rag.extractor.csv_extractor import CSVExtractor


class _ManagedStringIO(io.StringIO):
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()
        return False


class TestCSVExtractor:
    def test_extract_success_with_source_column(self, tmp_path):
        file_path = tmp_path / "data.csv"
        file_path.write_text("id,body\nsource-1,hello\n", encoding="utf-8")

        extractor = CSVExtractor(str(file_path), source_column="id")
        docs = extractor.extract()

        assert len(docs) == 1
        assert docs[0].page_content == "id: source-1;body: hello"
        assert docs[0].metadata == {"source": "source-1", "row": 0}

    def test_extract_raises_when_source_column_missing(self, tmp_path):
        file_path = tmp_path / "data.csv"
        file_path.write_text("id,body\nsource-1,hello\n", encoding="utf-8")

        extractor = CSVExtractor(str(file_path), source_column="missing_col")

        with pytest.raises(ValueError, match="Source column 'missing_col' not found"):
            extractor.extract()

    def test_extract_wraps_unicode_error_when_autodetect_disabled(self, monkeypatch: pytest.MonkeyPatch):
        extractor = CSVExtractor("dummy.csv", autodetect_encoding=False)

        def raise_decode(*args, **kwargs):
            raise UnicodeDecodeError("utf-8", b"x", 0, 1, "decode error")

        monkeypatch.setattr("builtins.open", raise_decode)

        with pytest.raises(RuntimeError, match="Error loading dummy.csv"):
            extractor.extract()

    def test_extract_autodetect_encoding_success(self, monkeypatch: pytest.MonkeyPatch):
        extractor = CSVExtractor("dummy.csv", autodetect_encoding=True)
        attempted_encodings: list[str | None] = []

        def fake_open(path, newline="", encoding=None):
            attempted_encodings.append(encoding)
            if encoding is None:
                raise UnicodeDecodeError("utf-8", b"x", 0, 1, "decode error")
            if encoding == "bad":
                raise UnicodeDecodeError("utf-8", b"x", 0, 1, "decode error")
            return _ManagedStringIO("id,body\nsource-1,hello\n")

        monkeypatch.setattr("builtins.open", fake_open)
        monkeypatch.setattr(
            csv_module,
            "detect_file_encodings",
            lambda _: [SimpleNamespace(encoding="bad"), SimpleNamespace(encoding="utf-8")],
        )

        docs = extractor.extract()

        assert len(docs) == 1
        assert docs[0].page_content == "id: source-1;body: hello"
        assert attempted_encodings == [None, "bad", "utf-8"]

    def test_extract_autodetect_encoding_all_attempts_fail_returns_empty(self, monkeypatch: pytest.MonkeyPatch):
        extractor = CSVExtractor("dummy.csv", autodetect_encoding=True)

        def always_raise(*args, **kwargs):
            raise UnicodeDecodeError("utf-8", b"x", 0, 1, "decode error")

        monkeypatch.setattr("builtins.open", always_raise)
        monkeypatch.setattr(csv_module, "detect_file_encodings", lambda _: [SimpleNamespace(encoding="bad")])

        assert extractor.extract() == []

    def test_read_from_file_re_raises_csv_error(self, monkeypatch: pytest.MonkeyPatch):
        extractor = CSVExtractor("dummy.csv")

        monkeypatch.setattr(pd, "read_csv", lambda *args, **kwargs: (_ for _ in ()).throw(csv.Error("bad csv")))

        with pytest.raises(csv.Error, match="bad csv"):
            extractor._read_from_file(io.StringIO("x"))
