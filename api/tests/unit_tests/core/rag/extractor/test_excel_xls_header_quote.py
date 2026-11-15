"""Regression tests for double quotes in .xls column headers.

The .xlsx branch escapes quotes in header names in ``_find_header_and_columns``,
but the .xls branch emitted header names verbatim. A column such as
``Size "L"`` then produced ``"Size "L"":"..."`` and corrupted the
``"key":"value"`` row layout that downstream consumers read.
"""

import pandas as pd
import pytest

from core.rag.extractor.excel_extractor import ExcelExtractor


def _patch_xls(monkeypatch: pytest.MonkeyPatch, row: dict[str, str]) -> None:
    class FakeExcelFile:
        sheet_names = ["Sheet1"]

        def parse(self, sheet_name: str) -> pd.DataFrame:
            assert sheet_name == "Sheet1"
            return pd.DataFrame([row])

    monkeypatch.setattr(pd, "ExcelFile", lambda *_args, **_kwargs: FakeExcelFile())


def test_xls_escapes_double_quotes_in_column_header(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_xls(monkeypatch, {'Size "L"': "large", "plain": "text"})

    docs = ExcelExtractor("/tmp/sample.xls").extract()

    assert len(docs) == 1
    assert docs[0].page_content == r'"Size \"L\"":"large";"plain":"text"'


def test_xls_escapes_quotes_in_header_and_value(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_xls(monkeypatch, {'Q3 "final"': 'he said "hi"'})

    docs = ExcelExtractor("/tmp/sample.xls").extract()

    assert docs[0].page_content == r'"Q3 \"final\"":"he said \"hi\""'


def test_xls_plain_headers_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_xls(monkeypatch, {"A": "x", "B": "y"})

    docs = ExcelExtractor("/tmp/sample.xls").extract()

    assert docs[0].page_content == r'"A":"x";"B":"y"'
