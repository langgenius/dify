import csv
import io
from pathlib import Path
from types import SimpleNamespace
from typing import override

import pandas as pd
import pytest

import core.rag.extractor.csv_extractor as csv_module
from core.rag.extractor.csv_extractor import CSVExtractor


class _ManagedStringIO(io.StringIO):
    @override
    def __enter__(self):
        return self

    @override
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


class TestCSVExtractor:
    @pytest.mark.parametrize("value", ["00123", "1.00", "1e3", "NA", "NULL", "N/A", "", "hello"])
    def test_extract_preserves_cell_text(self, tmp_path: Path, value: str) -> None:
        file_path = tmp_path / "data.csv"
        file_path.write_text(f"value,body\n{value},reference\n", encoding="utf-8")

        docs = CSVExtractor(str(file_path), encoding="utf-8", source_column="value").extract()

        assert len(docs) == 1
        assert docs[0].page_content == f"value: {value};body: reference"
        assert docs[0].metadata["source"] == value

    def test_extract_honors_explicit_csv_args(self, tmp_path: Path) -> None:
        file_path = tmp_path / "data.csv"
        file_path.write_text("value;body\n00123;NA\n", encoding="utf-8")
        csv_args = {"sep": ";", "dtype": {"value": int}, "keep_default_na": True}

        docs = CSVExtractor(str(file_path), encoding="utf-8", csv_args=csv_args).extract()

        assert docs[0].page_content == "value: 123.0;body: nan"
        assert csv_args == {"sep": ";", "dtype": {"value": int}, "keep_default_na": True}

    def test_extract_success_with_source_column(self, tmp_path: Path):
        file_path = tmp_path / "data.csv"
        file_path.write_text("id,body\nsource-1,hello\n", encoding="utf-8")

        extractor = CSVExtractor(str(file_path), source_column="id")
        docs = extractor.extract()

        assert len(docs) == 1
        assert docs[0].page_content == "id: source-1;body: hello"
        assert docs[0].metadata == {"source": "source-1", "row": 0}

    def test_extract_raises_when_source_column_missing(self, tmp_path: Path):
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


class TestCSVSeparatorDetection:
    """A file named .csv is not always comma separated.

    Excel writes the list separator of the machine's locale -- a semicolon
    across most of Europe -- and a tab separated export is routinely saved as
    .csv. `pandas.read_csv` defaults to a comma, so such a file was read as a
    single column holding the whole row.
    """

    ROWS = ["name;region;units", "widget;EU;12", "gadget;US;7"]
    EXPECTED = ["name: widget;region: EU;units: 12", "name: gadget;region: US;units: 7"]

    def _extract(self, tmp_path: Path, text: str, **kwargs) -> list[str]:
        file_path = tmp_path / "data.csv"
        file_path.write_text(text, encoding="utf-8")
        docs = CSVExtractor(str(file_path), encoding="utf-8", **kwargs).extract()
        return [doc.page_content for doc in docs]

    @pytest.mark.parametrize("separator", [",", ";", "\t", "|"])
    def test_reads_the_separator_the_file_was_written_with(self, tmp_path: Path, separator: str) -> None:
        text = "\n".join(row.replace(";", separator) for row in self.ROWS) + "\n"

        assert self._extract(tmp_path, text) == self.EXPECTED

    def test_a_single_column_file_stays_a_single_column(self, tmp_path: Path) -> None:
        """Guard: a separator that does not line up across the rows is not one."""
        text = "note\na; b\nc; d\n"

        assert self._extract(tmp_path, text) == ["note: a; b", "note: c; d"]

    def test_a_separator_inside_a_quoted_field_is_not_a_separator(self, tmp_path: Path) -> None:
        text = 'name,note\nwidget,"a; b"\ngadget,"c; d"\n'

        assert self._extract(tmp_path, text) == ["name: widget;note: a; b", "name: gadget;note: c; d"]

    def test_an_explicit_separator_is_not_overridden(self, tmp_path: Path) -> None:
        """A `sep` in csv_args wins, and no detection runs."""
        text = "name,region\nwidget;EU\n"

        # With the comma forced, the semicolon is ordinary text and the second
        # column is empty -- detection would have picked the semicolon instead.
        assert self._extract(tmp_path, text, csv_args={"sep": ","}) == ["name: widget;EU;region: "]
